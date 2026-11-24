import express from "express";
import cors from "cors";
import { Ollama } from "ollama";
import fs from "fs/promises";
import path from "path";
import { CheerioCrawler, RequestQueue } from "crawlee";
import {
  cosineSimilarity,
  normalizeSiteUrl,
  canonicalizeCrawlUrl,
  selectDiverseTopK,
  buildFakepediaChunks,
  buildReviewChunks,
  getSitePrefix,
  isUrlWithinPrefix,
  isSitemapUrl,
  parseSitemapUrls,
  getSitemapCandidates,
  extractChunksFromHtml,
  parseEvaluatorResponse,
  isTrivialGreeting,
} from "./lib/rag-utils.js";

// Model configuration (can be overridden via environment variables)
const GEN_MODEL = process.env.GEN_MODEL || "qwen3:4b";
const EMBED_MODEL = process.env.EMBED_MODEL || "embeddinggemma"; // If you change this, remember you need to crawl the site again.

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

import os from "os";
let FRONTEND_DIR =
  global.FRONTEND_DIR ||
  process.env.FRONTEND_DIR ||
  path.join(process.cwd(), "dist");
let DATA_DIR =
  global.DATA_DIR || process.env.DATA_DIR || path.join(process.cwd(), "data");

if (DATA_DIR === "/data") {
  DATA_DIR = path.join(os.homedir(), ".chatlab_data");
}
const LOCAL_INDEX_FILE = path.join(DATA_DIR, "local_index.json");
const CUSTOM_COMPETITORS_FILE = path.join(DATA_DIR, "custom_competitors.json");
const EXTERNAL_SOURCES_FILE = path.join(DATA_DIR, "external_sources.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");
const CORPORA_DIR =
  global.CORPORA_DIR ||
  process.env.CORPORA_DIR ||
  path.join(process.cwd(), "corpora");

const loadedCorpusCache = new Map();

import fsSync from "fs";
if (!fsSync.existsSync(DATA_DIR)) {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
}

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const ollama = new Ollama({ host: OLLAMA_HOST });

const isThinking = await ollama
  .show({ model: GEN_MODEL })
  .then((res) => res.capabilities?.includes("thinking") || false)
  .catch((err) => {
    console.warn(
      `Could not query Ollama model capabilities for ${GEN_MODEL}: ${err.message}`,
    );
    return false;
  });

// Serve the compiled Vite static assets
app.use(express.static(FRONTEND_DIR));

const SIMILARITY_THRESHOLD = 0.1;

const DEFAULT_EXTERNAL_SOURCES = {
  fakepedia: {
    enabled: false,
    title: "",
    content: "",
    updatedAt: null,
    chunks: [],
  },
  reviews: {
    enabled: false,
    brandName: "",
    items: [],
    updatedAt: null,
    chunks: [],
  },
};

async function initDataStorage() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {}
  for (const [file, fallback] of [
    [LOCAL_INDEX_FILE, {}],
    [CUSTOM_COMPETITORS_FILE, {}],
    [EXTERNAL_SOURCES_FILE, DEFAULT_EXTERNAL_SOURCES],
    [SETTINGS_FILE, { activeNiche: null }],
    [CHATS_FILE, []],
  ]) {
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, JSON.stringify(fallback));
    }
  }
}
initDataStorage();

// Read/Write Helpers
async function readJsonFile(filepath) {
  try {
    const data = await fs.readFile(filepath, "utf-8");
    return JSON.parse(data);
  } catch {
    return filepath === CHATS_FILE ? [] : {};
  }
}
async function writeJsonFile(filepath, data) {
  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
}

// --- COMPETITOR CORPUS SERVICE ---
async function resolveCorporaDir() {
  for (const candidate of [CORPORA_DIR, path.join(CORPORA_DIR, "corpora")]) {
    try {
      await fs.access(path.join(candidate, "manifest.json"));
      return candidate;
    } catch {
      try {
        const files = await fs.readdir(candidate);
        if (files.some((f) => f.endsWith(".json") && f !== "manifest.json")) {
          return candidate;
        }
      } catch {
        // continue
      }
    }
  }
  return CORPORA_DIR;
}

async function listAvailableNiches() {
  const dir = await resolveCorporaDir();
  const manifestPath = path.join(dir, "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fallback: scan corpora/*.json
  }
  try {
    const files = await fs.readdir(dir);
    const niches = [];
    for (const file of files) {
      if (!file.endsWith(".json") || file === "manifest.json") continue;
      try {
        const doc = JSON.parse(
          await fs.readFile(path.join(dir, file), "utf-8"),
        );
        if (doc && doc.id && Array.isArray(doc.chunks)) {
          niches.push({
            id: doc.id,
            name: doc.name || doc.id,
            description: doc.description || "",
            pagesCount: doc.pagesCount || 0,
            chunksCount: doc.chunks.length,
            embedModel: doc.embedModel || null,
            file,
          });
        }
      } catch {
        // skip unreadable json
      }
    }
    return niches;
  } catch {
    return [];
  }
}

async function getActiveNicheId() {
  const settings = await readJsonFile(SETTINGS_FILE);
  if (settings && settings.activeNiche) {
    return settings.activeNiche;
  }
  const niches = await listAvailableNiches();
  if (niches.length > 0) {
    const firstId = niches[0].id;
    await writeJsonFile(SETTINGS_FILE, { activeNiche: firstId });
    return firstId;
  }
  return "custom";
}

