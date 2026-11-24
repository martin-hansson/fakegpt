# Generative Engine Optimization (GEO) Lab

Welcome to the GEO Lab! In this lab, you will explore how Large Language Models (LLMs), Agentic Search Loops, and Retrieval-Augmented Generation (RAG) combine to simulate how modern AI search engines work.

## Prerequisites

Before starting the lab, you must install the following dependencies on your machine:

### 1. Install Node.js
You must have Node.js (version 18 or higher) installed.
- **Mac/Windows:** Download and install from the [official Node.js website](https://nodejs.org/).
- **Linux:** We recommend using nvm (Node Version Manager) or your package manager:
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  nvm install 20
  ```
  
### 2. Install Ollama (Local AI Engine)
This lab uses local LLMs to process data securely and for free.
- **Mac:** Download the Mac installer from [Ollama's website](https://ollama.com/).
- **Windows:** Download the Windows preview installer from Ollama.
- **Linux:** Run the automated install script:
  ```bash
  curl -fsSL https://ollama.com/install.sh | sh
  ```

### 3. Download the Required AI Models
Once Ollama is installed and running, open your terminal (or Command Prompt) and pull the specific models required for this lab:

```bash
# 1. Download the generative chatbot model (Qwen 3 4B)
ollama pull qwen3:4b

# 2. Download the vector embedding model (EmbeddingGemma)
ollama pull embeddinggemma
```

*(Note: Depending on your internet connection, downloading the models may take a few minutes as they are several gigabytes in size).*

If you want to use alternative models (for example, `llama3.2:3b` on slower CPU-only machines), you can override them using environment variables when starting the server:
```bash
# Linux / macOS
GEN_MODEL="llama3.2:3b" EMBED_MODEL="embeddinggemma" npm run dev
```
```powershell
# Windows PowerShell
$env:GEN_MODEL="llama3.2:3b"; $env:EMBED_MODEL="embeddinggemma"; npm run dev
```

---

### 4. Add the Pre-Crawled Competitor Corpora
Download [`corpora.zip`](https://people.dsv.su.se/~thva5058/corpora.zip) (`https://people.dsv.su.se/~thva5058/corpora.zip`) and extract its `.json` and `.f32` files into the `corpora/` folder inside this project. *(Alternatively, instructors can rebuild the corpora directly from `scripts/niche-urls.json` by running `node scripts/build-corpus.mjs`.)*

---

## Running the Lab

Once all prerequisites are installed, you can start the lab application. For the full student assignment instructions, see [INSTRUCTIONS.md](INSTRUCTIONS.md).

1. **Open your terminal** and navigate to this project folder.
2. **Install project dependencies:**
   ```bash
   npm install
   ```
3. **Start the development server:**
   ```bash
   npm run dev
   ```
4. **Open your browser** and navigate to the URL provided in the terminal (usually `http://localhost:5173`).

### Using the Lab Controls

- **Competitor Niche (`LAB SETTINGS`):** Pick your assigned niche from the dropdown to load its pre-crawled real-world competitor corpus (200+ real pages per niche, zero external search rate limits). Select **Custom (manual competitor URLs)** if you are doing real-life GEO outside the curated niches and want to crawl 1–3 competitor URLs manually.
- **Crawling a Target Site:** Enter your site's URL (e.g., `https://user.github.io/geo-lab/before/`) **or** a direct `sitemap.xml` URL (e.g., `https://user.github.io/geo-lab/after/sitemap.xml`) and click the refresh button. Crawling is scoped strictly to that URL's directory prefix (so `/after/` will not crawl `/before/`) and automatically replaces the active target site while preserving your selected competitor niche.
- **Export Chat History (download icon next to `Recents`):** Downloads your full chat sessions (including retrieved sources, similarity scores, and evaluator decisions) as a JSON file for submission.

> [!NOTE]
> **Windows users:** in case `npm` doesn't work, try running the following command:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

---

## Troubleshooting

- **Server Crash / ECONNREFUSED:** Ensure Ollama is running in the background. If the Node.js server crashes, simply restart it by pressing `Ctrl+C` and running `npm run dev` again.
- **No Niches in Dropdown:** Ensure you extracted the course `corpora.zip` files (`manifest.json`, `*.json`, `*.f32`) directly into the `corpora/` folder, then refresh the browser.
- **Crawler 403 Errors:** If you see 403 Forbidden errors when crawling your own hosted site or a custom competitor URL, the hosting platform's firewall (e.g. Cloudflare) blocked the crawler. Prefer plain static HTML on GitHub Pages or DSV student web.
- **Empty Local Index:** Check the `Target:` status under `LAB SETTINGS` to verify how many pages and chunks were extracted. If you changed `EMBED_MODEL`, re-crawl your site so embeddings match.
