import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  cosineSimilarity,
  normalizeQueryKey,
  normalizeSiteUrl,
  getSitePrefix,
  isUrlWithinPrefix,
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

test("getSitemapCandidates scopes to directory prefix and does not leak to shared root", () => {
  assert.deepEqual(
    getSitemapCandidates("https://people.dsv.su.se/~stud1234/after/"),
    ["https://people.dsv.su.se/~stud1234/after/sitemap.xml"],
  );
  assert.deepEqual(
    getSitemapCandidates("https://mybrand.example.com/"),
    ["https://mybrand.example.com/sitemap.xml"],
  );
});

test("extractChunksFromHtml preserves <article><header><h1> and summary in demo/optimized/index.html", () => {
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
  assert.match(joined, /NordicSleep: The Premier Breathable Cooling Weighted Blanket/);
  assert.match(joined, /maintains thermal neutrality throughout the night/);
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