async function loadNicheCorpusChunks(nicheId) {
  if (!nicheId || nicheId === "custom") return [];

  const cacheKey = `${nicheId}::${EMBED_MODEL}`;
  if (loadedCorpusCache.has(cacheKey)) {
    return loadedCorpusCache.get(cacheKey);
  }

  const corporaDir = await resolveCorporaDir();
  const corpusPath = path.join(corporaDir, `${nicheId}.json`);
  let corpusDoc;
  try {
    corpusDoc = JSON.parse(await fs.readFile(corpusPath, "utf-8"));
  } catch {
    console.warn(`Corpus file not found for niche "${nicheId}" at ${corpusPath}`);
    return [];
  }

  const rawChunks = Array.isArray(corpusDoc.chunks) ? corpusDoc.chunks : [];

  // Fast path 1: companion binary Float32Array file (.f32) matching EMBED_MODEL
  if (
    corpusDoc.embedModel === EMBED_MODEL &&
    corpusDoc.embeddingsFile &&
    corpusDoc.embeddingDim > 0 &&
    rawChunks.length > 0
  ) {
    try {
      const f32Path = path.join(corporaDir, corpusDoc.embeddingsFile);
      const buf = await fs.readFile(f32Path);
      const dim = corpusDoc.embeddingDim;
      const flat = new Float32Array(
        buf.buffer,
        buf.byteOffset,
        Math.floor(buf.byteLength / 4),
      );
      if (flat.length >= rawChunks.length * dim) {
        const mapped = rawChunks.map((c, idx) => ({
          chunk: c.chunk,
          embedding: flat.subarray(idx * dim, (idx + 1) * dim),
          source: c.source,
          title: c.title,
          isLocal: false,
        }));
        loadedCorpusCache.set(cacheKey, mapped);
        console.log(
          `Loaded binary corpus "${nicheId}" (${mapped.length} chunks, dim=${dim})`,
        );
        return mapped;
      }
    } catch (err) {
      console.warn(
        `Could not load binary embeddings ${corpusDoc.embeddingsFile}: ${err.message}`,
      );
    }
  }

  // Fast path 2: inline JSON embeddings matching EMBED_MODEL
  const hasMatchingEmbeddings =
    corpusDoc.embedModel === EMBED_MODEL &&
    rawChunks.length > 0 &&
    Array.isArray(rawChunks[0].embedding);

  if (hasMatchingEmbeddings) {
    const mapped = rawChunks.map((c) => ({
      chunk: c.chunk,
      embedding: c.embedding,
      source: c.source,
      title: c.title,
      isLocal: false,
    }));
    loadedCorpusCache.set(cacheKey, mapped);
    return mapped;
  }

  // Fallback: check disk cache for re-embedded binary corpus matching current EMBED_MODEL
  const safeModel = EMBED_MODEL.replace(/[^a-z0-9_-]/gi, "_");
  const diskF32Path = path.join(DATA_DIR, `corpus_${nicheId}_${safeModel}.f32`);
  const diskMetaPath = path.join(DATA_DIR, `corpus_${nicheId}_${safeModel}.meta.json`);
  try {
    const meta = JSON.parse(await fs.readFile(diskMetaPath, "utf-8"));
    const buf = await fs.readFile(diskF32Path);
    const flat = new Float32Array(
      buf.buffer,
      buf.byteOffset,
      Math.floor(buf.byteLength / 4),
    );
    if (meta.count === rawChunks.length && meta.dim > 0 && flat.length >= meta.count * meta.dim) {
      const mapped = rawChunks.map((c, idx) => ({
        chunk: c.chunk,
        embedding: flat.subarray(idx * meta.dim, (idx + 1) * meta.dim),
        source: c.source,
        title: c.title,
        isLocal: false,
      }));
      loadedCorpusCache.set(cacheKey, mapped);
      return mapped;
    }
  } catch {
    // needs embedding
  }

  console.log(
    `Batch-embedding ${rawChunks.length} competitor chunks for niche "${nicheId}" with ${EMBED_MODEL}...`,
  );
  const vectors = [];
  let dim = 0;
  const batchSize = 32;
  for (let i = 0; i < rawChunks.length; i += batchSize) {
    const batch = rawChunks.slice(i, i + batchSize);
    const inputs = batch.map((c) => `${c.title || ""}\n${c.chunk}`.slice(0, 1200));
    const embRes = await ollama.embed({ model: EMBED_MODEL, input: inputs });
    for (const vec of embRes.embeddings) {
      if (!dim) dim = vec.length;
      vectors.push(vec);
    }
  }
  const flat = new Float32Array(vectors.length * dim);
  for (let i = 0; i < vectors.length; i++) flat.set(vectors[i], i * dim);
  await fs.writeFile(
    diskF32Path,
    Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength),
  );
  await writeJsonFile(diskMetaPath, { count: rawChunks.length, dim, embedModel: EMBED_MODEL });

  const mapped = rawChunks.map((c, idx) => ({
    chunk: c.chunk,
    embedding: flat.subarray(idx * dim, (idx + 1) * dim),
    source: c.source,
    title: c.title,
    isLocal: false,
  }));
  loadedCorpusCache.set(cacheKey, mapped);
  return mapped;
}

