import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  cosineSimilarity,
  normalizeQueryKey,
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
} from "../lib/rag-utils.js";

test("cosineSimilarity computes expected values", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity(null, [1, 1]), 0);
});

test("normalizeQueryKey and normalizeSiteUrl normalize cleanly", () => {
  assert.equal(normalizeQueryKey("  Best   Blanket \n "), "best blanket");
  assert.equal(
    normalizeSiteUrl("https://people.dsv.su.se/~stud/after/"),
    "https://people.dsv.su.se/~stud/after",
  );
  assert.equal(normalizeSiteUrl("http://localhost:8000/"), "http://localhost:8000");
});

test("getSitePrefix and isUrlWithinPrefix prevent /after/ from crawling /before/", () => {
  const startUrl = "https://people.dsv.su.se/~stud1234/after/index.html";
  const prefix = getSitePrefix(startUrl);
  assert.equal(prefix, "https://people.dsv.su.se/~stud1234/after/");

  assert.equal(
    isUrlWithinPrefix("https://people.dsv.su.se/~stud1234/after/specs.html", prefix, startUrl),
    true,
  );
  assert.equal(
    isUrlWithinPrefix("https://people.dsv.su.se/~stud1234/after", prefix, startUrl),
    true,
  );
  assert.equal(
    isUrlWithinPrefix("https://people.dsv.su.se/~stud1234/before/index.html", prefix, startUrl),
    false,
  );
  assert.equal(
    isUrlWithinPrefix("https://people.dsv.su.se/~stud1234/after-copy/index.html", prefix, startUrl),
    false,
  );
  assert.equal(
    isUrlWithinPrefix("https://other.example.com/~stud1234/after/index.html", prefix, startUrl),
    false,
  );
});

test("getSitemapCandidates scopes to directory prefix and supports direct sitemap.xml URLs", () => {
  assert.deepEqual(
    getSitemapCandidates("https://people.dsv.su.se/~stud1234/after/"),
    ["https://people.dsv.su.se/~stud1234/after/sitemap.xml"],
  );
  assert.deepEqual(
    getSitemapCandidates("https://people.dsv.su.se/~stud1234/after/sitemap.xml"),
    ["https://people.dsv.su.se/~stud1234/after/sitemap.xml"],
  );
  assert.equal(
    isSitemapUrl("https://people.dsv.su.se/~stud1234/after/sitemap.xml"),
    true,
  );
  assert.equal(
    isSitemapUrl("https://people.dsv.su.se/~stud1234/after/index.html"),
    false,
  );
  const xml = `<urlset>
    <url><loc>https://people.dsv.su.se/~stud1234/after/index.html</loc></url>
    <url><loc>https://people.dsv.su.se/~stud1234/after/specs.html</loc></url>
    <url><loc>https://people.dsv.su.se/~stud1234/before/index.html</loc></url>
  </urlset>`;
  const prefix = getSitePrefix("https://people.dsv.su.se/~stud1234/after/sitemap.xml");
  assert.deepEqual(
    parseSitemapUrls(xml, prefix, "https://people.dsv.su.se/~stud1234/after/sitemap.xml"),
    [
      "https://people.dsv.su.se/~stud1234/after/index.html",
      "https://people.dsv.su.se/~stud1234/after/specs.html",
    ],
  );
});

test("extractChunksFromHtml preserves <article><header><h1>, decimals, and summary in demo/optimized/index.html", () => {
  const demoHtml = fs.readFileSync(
    path.join(process.cwd(), "demo/optimized/index.html"),
    "utf-8",
  );
  const { title, chunks } = extractChunksFromHtml(
    demoHtml,
    "http://localhost:8088/optimized/",
  );
  assert.match(title, /NordicSleep/);
  const joined = chunks.map((c) => c.text).join("\n");
  assert.match(joined, /\[NordicSleep Organic Linen Weighted Blanket for Hot Sleepers\]/);
  assert.match(joined, /0\.8mm micro-glass beads/);
  assert.match(joined, /TOG 1\.5 thermal rating/);
  assert.match(joined, /6\.0 kg, 7\.5 kg, and 9\.0 kg/);
  assert.match(joined, /Structured Data \(JSON-LD\)/);
  assert.match(joined, /Meta Description:/);
});

