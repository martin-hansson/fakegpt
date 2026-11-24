#!/usr/bin/env node
/**
 * Build realistic pre-crawled competitor corpora (200-500 real pages per niche)
 * for FakeGPT's curated niches.
 *
 * Output files are written to corpora/<niche>.json + corpora/<niche>.f32
 * (both gitignored so scraped third-party content is never committed publicly;
 * distribute corpora/ via DSV / Triton).
 *
 * Usage:
 *   node scripts/build-corpus.mjs [--niche <id>] [--max-pages 250] [--max-chunks-per-url 8] [--no-embed]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CheerioCrawler, RequestQueue, LogLevel, log as crawleeLog } from "crawlee";
import { Ollama } from "ollama";
import { extractChunksFromHtml } from "../lib/rag-utils.js";

crawleeLog.setLevel(LogLevel.WARNING);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, "niche-urls.json");
const CORPORA_DIR = path.join(ROOT_DIR, "corpora");

const EMBED_MODEL = process.env.EMBED_MODEL || "embeddinggemma";
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const robotsCache = new Map();

function parseArgs(argv) {
  const args = {
    embed: true,
    maxPages: null,
    maxChunksPerUrl: 8,
    maxPagesPerHost: 75,
    niche: null,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--no-embed") args.embed = false;
    else if (argv[i] === "--niche") args.niche = argv[++i];
    else if (argv[i] === "--max-pages")
      args.maxPages = parseInt(argv[++i], 10) || 250;
    else if (argv[i] === "--max-chunks-per-url")
      args.maxChunksPerUrl = parseInt(argv[++i], 10) || 8;
    else if (argv[i] === "--max-pages-per-host")
      args.maxPagesPerHost = parseInt(argv[++i], 10) || 75;
  }
  return args;
}

async function getRobotsRules(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const disallows = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const text = await res.text();
      let inWildcard = false;
      for (const rawLine of text.split("\n")) {
        const line = rawLine.split("#")[0].trim().toLowerCase();
        if (!line) continue;
        if (line.startsWith("user-agent:")) {
          inWildcard = line.slice("user-agent:".length).trim() === "*";
        } else if (inWildcard && line.startsWith("disallow:")) {
          const p = line.slice("disallow:".length).trim();
          if (p) disallows.push(p);
        }
      }
    }
  } catch {
    // treat unreachable robots.txt as allowed
  }
  robotsCache.set(origin, disallows);
  return disallows;
}

async function isAllowedByRobots(pageUrl) {
  try {
    const u = new URL(pageUrl);
    const disallows = await getRobotsRules(u.origin);
    for (const d of disallows) {
      if (d === "/" || (d.length > 1 && u.pathname.toLowerCase().startsWith(d))) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function isCleanHtmlCandidate(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const p = u.pathname.toLowerCase();
    if (
      /\.(jpg|jpeg|png|gif|svg|webp|ico|pdf|zip|mp4|mp3|css|js|xml|json|woff2?)$/i.test(
        p,
      )
    ) {
      return false;
    }
    if (
      u.hostname.endsWith("wikipedia.org") &&
      (p.includes(":") || u.search.length > 0)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function batchEmbedChunks(ollama, chunks, batchSize = 32) {
  const allVectors = [];
  let dim = 0;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const inputs = batch.map((c) => `${c.title || ""}\n${c.chunk}`.slice(0, 1200));
    try {
      const res = await ollama.embed({ model: EMBED_MODEL, input: inputs });
      for (const vec of res.embeddings) {
        if (!dim) dim = vec.length;
        allVectors.push(vec);
      }
    } catch {
      // Fallback to single-item embed if one chunk exceeds context window
      for (const inp of inputs) {
        const single = await ollama.embed({
          model: EMBED_MODEL,
          input: inp.slice(0, 600),
        });
        const vec = single.embeddings[0];
        if (!dim) dim = vec.length;
        allVectors.push(vec);
      }
    }
    if ((i + batchSize) % 320 === 0 || i + batchSize >= chunks.length) {
      process.stdout.write(
        `\r  Embedded ${Math.min(i + batchSize, chunks.length)}/${chunks.length} chunks...`,
      );
    }
  }
  process.stdout.write("\n");
  const flat = new Float32Array(allVectors.length * dim);
  for (let i = 0; i < allVectors.length; i++) {
    flat.set(allVectors[i], i * dim);
  }
  return { dim, flat };
}

async function buildSingleNiche(niche, args, ollama) {
  const maxPages = args.maxPages || niche.targetPages || 250;
  const urlRegex = niche.urlPattern ? new RegExp(niche.urlPattern, "i") : null;
  const allowAllHosts = new Set(niche.allowAllOnSeedHosts || []);
  const seedHosts = new Set(
    niche.urls
      .map((u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  );

  console.log(
    `\n=== Crawling niche: ${niche.id} (target up to ${maxPages} pages) ===`,
  );

  const hostCounts = new Map();
  const crawledUrls = new Set();
  const rawChunks = [];

  const queue = await RequestQueue.open(
    `corpus-${niche.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );

  const crawler = new CheerioCrawler({
    requestQueue: queue,
    maxRequestsPerCrawl: maxPages,
    maxConcurrency: 4,
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: 20,
    additionalMimeTypes: ["text/html"],
    preNavigationHooks: [
      async ({ request }) => {
        request.headers = {
          ...(request.headers || {}),
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        };
      },
    ],
    async requestHandler({ request, $, enqueueLinks }) {
      const pageUrl = request.loadedUrl || request.url;
      const host = new URL(pageUrl).hostname;
      if (crawledUrls.has(pageUrl)) return;

      const allowed = await isAllowedByRobots(pageUrl);
      if (!allowed) return;

      const count = hostCounts.get(host) || 0;
      if (count >= args.maxPagesPerHost && !niche.urls.includes(request.url)) {
        return;
      }

      const { chunks } = extractChunksFromHtml($.html(), pageUrl);
      const filtered = chunks
        .filter(
          (c) =>
            c.text &&
            c.text.length >= 50 &&
            !c.text.startsWith("Structured Data (JSON-LD):"),
        )
        .slice(0, args.maxChunksPerUrl);

      if (filtered.length > 0) {
        crawledUrls.add(pageUrl);
        hostCounts.set(host, count + 1);
        for (const c of filtered) {
          rawChunks.push({ chunk: c.text, source: c.url, title: c.title });
        }
        if (crawledUrls.size % 25 === 0) {
          process.stdout.write(
            `\r  Crawled ${crawledUrls.size}/${maxPages} pages (${rawChunks.length} chunks)...`,
          );
        }
      }

      if (crawledUrls.size < maxPages) {
        await enqueueLinks({
          strategy: "same-hostname",
          transformRequestFunction(req) {
            if (!isCleanHtmlCandidate(req.url)) return false;
            try {
              const u = new URL(req.url);
              if (!seedHosts.has(u.hostname)) return false;
              if ((hostCounts.get(u.hostname) || 0) >= args.maxPagesPerHost) {
                return false;
              }
              if (allowAllHosts.has(u.hostname)) return req;
              if (urlRegex && !urlRegex.test(u.pathname)) return false;
              return req;
            } catch {
              return false;
            }
          },
        });
      }
    },
  });

  await crawler.run(niche.urls);
  try {
    await queue.drop();
  } catch {}
  process.stdout.write("\n");
  console.log(
    `  Finished crawl: ${crawledUrls.size} pages, ${rawChunks.length} chunks across ${hostCounts.size} hosts:`,
  );
  for (const [h, cnt] of hostCounts.entries()) {
    console.log(`    - ${h}: ${cnt} pages`);
  }

  let embeddingDim = 0;
  let embeddingsFile = null;
  if (args.embed && rawChunks.length > 0) {
    const { dim, flat } = await batchEmbedChunks(ollama, rawChunks);
    embeddingDim = dim;
    embeddingsFile = `${niche.id}.f32`;
    const f32Path = path.join(CORPORA_DIR, embeddingsFile);
    await fs.writeFile(
      f32Path,
      Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength),
    );
  }

  const corpusDoc = {
    id: niche.id,
    name: niche.name,
    description: niche.description,
    builtAt: new Date().toISOString(),
    embedModel: args.embed ? EMBED_MODEL : null,
    embeddingDim,
    embeddingsFile,
    pagesCount: crawledUrls.size,
    chunksCount: rawChunks.length,
    hosts: Object.fromEntries(hostCounts),
    chunks: rawChunks,
  };

  const outJson = path.join(CORPORA_DIR, `${niche.id}.json`);
  await fs.writeFile(outJson, JSON.stringify(corpusDoc));
  const jsonKb = Math.round((await fs.stat(outJson)).size / 1024);
  const f32Kb = embeddingsFile
    ? Math.round(
        (await fs.stat(path.join(CORPORA_DIR, embeddingsFile))).size / 1024,
      )
    : 0;
  console.log(
    `  Saved ${niche.id}.json (${jsonKb} KB) + ${embeddingsFile || "no-f32"} (${f32Kb} KB)`,
  );

  return {
    id: niche.id,
    name: niche.name,
    description: niche.description,
    builtAt: corpusDoc.builtAt,
    embedModel: corpusDoc.embedModel,
    embeddingDim,
    embeddingsFile,
    pagesCount: corpusDoc.pagesCount,
    chunksCount: corpusDoc.chunksCount,
    file: `${niche.id}.json`,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const niches = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
  const targets = args.niche
    ? niches.filter((n) => n.id === args.niche)
    : niches;

  if (targets.length === 0) {
    console.error(`No matching niche found for "${args.niche}".`);
    process.exit(1);
  }

  await fs.mkdir(CORPORA_DIR, { recursive: true });
  const ollama = args.embed ? new Ollama({ host: OLLAMA_HOST }) : null;

  const manifestEntries = [];
  for (const niche of targets) {
    const entry = await buildSingleNiche(niche, args, ollama);
    manifestEntries.push(entry);
  }

  const manifestPath = path.join(CORPORA_DIR, "manifest.json");
  let merged = manifestEntries;
  if (args.niche) {
    try {
      const existing = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      const map = new Map(existing.map((e) => [e.id, e]));
      for (const e of manifestEntries) map.set(e.id, e);
      merged = [...map.values()];
    } catch {}
  }
  await fs.writeFile(manifestPath, JSON.stringify(merged, null, 2));
  console.log(`\nUpdated ${manifestPath} (${merged.length} niches ready).`);
}

main().catch((err) => {
  console.error("Corpus build failed:", err);
  process.exit(1);
});
