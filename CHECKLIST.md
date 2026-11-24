# Verification Instructions for DSV Lab Machines

This README is a step-by-step checklist to verify that FakeGPT and the pre-crawled competitor corpora work smoothly on the DSV classroom machines (Windows and/or Linux) before the students start Assignment 3.

**What you need before starting:**
- GitHub repo: `https://github.com/martin-hansson/fakegpt`
- Competitor bundle: `corpora.zip` (~22 MB, `https://people.dsv.su.se/~thva5058/corpora.zip`)

---

## Step 1: Check Prerequisites & Permissions on a DSV Lab PC

Log in with a regular student/test account (not admin) and open a terminal (PowerShell on Windows, Terminal on Linux):

```bash
node -v          # Needs v18 or higher
npm -v
git --version
ollama --version
```

**Things to check & note back to Thomas:**
1. Are `node` (v18+) and `ollama` already installed on the lab image? If not, can a regular student install them in user space without admin rights?
2. Is Ollama running? Check with `ollama list`. If it fails to connect, launch the Ollama desktop app (Windows) or run `ollama serve` in a separate terminal (Linux).
3. **Disk quota check:** Pulling the two models uses ~3.2 GB (`qwen3:4b` = ~2.5 GB, `embeddinggemma` = ~0.6 GB). Run:
   ```bash
   ollama pull qwen3:4b
   ollama pull embeddinggemma
   ```
   Verify this succeeds without hitting a roaming-profile / home-directory quota limit. *(If a quota error happens, check whether setting `OLLAMA_MODELS` to a local scratch drive such as `C:\Temp\ollama-models` or `/tmp/ollama-models` works.)*

---

## Step 2: Install & Launch FakeGPT with `corpora.zip`

```bash
git clone https://github.com/martin-hansson/fakegpt.git
cd fakegpt
```

1. Extract `corpora.zip` into the `corpora/` folder inside `fakegpt/` (so `corpora/manifest.json`, `*.json`, and `*.f32` sit inside `corpora/`).
2. Install dependencies and start FakeGPT:
   ```bash
   npm install
   npm run dev
   ```
   *(Windows PowerShell note: if `npm` is blocked by execution policy, run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` once and retry.)*
3. Open `http://localhost:5173` in a browser.
4. **Verify health:** In the left sidebar under **LAB SETTINGS**:
   - There should be **no yellow warning box** (if anything is missing, the sidebar will say exactly what).
   - The **Competitor Niche** dropdown should list all 5 niches (145–238 pages each), and `Corpus:` should show the page and chunk count.

---

## Step 3: 5-Minute End-to-End Smoke Test (Using the Built-In Demo Sites)

No need to build a website — the repo includes ready-made `demo/unoptimized/` (Before) and `demo/optimized/` (After) sites for the `Cooling Weighted Blankets for Hot Sleepers` niche.

1. In a **second terminal**, serve the `demo/` folder locally:
   ```bash
   cd fakegpt
   python3 -m http.server 8088 --directory demo
   ```
   *(On Windows if `python3` isn't found, try `py -m http.server 8088 --directory demo` or `npx serve demo -l 8088`.)*
2. **Test "Before" (Unoptimized):**
   - In FakeGPT's sidebar, select **Cooling Weighted Blankets for Hot Sleepers**.
   - Paste `http://localhost:8088/unoptimized/` into **Your site URL or sitemap.xml** and click the refresh button.
   - Verify the sidebar shows `Target: http://localhost:8088/unoptimized` — **3 pages · 5 chunks**.
   - Ask: *"Which breathable cooling weighted blanket is best for people who overheat at night?"*
   - **Check timing & output:**
     - Note roughly how many seconds the response takes (and run `ollama ps` in a terminal to see whether `qwen3:4b` is running on **GPU** or **CPU**!).
     - Expand **View Sources**: real competitors (e.g., Sleepopolis / Mattress Nerd) should dominate, and the unoptimized site should **not** be cited.
3. **Test "After" (Optimized + Direct `sitemap.xml`):**
   - Paste `http://localhost:8088/optimized/sitemap.xml` into **Your site URL or sitemap.xml** and click the refresh button.
   - Verify the sidebar updates to **4 pages · 30 chunks** (automatically replacing the unoptimized site).
   - Click **New chat** and ask the exact same prompt: *"Which breathable cooling weighted blanket is best for people who overheat at night?"*
   - Expand **View Sources**: `NordicSleep` (`localhost:8088/optimized/...`) should now rank **#1**, show `[2. Evaluator: Accepted]` and `[3. Cited in Answer]`, alongside 3 real competitors.
4. **Test Export:** Click the small **Download** icon next to `Recents` and confirm `fakegpt-chats-YYYY-MM-DD.json` downloads cleanly.

---

## Step 4: Checklist

1. **OS & prerequisites:** Did Node.js, Git, Ollama, and `npm install` work cleanly on a normal student login (Windows and/or Linux)?
2. **Speed (GPU vs. CPU):** How fast was 1 prompt with `qwen3:4b`, and what did `ollama ps` show under `PROCESSOR`?
   - *If `qwen3:4b` is CPU-only and takes > 60 seconds per prompt*, please also test `llama3.2:3b` (`ollama pull llama3.2:3b`, then start FakeGPT with `GEN_MODEL="llama3.2:3b" npm run dev` on Linux or `$env:GEN_MODEL="llama3.2:3b"; npm run dev` on PowerShell) so we know whether to recommend `llama3.2:3b` for CPU-only lab rooms.
3. **Disk quota / firewall:** Any issues downloading models (~3.2 GB) or crawling a live public student URL (e.g., `https://people.dsv.su.se/~...` or `https://*.github.io/...`) from inside the DSV network?
4. **Any wording tweaks** needed for the classroom login / terminal steps before we finalize the assignment instructions.
