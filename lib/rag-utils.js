import * as cheerio from "cheerio";

export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function normalizeQueryKey(q) {
  if (!q) return "";
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeSiteUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    let p = u.pathname;
    if (p.endsWith("/") && p.length > 1) {
      p = p.slice(0, -1);
    }
    return `${u.protocol}//${u.host}${p === "/" ? "" : p}`;
  } catch {
    return (rawUrl || "").trim().replace(/\/+$/, "");
  }
}

/**
 * Returns the directory URL prefix (always ending with "/") that crawling
 * should stay within, preventing /after/ crawls on GitHub Pages or DSV web
 * from bleeding into /before/ or other users' pages on the same origin.
 */
export function getSitePrefix(rawUrl) {
  const u = new URL(rawUrl);
  let pathname = u.pathname || "/";
  if (!pathname.endsWith("/")) {
    const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
    if (lastSegment.includes(".")) {
      pathname = pathname.slice(0, pathname.lastIndexOf("/") + 1);
    } else {
      pathname = `${pathname}/`;
    }
  }
  return `${u.origin}${pathname}`;
}

export function isUrlWithinPrefix(candidateUrl, prefix, startUrl) {
  try {
    const cand = new URL(candidateUrl);
    const pref = new URL(prefix);
    if (cand.origin !== pref.origin) return false;
    if (startUrl && normalizeSiteUrl(candidateUrl) === normalizeSiteUrl(startUrl)) {
      return true;
    }
    const candPath = `${cand.origin}${cand.pathname}`;
    const trimmedPrefix = prefix.endsWith("/") && prefix.length > pref.origin.length + 1
      ? prefix.slice(0, -1)
      : prefix;
    return candPath.startsWith(prefix) || candPath === trimmedPrefix;
  } catch {
    return false;
  }
}

export function getSitemapCandidates(rawUrl) {
  const u = new URL(rawUrl);
  const prefix = getSitePrefix(rawUrl);
  const candidates = [`${prefix}sitemap.xml`];
  const rootSitemap = `${u.origin}/sitemap.xml`;
  if (prefix === `${u.origin}/` && !candidates.includes(rootSitemap)) {
    candidates.push(rootSitemap);
  }
  return candidates;
}