test("extractChunksFromHtml extracts comparison <table> and <dl> without duplicating nested <p>", () => {
  const html = `<!DOCTYPE html>
  <html>
    <head><title>BrandX Specs</title></head>
    <body>
      <header><nav><a href="/">Home</a></nav></header>
      <main>
        <article>
          <header>
            <h1>BrandX Comparison</h1>
            <p>BrandX leads in cooling efficiency.</p>
          </header>
          <h2>Technical Specifications</h2>
          <dl>
            <dt>Battery Capacity</dt><dd>5000 mAh</dd>
            <dt>Weight</dt><dd>189 grams</dd>
          </dl>
          <h2>Model Comparison</h2>
          <table>
            <thead><tr><th>Brand</th><th>Breathability</th><th>Price</th></tr></thead>
            <tbody>
              <tr><td>BrandX</td><td>3x airflow</td><td>$189</td></tr>
              <tr><td>GenericCo</td><td>1x airflow</td><td>$159</td></tr>
            </tbody>
          </table>
          <ul>
            <li><p>Single nested bullet item.</p></li>
          </ul>
        </article>
      </main>
      <footer>Copyright 2026</footer>
    </body>
  </html>`;

  const { chunks } = extractChunksFromHtml(html, "https://example.com/specs.html");
  const joined = chunks.map((c) => c.text).join("\n");

  // Navbar and footer stripped
  assert.doesNotMatch(joined, /Copyright 2026/);
  // Article header preserved
  assert.match(joined, /\[BrandX Comparison\] BrandX leads in cooling efficiency\./);
  // Definition list formatted as key: value
  assert.match(joined, /Battery Capacity: 5000 mAh\./);
  assert.match(joined, /Weight: 189 grams\./);
  // Table extracted with column headers paired
  assert.match(joined, /Brand: BrandX \| Breathability: 3x airflow \| Price: \$189/);
  assert.match(joined, /Brand: GenericCo \| Breathability: 1x airflow \| Price: \$159/);
  // Nested <p> inside <li> not duplicated
  const bulletMatches = joined.match(/Single nested bullet item\./g) || [];
  assert.equal(bulletMatches.length, 1);
});

test("extractChunksFromHtml falls back cleanly on unstructured <div> pages", () => {
  const demoUnopt = fs.readFileSync(
    path.join(process.cwd(), "demo/unoptimized/index.html"),
    "utf-8",
  );
  const { chunks } = extractChunksFromHtml(
    demoUnopt,
    "http://localhost:8088/unoptimized/",
  );
  assert.ok(chunks.length >= 1);
  assert.match(chunks.map((c) => c.text).join(" "), /Welcome to our lifestyle store/);
});

test("parseEvaluatorResponse isolates indices after YES and ignores earlier reasoning numbers", () => {
  assert.deepEqual(parseEvaluatorResponse("NO", "", 5), {
    relevant: false,
    indices: [],
  });
  assert.deepEqual(
    parseEvaluatorResponse("After reviewing sources 1, 2, 3, 4, 5: YES: 2, 4", "", 5),
    { relevant: true, indices: [1, 3] },
  );
  assert.deepEqual(parseEvaluatorResponse("YES: 1, 1, 99", "", 3), {
    relevant: true,
    indices: [0],
  });
  assert.deepEqual(parseEvaluatorResponse("", "Thinking... YES: 3", 5), {
    relevant: true,
    indices: [2],
  });
  assert.deepEqual(parseEvaluatorResponse("YES", "", 5), {
    relevant: true,
    indices: [0],
  });
});

test("isTrivialGreeting matches greetings and allows real questions", () => {
  assert.equal(isTrivialGreeting("Hello!"), true);
  assert.equal(isTrivialGreeting("What can you do?"), true);
  assert.equal(
    isTrivialGreeting("Hey, what is the best weighted blanket for hot sleepers?"),
    false,
  );
});