async function crawlSiteToChunks(rawUrl) {
  const sitePrefix = getSitePrefix(rawUrl);
  const rawChunks = [];
  const crawledPages = new Set();

  let startUrls = [];
  if (isSitemapUrl(rawUrl)) {
    const smRes = await fetch(rawUrl, { signal: AbortSignal.timeout(5000) });
    if (!smRes.ok) {
      throw new Error(`Could not fetch sitemap ${rawUrl} (HTTP ${smRes.status})`);
    }
    const smXml = await smRes.text();
    startUrls = parseSitemapUrls(smXml, sitePrefix, rawUrl);
    if (startUrls.length === 0) {
      throw new Error(
        `No valid <loc> URLs found inside sitemap ${rawUrl} matching prefix ${sitePrefix}`,
      );
    }
    console.log(
      `Loaded sitemap directly from ${rawUrl} (${startUrls.length} matching URLs)`,
    );
  } else {
    startUrls = [rawUrl];
    try {
      const sitemapCandidates = getSitemapCandidates(rawUrl);
      for (const smUrl of sitemapCandidates) {
        try {
          const smRes = await fetch(smUrl, { signal: AbortSignal.timeout(2500) });
          if (smRes.ok) {
            const smXml = await smRes.text();
            const parsedUrls = parseSitemapUrls(smXml, sitePrefix, rawUrl);
            let addedCount = 0;
            for (const loc of parsedUrls) {
              if (!startUrls.includes(loc)) {
                startUrls.push(loc);
                addedCount++;
              }
            }
            if (parsedUrls.length > 0) {
              console.log(
                `Discovered sitemap at ${smUrl} (${addedCount} additional URLs)`,
              );
              break;
            }
          }
        } catch {}
      }
    } catch {}
  }

  const crawledCanonical = new Set();
  const crawlQueue = await RequestQueue.open(
    `crawl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  const crawler = new CheerioCrawler({
    requestQueue: crawlQueue,
    maxRequestsPerCrawl: 20, // Safe limit for lab
    async requestHandler({ request, $, enqueueLinks, log }) {
      const canonUrl = canonicalizeCrawlUrl(request.loadedUrl || request.url);
      if (crawledCanonical.has(canonUrl)) {
        log.info(`Skipping duplicate canonical page: ${request.url}`);
        return;
      }
      log.info(`Crawling: ${request.url}`);
      crawledCanonical.add(canonUrl);
      crawledPages.add(request.url);

      // Enqueue links strictly within the submitted site's path prefix
      await enqueueLinks({
        strategy: "same-origin",
        transformRequestFunction(req) {
          if (!isUrlWithinPrefix(req.url, sitePrefix, rawUrl)) return false;
          if (crawledCanonical.has(canonicalizeCrawlUrl(req.url))) return false;
          return req;
        },
      });

      const { chunks } = extractChunksFromHtml($.html(), request.url);
      rawChunks.push(...chunks);
    },
  });

  console.log(`Starting crawler for ${rawUrl} (prefix: ${sitePrefix})...`);
  await crawler.run(startUrls);
  try {
    await crawlQueue.drop();
  } catch {}

  console.log(
    `Crawled ${crawledPages.size} page(s). Embedding ${rawChunks.length} chunks...`,
  );
  const embeddedChunks = [];
  for (const c of rawChunks) {
    try {
      const embeddingRes = await ollama.embeddings({
        model: EMBED_MODEL,
        prompt: `${c.title}\n${c.text}`,
      });
      embeddedChunks.push({
        chunk: c.text,
        source: c.url,
        title: c.title,
        embedding: embeddingRes.embedding,
      });
    } catch (e) {
      console.error(`Embedding failed with ${EMBED_MODEL}:`, e.message);
      throw new Error(
        `Embedding model failed. Make sure to run: ollama pull ${EMBED_MODEL}`,
      );
    }
  }

  const normKey = normalizeSiteUrl(isSitemapUrl(rawUrl) ? sitePrefix : rawUrl);
  return {
    normKey,
    pagesCount: crawledPages.size,
    chunks: embeddedChunks,
  };
}

// --- HEALTH & INDEX SERVICES ---
app.get("/api/health", async (req, res) => {
  const warnings = [];
  let ollamaReachable = false;
  let hasGenModel = false;
  let hasEmbedModel = false;

  try {
    const listRes = await ollama.list();
    ollamaReachable = true;
    const names = (listRes.models || []).map((m) => m.name || m.model || "");
    const matchesModel = (target) =>
      names.some((n) => n === target || n === `${target}:latest` || n.startsWith(`${target}:`));
    hasGenModel = matchesModel(GEN_MODEL);
    hasEmbedModel = matchesModel(EMBED_MODEL);
    if (!hasGenModel) warnings.push(`Missing chat model — run: ollama pull ${GEN_MODEL}`);
    if (!hasEmbedModel) warnings.push(`Missing embedding model — run: ollama pull ${EMBED_MODEL}`);
  } catch {
    warnings.push(`Cannot reach Ollama at ${OLLAMA_HOST}. Start Ollama and reload.`);
  }

  const niches = await listAvailableNiches();
  if (niches.length === 0) {
    warnings.push("No competitor corpora found — extract corpora.zip into corpora/.");
  }

  res.json({
    ok: warnings.length === 0,
    ollamaReachable,
    genModel: GEN_MODEL,
    embedModel: EMBED_MODEL,
    hasGenModel,
    hasEmbedModel,
    nichesCount: niches.length,
    warnings,
  });
});

app.get("/api/niches", async (req, res) => {
  try {
    const niches = await listAvailableNiches();
    const activeNiche = await getActiveNicheId();
    res.json({ niches, activeNiche });
  } catch (error) {
    console.error("Failed to list niches:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/niches/select", async (req, res) => {
  const { nicheId } = req.body || {};
  if (!nicheId) return res.status(400).json({ error: "nicheId is required" });

  try {
    if (nicheId !== "custom") {
      const niches = await listAvailableNiches();
      const match = niches.find((n) => n.id === nicheId);
      if (!match) {
        return res.status(404).json({ error: `Unknown niche: ${nicheId}` });
      }
      await writeJsonFile(SETTINGS_FILE, { activeNiche: nicheId });
      const chunks = await loadNicheCorpusChunks(nicheId);
      return res.json({
        activeNiche: nicheId,
        name: match.name,
        pagesCount: match.pagesCount,
        chunksCount: chunks.length,
      });
    }

    await writeJsonFile(SETTINGS_FILE, { activeNiche: "custom" });
    res.json({ activeNiche: "custom", pagesCount: 0, chunksCount: 0 });
  } catch (error) {
    console.error("Failed to select niche:", error);
    res.status(500).json({ error: error.message });
  }
});

async function readExternalSources() {
  const raw = await readJsonFile(EXTERNAL_SOURCES_FILE);
  return {
    fakepedia: {
      ...DEFAULT_EXTERNAL_SOURCES.fakepedia,
      ...(raw?.fakepedia || {}),
      chunks: Array.isArray(raw?.fakepedia?.chunks) ? raw.fakepedia.chunks : [],
    },
    reviews: {
      ...DEFAULT_EXTERNAL_SOURCES.reviews,
      ...(raw?.reviews || {}),
      items: Array.isArray(raw?.reviews?.items) ? raw.reviews.items : [],
      chunks: Array.isArray(raw?.reviews?.chunks) ? raw.reviews.chunks : [],
    },
  };
}

app.get("/api/external-sources", async (req, res) => {
  try {
    const ext = await readExternalSources();
    res.json({
      fakepedia: {
        enabled: !!ext.fakepedia.enabled,
        title: ext.fakepedia.title || "",
        content: ext.fakepedia.content || "",
        updatedAt: ext.fakepedia.updatedAt || null,
        chunksCount: ext.fakepedia.chunks.length,
      },
      reviews: {
        enabled: !!ext.reviews.enabled,
        brandName: ext.reviews.brandName || "",
        items: ext.reviews.items || [],
        updatedAt: ext.reviews.updatedAt || null,
        chunksCount: ext.reviews.chunks.length,
      },
    });
  } catch (error) {
    console.error("Failed to read external sources:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/external-sources/fakepedia", async (req, res) => {
  try {
    const { title = "", content = "", enabled = true } = req.body || {};
    const ext = await readExternalSources();
    const rawChunks = buildFakepediaChunks({ title, content });
    const embeddedChunks = [];

    for (const c of rawChunks) {
      const embRes = await ollama.embeddings({
        model: EMBED_MODEL,
        prompt: `${c.title}\n${c.text}`,
      });
      embeddedChunks.push({
        chunk: c.text,
        source: c.url,
        title: c.title,
        sourceType: "fakepedia",
        embedding: embRes.embedding,
      });
    }

    ext.fakepedia = {
      enabled: Boolean(enabled && embeddedChunks.length > 0),
      title: title.trim(),
      content,
      updatedAt: new Date().toISOString(),
      chunks: embeddedChunks,
    };
    await writeJsonFile(EXTERNAL_SOURCES_FILE, ext);

    res.json({
      enabled: ext.fakepedia.enabled,
      title: ext.fakepedia.title,
      chunksCount: embeddedChunks.length,
      url: embeddedChunks[0]?.source || null,
    });
  } catch (error) {
    console.error("Failed to save Fakepedia article:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/external-sources/reviews", async (req, res) => {
  try {
    const { brandName = "", items = [], enabled = true } = req.body || {};
    const ext = await readExternalSources();
    const rawChunks = buildReviewChunks({ brandName, items });
    const embeddedChunks = [];

    for (const c of rawChunks) {
      const embRes = await ollama.embeddings({
        model: EMBED_MODEL,
        prompt: `${c.title}\n${c.text}`,
      });
      embeddedChunks.push({
        chunk: c.text,
        source: c.url,
        title: c.title,
        sourceType: "reviews",
        embedding: embRes.embedding,
      });
    }

    ext.reviews = {
      enabled: Boolean(enabled && embeddedChunks.length > 0),
      brandName: brandName.trim(),
      items: Array.isArray(items) ? items : [],
      updatedAt: new Date().toISOString(),
      chunks: embeddedChunks,
    };
    await writeJsonFile(EXTERNAL_SOURCES_FILE, ext);

    res.json({
      enabled: ext.reviews.enabled,
      brandName: ext.reviews.brandName,
      reviewsCount: ext.reviews.items.filter((r) => (r?.text || "").trim()).length,
      chunksCount: embeddedChunks.length,
      url: embeddedChunks[0]?.source || null,
    });
  } catch (error) {
    console.error("Failed to save reviews:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/index-status", async (req, res) => {
  try {
    const localIndex = await readJsonFile(LOCAL_INDEX_FILE);
    const customCompetitorsRaw = await readJsonFile(CUSTOM_COMPETITORS_FILE);
    const ext = await readExternalSources();
    const niches = await listAvailableNiches();
    const activeNiche = await getActiveNicheId();
    const activeNicheInfo =
      niches.find((n) => n.id === activeNiche) || null;

    const siteKeys = Object.keys(localIndex || {});
    let localSite = null;
    if (siteKeys.length > 0) {
      const siteUrl = siteKeys[0];
      const entry = localIndex[siteUrl] || {};
      const chunks = Array.isArray(entry.chunks) ? entry.chunks : [];
      const pagesCount =
        typeof entry.pagesCount === "number"
          ? entry.pagesCount
          : new Set(chunks.map((c) => c.source).filter(Boolean)).size;
      localSite = {
        url: siteUrl,
        crawledAt: entry.crawledAt || null,
        chunksCount: chunks.length,
        pagesCount,
      };
    }

    const customCompetitors = Object.entries(customCompetitorsRaw || {}).map(
      ([url, entry]) => {
        const chunks = Array.isArray(entry?.chunks) ? entry.chunks : [];
        return {
          url,
          crawledAt: entry?.crawledAt || null,
          chunksCount: chunks.length,
          pagesCount:
            typeof entry?.pagesCount === "number"
              ? entry.pagesCount
              : new Set(chunks.map((c) => c.source).filter(Boolean)).size,
        };
      },
    );

    res.json({
      localSite,
      activeNiche,
      activeNicheInfo,
      niches,
      customCompetitors,
      fakepedia: {
        enabled: !!ext.fakepedia.enabled,
        title: ext.fakepedia.title || "",
        chunksCount: ext.fakepedia.chunks.length,
      },
      reviews: {
        enabled: !!ext.reviews.enabled,
        brandName: ext.reviews.brandName || "",
        reviewsCount: ext.reviews.items.filter((r) => (r?.text || "").trim()).length,
        chunksCount: ext.reviews.chunks.length,
      },
    });
  } catch (error) {
    console.error("Failed to read index status:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/crawl", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const result = await crawlSiteToChunks(url);

    // Replace active local site while preserving active niche & custom competitors
    const index = {
      [result.normKey]: {
        crawledAt: new Date().toISOString(),
        pagesCount: result.pagesCount,
        chunks: result.chunks,
      },
    };
    await writeJsonFile(LOCAL_INDEX_FILE, index);

    res.json({
      message: `Successfully crawled site`,
      url: result.normKey,
      chunks: result.chunks.length,
      pages: result.pagesCount,
    });
  } catch (error) {
    console.error(`Failed to deep crawl site: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/competitors/crawl", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const result = await crawlSiteToChunks(url);
    const competitors = await readJsonFile(CUSTOM_COMPETITORS_FILE);
    competitors[result.normKey] = {
      crawledAt: new Date().toISOString(),
      pagesCount: result.pagesCount,
      chunks: result.chunks,
    };
    await writeJsonFile(CUSTOM_COMPETITORS_FILE, competitors);

    res.json({
      message: `Successfully crawled competitor site`,
      url: result.normKey,
      chunks: result.chunks.length,
      pages: result.pagesCount,
    });
  } catch (error) {
    console.error(`Failed to crawl competitor site: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// --- CHAT HISTORY SERVICE ---
app.get("/api/chats", async (req, res) => {
  const chats = await readJsonFile(CHATS_FILE);
  chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(chats);
});

app.get("/api/chats/:id", async (req, res) => {
  const chats = await readJsonFile(CHATS_FILE);
  const chat = chats.find((c) => c.id === req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  res.json(chat);
});

app.post("/api/chats/:id", async (req, res) => {
  const { id } = req.params;
  const {
    messages,
    targetUrl,
    userLocation,
    model = GEN_MODEL,
  } = req.body || {};

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required" });
  }

  try {
    let chats = await readJsonFile(CHATS_FILE);
    let chatIndex = chats.findIndex((c) => c.id === id);
    let chat = chatIndex !== -1 ? chats[chatIndex] : null;

    if (!chat) {
      chat = {
        id,
        title: "New Chat",
        messages: [],
        updatedAt: new Date().toISOString(),
      };
      chats.push(chat);
      chatIndex = chats.length - 1;
    }

    if (chat.messages.length === 0 && messages.length > 0 && chat.title === "New Chat") {
      const summaryTitle = messages[0].content.trim().slice(0, 30);
      chat.title = summaryTitle ? `${summaryTitle}...` : "New Chat";
    }

    const userQuery = messages[messages.length - 1].content;
    let searchQuery = userQuery;
    let requiresSearch = true;

    // Contextualize query and check search intent
    try {
      let historyText = "";
      if (messages.length >= 3) {
        historyText = `\n\nChat history:\nUser: ${messages[messages.length - 3].content}\nAssistant: ${messages[messages.length - 2].content.slice(0, 300)}...`;
      }

      const currentDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const currentYear = new Date().getFullYear();
      let locationContext = userLocation
        ? ` The user's current location is ${userLocation}.`
        : "";
      const rewritePrompt = `Rewrite the user's query into a concise search engine query, using chat history to resolve context or pronouns if needed. Output ONLY the search query.
CRITICAL RULE 1: If the user is just saying hello, greeting, thanking, or asking about bot capabilities (e.g., "hi", "how are you", "what can you do"), output exactly: NO_SEARCH.
CRITICAL RULE 2: Keep the search query focused on the essential keywords, concepts, or entities asked about. Do NOT add unnecessary fluff.
CRITICAL RULE 3: If the user explicitly asks for time-sensitive news, recent updates, or current year information, you may append the current year (${currentYear}). Otherwise, do not append dates.
CRITICAL RULE 4: If the user explicitly asks for local places or recommendations ("near me", "nearby", "local") without naming a city, and their location is known (${userLocation || "none"}), you may append the location. If they specify a location, use that. If the query is not location-specific, do NOT append a location.
CRITICAL RULE 5: ONLY use the chat history to resolve context if the user's query explicitly refers to the previous topic or contains pronouns (e.g. "what about that?", "how much does it cost?").

Example 1:
User's latest query: "Hello!"
Search query: NO_SEARCH

Example 2:
User's latest query: "what can you do?"
Search query: NO_SEARCH

Example 3:
User's latest query: "best espresso beans for dark roast"
Search query: best dark roast espresso beans

Example 4:
User's latest query: "who won the superbowl?"
Search query: superbowl winner ${currentYear}

Example 5:
Chat history:
User: Tell me about Acme Coffee
Assistant: Acme Coffee is an artisan roaster...
User's latest query: "where are they located?"
Search query: Acme Coffee location

Now do the following:
${historyText ? historyText.trim() + "\n" : ""}User's latest query: "${userQuery}"
Search query:`;

      if (messages.length <= 1 && isTrivialGreeting(userQuery)) {
        requiresSearch = false;
        searchQuery = "";
        console.log(`Intent check: Greeting does not require search.`);
      } else {
        res.write(
          `event: ${JSON.stringify({ type: "message", content: `Rewriting query for search intent...` })}\n\n`,
        );
        const rewriteRes = await ollama.chat({
          model: model,
          messages: [{ role: "user", content: rewritePrompt }],
          stream: false,
          think: false,
          format: {
            type: "object",
            properties: {
              requires_search: { type: "boolean" },
              search_query: { type: "string" },
            },
            required: ["requires_search", "search_query"],
          },
          options: { temperature: 0, num_predict: 80 },
        });

        const rawRewrite = (rewriteRes.message?.content || "").trim();
        let parsedRewrite = null;
        try {
          parsedRewrite = JSON.parse(rawRewrite);
        } catch {}

        if (parsedRewrite && typeof parsedRewrite.requires_search === "boolean") {
          if (!parsedRewrite.requires_search) {
            requiresSearch = false;
            searchQuery = "";
            console.log(`Intent check: Query does not require search.`);
          } else if (
            parsedRewrite.search_query &&
            parsedRewrite.search_query.trim().length < 150
          ) {
            searchQuery = parsedRewrite.search_query.trim();
            console.log(`Rewrote query for search: "${searchQuery}"`);
          }
        } else {
          const rewritten = rawRewrite
            .replace(/["']/g, "")
            .split("\n")[0]
            .replace(/^Search query:\s*/i, "")
            .trim();
          if (
            rewritten.toUpperCase() === "NO_SEARCH" ||
            rewritten.toUpperCase() === "IGNORE_SEARCH"
          ) {
            requiresSearch = false;
            searchQuery = "";
          } else if (rewritten && rewritten.length < 150) {
            searchQuery = rewritten;
            console.log(`Rewrote query for search: "${searchQuery}"`);
          }
        }
      }
    } catch (e) {
      console.error(
        "Query rewrite/intent check failed, falling back to original query",
        e,
      );
    }

    // 1. Offline / Corpus-Backed RAG Search Loop (No external search engine rate limits)
    let combinedIndices = [];
    let localChunks = [];
    let simulatedExternalChunks = [];
    let competitorChunks = [];
    if (requiresSearch) {
      const localCheck = await readJsonFile(LOCAL_INDEX_FILE);
      const customCompetitors = await readJsonFile(CUSTOM_COMPETITORS_FILE);
      const extSources = await readExternalSources();
      const activeNiche = await getActiveNicheId();

      res.write(
        `event: ${JSON.stringify({ type: "message", content: `Searching index for "${searchQuery}"...` })}\n\n`,
      );

      // Load student's target site chunks
      for (const key of Object.keys(localCheck || {})) {
        if (Array.isArray(localCheck[key]?.chunks)) {
          const local = localCheck[key].chunks.map((c) => {
            let actualSource = c.source || key;
            let actualChunk = c.chunk;
            const match = actualChunk.match(/--- Page: (.*?) ---/);
            if (match && match[1]) {
              actualSource = match[1].trim().split(" ")[0];
              actualChunk = actualChunk
                .replace(/--- Page: .*? ---\n/, "")
                .trim();
            }
            return {
              chunk: actualChunk,
              embedding: c.embedding,
              source: actualSource,
              title: c.title,
              isLocal: true,
              sourceType: "target",
            };
          });
          localChunks = localChunks.concat(local);
        }
      }

      // Load simulated external sources (Fakepedia & Totally Unbiased Reviews) when enabled
      if (extSources.fakepedia.enabled && extSources.fakepedia.chunks.length > 0) {
        simulatedExternalChunks = simulatedExternalChunks.concat(
          extSources.fakepedia.chunks.map((c) => ({
            chunk: c.chunk,
            embedding: c.embedding,
            source: c.source,
            title: c.title,
            isLocal: false,
            sourceType: "fakepedia",
          })),
        );
      }
      if (extSources.reviews.enabled && extSources.reviews.chunks.length > 0) {
        simulatedExternalChunks = simulatedExternalChunks.concat(
          extSources.reviews.chunks.map((c) => ({
            chunk: c.chunk,
            embedding: c.embedding,
            source: c.source,
            title: c.title,
            isLocal: false,
            sourceType: "reviews",
          })),
        );
      }

      // Load pre-crawled niche competitor corpus (if active)
      if (activeNiche && activeNiche !== "custom") {
        try {
          const nicheChunks = await loadNicheCorpusChunks(activeNiche);
          competitorChunks = competitorChunks.concat(
            nicheChunks.map((c) => ({ ...c, sourceType: "competitor" })),
          );
        } catch (err) {
          console.error(`Failed to load corpus "${activeNiche}":`, err.message);
        }
      }

      // Load any optional manually-crawled custom competitors
      for (const key of Object.keys(customCompetitors || {})) {
        if (Array.isArray(customCompetitors[key]?.chunks)) {
          const custom = customCompetitors[key].chunks.map((c) => ({
            chunk: c.chunk,
            embedding: c.embedding,
            source: c.source || key,
            title: c.title,
            isLocal: false,
            sourceType: "competitor",
          }));
          competitorChunks = competitorChunks.concat(custom);
        }
      }

      combinedIndices = [
        ...localChunks,
        ...simulatedExternalChunks,
        ...competitorChunks,
      ];
      console.log(
        `Search pool: ${localChunks.length} target + ${simulatedExternalChunks.length} simulated external + ${competitorChunks.length} competitor chunks (niche: ${activeNiche})`,
      );
    }

    let attempts = 0;
    let maxAttempts = requiresSearch ? 2 : 1;
    let foundAnswer = !requiresSearch;
    let currentSearchQuery = searchQuery;
    let queriesAttempted = requiresSearch && searchQuery ? [searchQuery] : [];
    let selectedChunks = [];
    let topK = [];
    let finalRelevantIndices = null;

    while (attempts < maxAttempts && !foundAnswer && combinedIndices.length > 0) {
      attempts++;
      let qEmbed = null;
      try {
        qEmbed = await ollama.embeddings({
          model: EMBED_MODEL,
          prompt: currentSearchQuery || userQuery,
        });
      } catch (e) {
        console.error("Embed failed", e);
        break;
      }

      const queryEmbedding = qEmbed.embedding;

      // Score combinedIndices fairly (same chunking & embedding model across target + competitors)
      for (const item of combinedIndices) {
        item.similarity = cosineSimilarity(queryEmbedding, item.embedding);
      }
      combinedIndices.sort((a, b) => b.similarity - a.similarity);

      topK = selectDiverseTopK(combinedIndices, 8, 2, {
        __target__: 2,
        __fakepedia__: 1,
        __reviews__: 1,
      });
      const contextText = topK
        .map((c, i) => `[[${i + 1}]] ${c.title || c.source}\n${c.chunk}`)
        .join("\n\n");

      // Evaluate if context has answer
      res.write(
        `event: ${JSON.stringify({ type: "message", content: `Evaluating retrieved snippets...` })}\n\n`,
      );
      if (contextText.trim().length > 0) {
        const evalPrompt = `You are a strict relevance evaluator for a search engine.
Context:
${contextText}

Question: "${currentSearchQuery}"
(Original User Input: "${userQuery}")

Return JSON with "relevant_sources": an array of 1-based source numbers (from 1 to ${topK.length}) that contain factual information, specifications, descriptions, or answers directly relevant to the Question. Exclude completely off-topic or vague filler sources. Return an empty array [] if none are relevant.`;
        const evalRes = await ollama.chat({
          model: model,
          messages: [{ role: "user", content: evalPrompt }],
          stream: false,
          think: false,
          format: {
            type: "object",
            properties: {
              relevant_sources: {
                type: "array",
                items: { type: "integer" },
              },
            },
            required: ["relevant_sources"],
          },
          options: { temperature: 0, num_predict: 60 },
        });
        const contentText = (evalRes.message?.content || "").trim();
        const thinkingText = (evalRes.message?.thinking || "").trim();
        console.log(`Evaluator decision: ${contentText}`);

        let evalDecision = { relevant: false, indices: [] };
        try {
          const parsed = JSON.parse(contentText);
          if (parsed && Array.isArray(parsed.relevant_sources)) {
            const seen = new Set();
            const indices = [];
            for (const n of parsed.relevant_sources) {
              const idx = Number(n) - 1;
              if (Number.isInteger(idx) && idx >= 0 && idx < topK.length && !seen.has(idx)) {
                seen.add(idx);
                indices.push(idx);
              }
            }
            evalDecision = { relevant: indices.length > 0, indices };
          }
        } catch {
          evalDecision = parseEvaluatorResponse(
            contentText,
            thinkingText,
            topK.length,
          );
        }

        if (evalDecision.relevant) {
          console.log(
            `Agent loop: Index contained answer on attempt ${attempts}. (indices: ${evalDecision.indices.map((i) => i + 1).join(", ")})`,
          );
          finalRelevantIndices = evalDecision.indices;
          foundAnswer = true;
          break;
        }
      }

      // Retry once with a broader / reformulated query if attempt 1 was rejected
      if (attempts < maxAttempts) {
        res.write(
          `event: ${JSON.stringify({ type: "message", content: `Reformulating search query...` })}\n\n`,
        );
        const locationHint = userLocation
          ? ` If the user is asking for local information, include their location (${userLocation}).`
          : "";
        const newQueryPrompt = `The search query "${currentSearchQuery}" did not find relevant results for: "${userQuery}". Generate a DIFFERENT, broader search query focusing on the core product category, domain concepts, or named alternatives. Output ONLY the new search query.${locationHint}

Failed Query: "${currentSearchQuery}"
User Question: "${userQuery}"
New Search Query:`;
        const newQueryRes = await ollama.chat({
          model: model,
          messages: [{ role: "user", content: newQueryPrompt }],
          stream: false,
          think: false,
          format: {
            type: "object",
            properties: {
              search_query: { type: "string" },
            },
            required: ["search_query"],
          },
          options: { temperature: 0, num_predict: 60 },
        });
        const rawNewQuery = (newQueryRes.message?.content || "").trim();
        let cleaned = "";
        try {
          const parsed = JSON.parse(rawNewQuery);
          if (parsed && typeof parsed.search_query === "string") {
            cleaned = parsed.search_query.trim();
          }
        } catch {
          cleaned = rawNewQuery
            .replace(/["']/g, "")
            .split("\n")[0]
            .replace(/^.*New Search Query:\s*/i, "")
            .trim();
        }
        if (cleaned) {
          currentSearchQuery = cleaned;
          queriesAttempted.push(currentSearchQuery);
        }
      }
    }

    // Extract top accepted sources for LLM (up to 6 to keep small-LLM reasoning fast & complete)
    if (requiresSearch && foundAnswer) {
      if (finalRelevantIndices) {
        selectedChunks = finalRelevantIndices.slice(0, 6).map((i) => ({
          ...topK[i],
          originalIndex: i,
        }));
      } else {
        selectedChunks = topK
          .slice(0, 6)
          .map((c, i) => ({ ...c, originalIndex: i }));
      }
    } else if (requiresSearch && !foundAnswer) {
      selectedChunks = [
        {
          source: "Search System",
          title: "Search Results",
          chunk: "No relevant information was found for this query.",
          originalIndex: 0,
        },
      ];
    }
    // We explicitly DO NOT clear or mutate topK here, so the frontend UI can still display all evaluated sources (both accepted and rejected).
    topK = topK.map((c, i) => ({
      chunk: c.chunk,
      source: c.source,
      isLocal: c.isLocal,
      sourceType: c.sourceType || (c.isLocal ? "target" : "competitor"),
      similarity: c.similarity || 0,
      isRelevant: finalRelevantIndices
        ? finalRelevantIndices.includes(i)
        : false,
    }));

    res.write(
      `event: ${JSON.stringify({ type: "message", content: `Generating response...` })}\n\n`,
    );

    // Prepare Context for Final Generation
    const currentDateStr = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    let finalLocationContext = userLocation
      ? ` The user's current location is ${userLocation}.`
      : "";
    let systemContent = `You are FakeGPT, a highly descriptive, friendly, and engaging AI chatbot. Your knowledge cutoff is December 2023, but you are equipped with powerful agentic tools to overcome this! Today's date is ${currentDateStr}.${finalLocationContext}

YOUR CAPABILITIES:
- You have an autonomous Agentic Search Loop that can query a real-time web search engine to find up-to-date information.
- You can crawl and read full web pages to deeply understand topics.
If the user asks what you can do, proudly describe these capabilities!

You have been provided with 'Context' retrieved from your search engine. 
CRITICAL RULE: For any factual question, you MUST base your answer SOLELY on the provided Context. DO NOT use your internal general knowledge to answer factual questions. If the provided Context does not contain the answer, you must state that you couldn't find the information in the current search results.
SOURCE RELIABILITY RULE: When answering recommendation or comparison questions, treat independent third-party sources (such as Wikipedia, Trustpilot customer reviews, and independent testing/review sites) and agreement across multiple independent sources as more reliable than self-promotional claims made only on a brand's own website.
DO NOT say "Based on the context" or "In the text you shared". Just answer naturally as if you found it online.
When asked for news briefs or summaries, be highly comprehensive and provide detailed information extracted from the sources.

CRITICAL: At the end of EVERY response, ask a friendly follow-up question to keep the conversation engaging.`;
    if (selectedChunks.length > 0) {
      let contextText = "";
      selectedChunks.forEach((c) => {
        let displayIdx =
          c.originalIndex !== undefined ? c.originalIndex + 1 : 1;
        let header = `SOURCE [[${displayIdx}]] URL: ${c.source}`;
        if (c.title) header += ` TITLE: ${c.title}`;
        contextText += `${header}\n${c.chunk}\n\n`;
      });
      systemContent += `\n\nContext:\n${contextText}\n\nCRITICAL CITATION RULES:
1. You MUST add a citation at the end of EVERY factual sentence you write.
2. Format your citations EXACTLY like this example: "Spain won the tournament in 2026 [[1]](https://worldcupwiki.com)."
3. The citation MUST be a markdown link using the SOURCE number and URL provided above. Do NOT write the website name.
4. If a sentence uses information from multiple sources, cite them all: [[1]](URL) [[2]](URL).
5. Do NOT generate a reference list at the end of your response. ONLY use inline citations.
6. Do NOT invent citations to URLs or sources that are not explicitly provided in the Context above.
7. If the provided Context does not contain the answer, you MUST say 'I cannot find the answer in the current search results' instead of using your own knowledge.`;
    }

    const ollamaMessages = [
      { role: "system", content: systemContent },
      ...messages.map((m, i) => {
        if (i === messages.length - 1 && selectedChunks.length > 0) {
          return {
            role: m.role,
            content:
              m.content +
              "\n\n(Reminder: Base your answer strictly on the provided Context. Add a citation at the end of EVERY factual sentence using the format [[1]](URL). Do not list references at the end.)",
          };
        }
        return { role: m.role, content: m.content };
      }),
    ];

    let fullContent = "";

    console.log(
      `Thinking: ${isThinking ? "Enabled" : "Disabled"}. Streaming response...`,
    );
    const stream = await ollama.chat({
      model: model,
      messages: ollamaMessages,
      stream: true,
      think: isThinking,
      options: {
        num_ctx: 8192,
        num_predict: 6144,
      },
    });

    for await (const chunk of stream) {
      if (chunk.message.content) {
        fullContent += chunk.message.content;
        res.write(
          `data: ${JSON.stringify({ content: chunk.message.content })}\n\n`,
        );
      } else if (chunk.message.thinking) {
        res.write(
          `data: ${JSON.stringify({ thinking: chunk.message.thinking })}\n\n`,
        );
      }
    }

    if (topK && topK.length > 0) {
      res.write(
        `data: ${JSON.stringify({ sources: topK, rewrittenQuery: queriesAttempted.length > 0 ? queriesAttempted.join(" ➔ ") : searchQuery })}\n\n`,
      );
    } else {
      res.write(
        `data: ${JSON.stringify({ sources: [], rewrittenQuery: queriesAttempted.length > 0 ? queriesAttempted.join(" ➔ ") : searchQuery })}\n\n`,
      );
    }

    res.write("data: [DONE]\n\n");
    res.end();

    const newMessages = [
      ...messages,
      {
        role: "assistant",
        content: fullContent,
        sources: topK || [],
        rewrittenQuery:
          queriesAttempted.length > 0
            ? queriesAttempted.join(" ➔ ")
            : searchQuery,
      },
    ];
    chat.messages = newMessages;
    chat.updatedAt = new Date().toISOString();
    chats[chatIndex] = chat;

    await writeJsonFile(CHATS_FILE, chats);
  } catch (error) {
    console.error("Chat error:", error);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

app.post("/api/chats/:id/title", async (req, res) => {
  const { id } = req.params;
  const model = req.body?.model || GEN_MODEL;
  try {
    let chats = await readJsonFile(CHATS_FILE);
    let chatIndex = chats.findIndex((c) => c.id === id);
    if (chatIndex === -1)
      return res.status(404).json({ error: "Chat not found" });

    const chat = chats[chatIndex];
    if (chat.messages.length === 0) return res.json({ title: chat.title });

    // Use recent messages (up to 6) for context
    const recentMessages = chat.messages
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    const titlePrompt = `Generate a very brief, concise title (max 5 words) for this conversation based on this recent exchange:\n\n${recentMessages}\n\nTitle:`;

    const titleRes = await ollama.chat({
      model: model,
      messages: [{ role: "user", content: titlePrompt }],
      stream: false,
    });

    chat.title = titleRes.message.content.replace(/["*]/g, "").trim();
    chat.updatedAt = new Date().toISOString();
    chats[chatIndex] = chat;
    await writeJsonFile(CHATS_FILE, chats);

    res.json({ success: true, title: chat.title });
  } catch (error) {
    console.error("Title generation error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/chats/:id", async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;
  try {
    let chats = await readJsonFile(CHATS_FILE);
    let chatIndex = chats.findIndex((c) => c.id === id);
    if (chatIndex === -1)
      return res.status(404).json({ error: "Chat not found" });

    if (title) chats[chatIndex].title = title;
    chats[chatIndex].updatedAt = new Date().toISOString();
    await writeJsonFile(CHATS_FILE, chats);
    res.json({ success: true, chat: chats[chatIndex] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/chats/:id", async (req, res) => {
  const { id } = req.params;
  try {
    let chats = await readJsonFile(CHATS_FILE);
    chats = chats.filter((c) => c.id !== id);
    await writeJsonFile(CHATS_FILE, chats);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear Data Routes
app.post("/api/clear-history", async (req, res) => {
  try {
    await writeJsonFile(CHATS_FILE, []);
    res.json({ success: true });
  } catch (error) {
    console.error("Clear history error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/clear-local-index", async (req, res) => {
  try {
    await writeJsonFile(LOCAL_INDEX_FILE, {});
    res.json({ success: true });
  } catch (error) {
    console.error("Clear local index error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/clear-competitors", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (url) {
      const competitors = await readJsonFile(CUSTOM_COMPETITORS_FILE);
      delete competitors[url];
      await writeJsonFile(CUSTOM_COMPETITORS_FILE, competitors);
    } else {
      await writeJsonFile(CUSTOM_COMPETITORS_FILE, {});
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Clear competitors error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/clear-index", async (req, res) => {
  try {
    await writeJsonFile(LOCAL_INDEX_FILE, {});
    await writeJsonFile(CUSTOM_COMPETITORS_FILE, {});
    res.json({ success: true });
  } catch (error) {
    console.error("Clear index error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Catch-all route to serve the React SPA for any unmatched paths
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api")) {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
  } else {
    next();
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`FakeGPT backend running on port ${PORT}`);
});