export function chunkSectionText(text, heading, url, title, targetArray, maxLen = 500) {
  const prefix = heading && heading !== title ? `[${heading}] ` : "";
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentChunk = "";

  for (let sentence of sentences) {
    sentence = sentence.trim();
    if (!sentence) continue;

    if (
      (currentChunk + " " + sentence).length > maxLen &&
      currentChunk.length > 0
    ) {
      targetArray.push({
        text: `${prefix}${currentChunk.trim()}`,
        url,
        title,
      });
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }
  if (currentChunk.trim().length > 0) {
    targetArray.push({
      text: `${prefix}${currentChunk.trim()}`,
      url,
      title,
    });
  }
}

function cleanText(str) {
  return (str || "").replace(/\s+/g, " ").trim();
}

function formatTableRows($, tableEl) {
  const rows = [];
  const headers = [];

  const theadThs = $(tableEl).find("thead tr").first().find("th");
  if (theadThs.length > 0) {
    theadThs.each((_, th) => headers.push(cleanText($(th).text())));
  } else {
    const firstRow = $(tableEl).find("tr").first();
    const firstRowThs = firstRow.find("th");
    const firstRowTds = firstRow.find("td");
    if (firstRowThs.length > 0 && firstRowTds.length === 0) {
      firstRowThs.each((_, th) => headers.push(cleanText($(th).text())));
    }
  }

  $(tableEl)
    .find("tr")
    .each((_, tr) => {
      const cells = [];
      $(tr)
        .find("th, td")
        .each((__, cell) => cells.push(cleanText($(cell).text())));

      // Skip pure header row if we already captured headers
      const hasTd = $(tr).find("td").length > 0;
      if (!hasTd) return;

      const nonEmpty = cells.some((c) => c.length > 0);
      if (!nonEmpty) return;

      if (headers.length > 0 && headers.length === cells.length) {
        const paired = headers
          .map((h, i) => (h ? `${h}: ${cells[i]}` : cells[i]))
          .filter(Boolean)
          .join(" | ");
        rows.push(paired);
      } else {
        rows.push(cells.filter(Boolean).join(" | "));
      }
    });

  return rows;
}

function formatDefinitionList($, dlEl) {
  const entries = [];
  let currentTerm = "";
  let currentDefs = [];

  $(dlEl)
    .children("dt, dd, div")
    .each((_, child) => {
      const tag = child.tagName.toLowerCase();
      if (tag === "div") {
        // HTML allows <div> wrappers around <dt>/<dd> groups
        const term = cleanText($(child).find("dt").first().text());
        const defs = [];
        $(child)
          .find("dd")
          .each((__, dd) => {
            const d = cleanText($(dd).text());
            if (d) defs.push(d);
          });
        if (term && defs.length > 0) {
          entries.push(`${term}: ${defs.join("; ")}.`);
        } else if (term) {
          entries.push(`${term}.`);
        }
        return;
      }

      if (tag === "dt") {
        if (currentTerm) {
          entries.push(
            currentDefs.length > 0
              ? `${currentTerm}: ${currentDefs.join("; ")}.`
              : `${currentTerm}.`,
          );
        }
        currentTerm = cleanText($(child).text());
        currentDefs = [];
      } else if (tag === "dd") {
        const d = cleanText($(child).text());
        if (d) currentDefs.push(d);
      }
    });

  if (currentTerm) {
    entries.push(
      currentDefs.length > 0
        ? `${currentTerm}: ${currentDefs.join("; ")}.`
        : `${currentTerm}.`,
    );
  }
  return entries;
}

/**
 * Extracts structured GEO/SEO chunks from an HTML page:
 * - Meta description
 * - Schema.org JSON-LD blocks
 * - Semantic main/article prioritized content including H1-H4, paragraphs,
 *   lists, blockquotes, definition lists (<dl>), and comparison tables (<table>)
 * - Preserves <header> elements inside <main>/<article> or containing <h1>
 */
export function extractChunksFromHtml(html, pageUrl) {
  const $ = cheerio.load(html || "");
  const rawChunks = [];
  const title = cleanText($("title").text()) || pageUrl;

  // 1. Meta Description
  const metaDesc =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";
  if (cleanText(metaDesc).length > 10) {
    rawChunks.push({
      text: `Meta Description: ${cleanText(metaDesc)}`,
      url: pageUrl,
      title,
    });
  }

  // 2. JSON-LD Structured Data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).text().trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        rawChunks.push({
          text: `Structured Data (JSON-LD): ${JSON.stringify(parsed)}`,
          url: pageUrl,
          title,
        });
      }
    } catch {
      // Ignore malformed JSON-LD
    }
  });

  // 3. Remove non-content elements without destroying <article><header> or <h1>
  $("script, style, noscript, template, nav, footer, aside, .skip-link, a[href^='#']").remove();
  $("header").each((_, el) => {
    const insideMainOrArticle = $(el).closest("main, article").length > 0;
    const containsH1 = $(el).find("h1").length > 0;
    if (!insideMainOrArticle && !containsH1) {
      $(el).remove();
    }
  });

  // 4. Prioritize semantic main content area (<main>, then <article>, else <body>)
  let root = $("body");
  if ($("main").length > 0 && cleanText($("main").text()).length > 0) {
    root = $("main");
  } else if ($("article").length > 0 && cleanText($("article").text()).length > 0) {
    root = $("article");
  }

  let currentHeading = title;
  let sectionText = "";
  const initialChunkCount = rawChunks.length;

  const flushSection = () => {
    if (sectionText.trim().length > 0) {
      chunkSectionText(sectionText, currentHeading, pageUrl, title, rawChunks);
      sectionText = "";
    }
  };

  root.find("h1, h2, h3, h4, p, li, blockquote, table, dl").each((_, el) => {
    const tag = el.tagName.toLowerCase();

    // Skip elements already handled inside table or dl
    if (tag !== "table" && $(el).closest("table").length > 0) return;
    if (tag !== "dl" && $(el).closest("dl").length > 0) return;

    // Avoid duplicating <p> nested inside <li> or <blockquote>
    if (tag === "p" && $(el).closest("li, blockquote").length > 0) return;

    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") {
      const headingText = cleanText($(el).text());
      if (!headingText) return;
      flushSection();
      currentHeading = headingText;
      return;
    }

    if (tag === "table") {
      flushSection();
      const rows = formatTableRows($, el);
      const prefix = currentHeading && currentHeading !== title ? `[${currentHeading}] ` : "";
      let tableChunk = "";
      for (const row of rows) {
        if ((tableChunk + "\n" + row).length > 500 && tableChunk.length > 0) {
          rawChunks.push({ text: `${prefix}${tableChunk}`, url: pageUrl, title });
          tableChunk = row;
        } else {
          tableChunk += (tableChunk ? "\n" : "") + row;
        }
      }
      if (tableChunk.length > 0) {
        rawChunks.push({ text: `${prefix}${tableChunk}`, url: pageUrl, title });
      }
      return;
    }

    if (tag === "dl") {
      flushSection();
      const entries = formatDefinitionList($, el);
      if (entries.length > 0) {
        chunkSectionText(entries.join(" "), currentHeading, pageUrl, title, rawChunks);
      }
      return;
    }

    let elText = "";
    if (tag === "li") {
      elText = cleanText($(el).clone().children("ul, ol").remove().end().text());
    } else {
      elText = cleanText($(el).text());
    }
    if (!elText) return;

    sectionText += (sectionText ? " " : "") + elText;
    if (sectionText.length > 500) {
      flushSection();
    }
  });

  flushSection();

  // 5. Fallback for unstructured pages (e.g., plain <div> layouts)
  if (rawChunks.length === initialChunkCount) {
    let text = cleanText(root.text());
    text = text.replace(/Skip to content/gi, "").trim();
    if (text.length > 0) {
      chunkSectionText(text, title, pageUrl, title, rawChunks);
    }
  }

  return { title, chunks: rawChunks };
}

