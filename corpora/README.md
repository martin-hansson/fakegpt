# Pre-Crawled Competitor Corpora

This directory stores pre-crawled real-world competitor corpora (`*.json` and `manifest.json`) used by FakeGPT so students compete against real online websites without live search rate-limiting (HTTP 202 / CAPTCHAs) in the classroom.

## For Students
Download the `corpora.zip` bundle from the course page (Athena / DSV) and extract its `.json` files directly into this `corpora/` folder before starting FakeGPT (`npm run dev`).

## For Instructors
To rebuild all curated niche corpora from scratch using the URL list in `scripts/niche-urls.json` (requires Ollama with `embeddinggemma` running):

```bash
node scripts/build-corpus.mjs
```

All `corpora/*.json` files are gitignored so third-party website text is never committed to the public repository.
