# Generative Engine Optimization (GEO) Lab — FakeGPT

Welcome to **FakeGPT**, a local Retrieval-Augmented Generation (RAG) chatbot built for the Generative Engine Optimization (GEO) lab. FakeGPT lets you test your own website — plus simulated Wikipedia articles (**Fakepedia**) and simulated customer reviews (**Totally Unbiased Reviews**) — directly against pre-crawled real-world competitor websites.

> [!NOTE]
> Follow the **official assignment instructions on NextiLearn** for grading criteria, prompt requirements, and what to include in your report. This README covers how to install and run FakeGPT.

---

## Step 1: Install Prerequisites

Install these two free programs first (if you are on a DSV lab computer, check whether they are already installed before downloading):

1. **Node.js (version 18 or higher):**
   - **Windows / macOS:** Download and run the LTS installer from [nodejs.org](https://nodejs.org/).
   - **Linux:** Install via your package manager or `nvm`:
     ```bash
     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
     nvm install 20
     ```
2. **Ollama (runs the local AI models):**
   - **Windows / macOS:** Download and run the installer from [ollama.com/download](https://ollama.com/download). After installing, **open the Ollama app** (you should see the small llama icon in your taskbar or top menu bar).
   - **Linux:** Run:
     ```bash
     curl -fsSL https://ollama.com/install.sh | sh
     ```

---

## Step 2: Download FakeGPT

Choose **either** method:

- **Option A — Download ZIP (easiest, no Git needed):**
  1. On the GitHub page, click the green **Code** button and select **Download ZIP**.
  2. Unzip the downloaded file somewhere easy to find (for example, your Desktop or Documents folder).
- **Option B — Using Git:**
  ```bash
  git clone https://github.com/martin-hansson/fakegpt.git
  cd fakegpt
  ```

---

## Step 3: Run the Automatic Setup Script

The setup script automatically checks Node.js and Ollama, downloads the two required AI models (~3.2 GB), downloads and extracts the competitor websites (`corpora.zip`) into the `corpora/` folder, and runs `npm install`.

### Windows
- Open the unzipped `fakegpt` folder in File Explorer and **double-click `setup.bat`**.
- *(Or, in PowerShell inside the `fakegpt` folder, run `.\setup.bat`.)*

### macOS & Linux
1. Open **Terminal** and move into the `fakegpt` folder (tip: type `cd ` with a space, drag the `fakegpt` folder into the Terminal window, and press Enter).
2. Run:
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

<details>
<summary><strong>Manual Setup (only needed if you prefer running commands yourself)</strong></summary>

1. Pull the two AI models in your terminal:
   ```bash
   ollama pull qwen3:4b
   ollama pull embeddinggemma
   ```
2. Download [`corpora.zip`](https://people.dsv.su.se/~thva5058/corpora.zip) (`https://people.dsv.su.se/~thva5058/corpora.zip`), unzip it, and place the extracted files (`manifest.json`, `*.json`, `*.f32`) inside the `corpora/` folder in `fakegpt/`.
3. Install project packages:
   ```bash
   npm install
   ```

</details>

---

## Step 4: Start FakeGPT

1. Open a terminal (PowerShell on Windows, Terminal on macOS/Linux) inside the `fakegpt` folder.
2. Start FakeGPT:
   ```bash
   npm run dev
   ```
3. Open your web browser and go to **[http://localhost:5173](http://localhost:5173)**.
4. Check the left sidebar under **LAB SETTINGS** — if Ollama, a model, or `corpora/` is missing, a yellow warning box will tell you exactly what to fix.

*(To stop FakeGPT later, press `Ctrl + C` in the terminal window.)*

### Optional: Faster Model for Slower CPU-Only Computers
If responses with `qwen3:4b` feel very slow (for example, on a computer without a dedicated GPU), you can pull and use `llama3.2:3b` instead:

```bash
# macOS / Linux
ollama pull llama3.2:3b
GEN_MODEL="llama3.2:3b" EMBED_MODEL="embeddinggemma" npm run dev
```
```powershell
# Windows PowerShell
ollama pull llama3.2:3b
$env:GEN_MODEL="llama3.2:3b"; $env:EMBED_MODEL="embeddinggemma"; npm run dev
```

---

## Using the Lab Controls

- **Competitor Niche (`LAB SETTINGS`):** Choose your niche from the dropdown to load its pre-crawled real-world competitor corpus (145–238 real webpages per niche). Choose **Custom (manual competitor URLs)** only if you are doing real-life GEO outside the five niches and want to add 1–3 competitor URLs manually.
- **Crawling Your Website:** Paste your website's folder URL (e.g., `https://people.dsv.su.se/~youruser/geo/before/`) **or** a direct `sitemap.xml` URL (e.g., `.../after/sitemap.xml`) and click the refresh button. Crawling stays strictly inside that folder (so `/after/` never crawls `/before/`) and automatically replaces your previously crawled site while keeping the same competitor niche.
- **Fakepedia & Totally Unbiased Reviews (top tabs):** Use the top navigation bar to write a simulated Wikipedia article (**Fakepedia**, seen by the AI as `en.wikipedia.org/wiki/{Article_Title}`) and simulated customer reviews (**Totally Unbiased Reviews**, seen by the AI as `trustpilot.com/review/{brand}`). Keep them toggled **off** during your "Before" baseline tests and **on** during your "After" tests.
- **View Sources:** Click **View Sources** under any assistant reply to see the rewritten search query and all 3 RAG stages across the top 8 retrieved snippets: Stage 1 (rank & cosine similarity), Stage 2 (Evaluator Accepted/Rejected), and Stage 3 (Cited in Answer).
- **Export Chat History (download icon next to `Recents`):** Downloads your chats (including retrieved sources, scores, and any saved Fakepedia/Reviews content) as a JSON file.

---

## Troubleshooting

- **Windows PowerShell blocks `npm`:** Run this once in PowerShell and try again:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```
- **Yellow warning: "Cannot reach Ollama" or `ECONNREFUSED`:** Make sure Ollama is running (launch the Ollama app on Windows/macOS, or run `ollama serve` in a separate terminal on Linux), then refresh the browser.
- **Yellow warning: "No competitor corpora found":** Re-run `./setup.sh --force-corpora` (macOS/Linux) or `.\setup.bat -ForceCorpora` (Windows), or manually download and unzip [`corpora.zip`](https://people.dsv.su.se/~thva5058/corpora.zip) into `corpora/`.
- **Crawler 403 Errors:** Some commercial hosting platforms (or Cloudflare) block automated crawlers. Host plain static HTML on your DSV student web space or GitHub Pages, and check `Target:` in the sidebar to confirm all pages and chunks were indexed.
- **Empty Target Index after changing `EMBED_MODEL`:** Re-crawl your site so embeddings match the active model.