/**
 * Parses relevance evaluator LLM output (e.g. "YES: 1, 3" or "NO").
 * Only extracts numbers appearing after the last "YES" token to avoid picking
 * up numbers mentioned in reasoning text.
 */
export function parseEvaluatorResponse(contentText, thinkingText, topKLength) {
  const cleanContent = (contentText || "").trim();
  const cleanThinking = (thinkingText || "").trim();
  const primary = cleanContent || cleanThinking;
  const upper = primary.toUpperCase();

  const yesMatches = [...upper.matchAll(/\bYES\b/g)];
  if (yesMatches.length === 0) {
    return { relevant: false, indices: [] };
  }

  const lastYesPos = yesMatches[yesMatches.length - 1].index;
  const tail = primary.slice(lastYesPos);
  const firstLineOfTail = tail.split("\n")[0];
  const numberMatches = firstLineOfTail.match(/\d+/g) || tail.match(/\d+/g) || [];

  const seen = new Set();
  const indices = [];
  for (const m of numberMatches) {
    const idx = parseInt(m, 10) - 1;
    if (idx >= 0 && idx < topKLength && !seen.has(idx)) {
      seen.add(idx);
      indices.push(idx);
    }
  }

  if (indices.length === 0 && topKLength > 0) {
    return { relevant: true, indices: [0] };
  }
  return { relevant: true, indices };
}

export function isTrivialGreeting(query) {
  const q = (query || "").trim();
  return /^(hi|hello|hey|greetings|thanks|thank you|good morning|good afternoon|good evening|how are you|what can you do|who are you)[!.,?\s]*$/i.test(
    q,
  );
}
