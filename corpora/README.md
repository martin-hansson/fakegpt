# Pre-Crawled Competitor Corpora

This directory stores pre-crawled real-world competitor corpora (`*.json`, `*.f32`, and `manifest.json`) used by FakeGPT so students compete against real online websites without live search rate-limiting (HTTP 202 / CAPTCHAs) in the classroom.

## For Students
Download [`corpora.zip`](https://people.dsv.su.se/~thva5058/corpora.zip) (`https://people.dsv.su.se/~thva5058/corpora.zip`) and extract its `.json` and `.f32` files directly into this `corpora/` folder before starting FakeGPT (`npm run dev`).

## For Instructors
To rebuild all curated niche corpora from scratch using the URL list in `scripts/niche-urls.json` (requires Ollama with `embeddinggemma` running):

```bash
node scripts/build-corpus.mjs
```

All `corpora/*.json` and `corpora/*.f32` files are gitignored so third-party website text is never committed to the public repository.