test("canonicalizeCrawlUrl deduplicates / and /index.html", () => {
  assert.equal(
    canonicalizeCrawlUrl("http://localhost:8088/optimized/"),
    canonicalizeCrawlUrl("http://localhost:8088/optimized/index.html"),
  );
  assert.equal(
    canonicalizeCrawlUrl("https://example.com/site/index.htm#top"),
    "https://example.com/site",
  );
});

test("selectDiverseTopK supports k=8 and per-sourceType caps for target, fakepedia, and reviews", () => {
  const chunks = [
    { source: "http://localhost:8088/a.html", isLocal: true, sourceType: "target", similarity: 0.92 },
    { source: "http://localhost:8088/b.html", isLocal: true, sourceType: "target", similarity: 0.91 },
    { source: "http://localhost:8088/c.html", isLocal: true, sourceType: "target", similarity: 0.9 },
    { source: "https://en.wikipedia.org/wiki/NordicSleep", isLocal: false, sourceType: "fakepedia", similarity: 0.89 },
    { source: "https://en.wikipedia.org/wiki/NordicSleep", isLocal: false, sourceType: "fakepedia", similarity: 0.88 },
    { source: "https://www.trustpilot.com/review/nordicsleep", isLocal: false, sourceType: "reviews", similarity: 0.87 },
    { source: "https://www.trustpilot.com/review/nordicsleep", isLocal: false, sourceType: "reviews", similarity: 0.86 },
    { source: "https://sleepopolis.com/p1", isLocal: false, sourceType: "competitor", similarity: 0.82 },
    { source: "https://sleepopolis.com/p2", isLocal: false, sourceType: "competitor", similarity: 0.81 },
    { source: "https://sleepopolis.com/p3", isLocal: false, sourceType: "competitor", similarity: 0.80 },
    { source: "https://mattressnerd.com/p1", isLocal: false, sourceType: "competitor", similarity: 0.79 },
    { source: "https://mattressnerd.com/p2", isLocal: false, sourceType: "competitor", similarity: 0.78 },
  ];
  const top8 = selectDiverseTopK(chunks, 8, 2, {
    __target__: 2,
    __fakepedia__: 1,
    __reviews__: 1,
  });
  assert.equal(top8.length, 8);
  assert.equal(top8.filter((c) => c.sourceType === "target").length, 2);
  assert.equal(top8.filter((c) => c.sourceType === "fakepedia").length, 1);
  assert.equal(top8.filter((c) => c.sourceType === "reviews").length, 1);
  assert.equal(top8.filter((c) => c.sourceType === "competitor").length, 4);
});

test("buildFakepediaChunks and buildReviewChunks format realistic external source URLs", () => {
  const wiki = buildFakepediaChunks({
    title: "NordicSleep Blanket",
    content: "NordicSleep is a Swedish sleep-textile company founded in 2024.\n\nIndependent airflow trials in 2026 reported TOG 1.5 breathability.",
  });
  assert.ok(wiki.length >= 1);
  assert.equal(wiki[0].url, "https://en.wikipedia.org/wiki/NordicSleep_Blanket");
  assert.equal(wiki[0].title, "NordicSleep Blanket - Wikipedia");
  assert.equal(wiki[0].sourceType, "fakepedia");

  const revs = buildReviewChunks({
    brandName: "NordicSleep",
    items: [
      { reviewer: "Anna K.", rating: 5, title: "Finally no night sweats", text: "The linen shell stays cool all night." },
      { reviewer: "Erik L.", rating: 4, title: "Heavy yet breathable", text: "7.5 kg fits my 70 kg weight well." },
    ],
  });
  assert.ok(revs.length >= 1);
  assert.equal(revs[0].url, "https://www.trustpilot.com/review/nordicsleep");
  assert.equal(revs[0].title, "NordicSleep Reviews | Trustpilot");
  assert.equal(revs[0].sourceType, "reviews");
  assert.match(revs[0].text, /5\/5 stars/);
  assert.match(revs[0].text, /Anna K\./);
});
