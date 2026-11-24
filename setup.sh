#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

CORPORA_URL="${CORPORA_URL:-https://people.dsv.su.se/~thva5058/corpora.zip}"
GEN_MODEL="${GEN_MODEL:-qwen3:4b}"
EMBED_MODEL="${EMBED_MODEL:-embeddinggemma}"
FORCE_CORPORA=0

for arg in "$@"; do
  if [ "$arg" = "--force-corpora" ]; then
    FORCE_CORPORA=1
  fi
done

echo "========================================="
echo "  FakeGPT Setup (macOS / Linux)"
echo "========================================="
echo ""

# 1. Check Node.js (v18+)
echo "[1/5] Checking Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed."
  echo "Please install Node.js (version 18 or higher) from: https://nodejs.org/"
  echo "Then close and reopen your terminal and run ./setup.sh again."
  exit 1
fi

NODE_MAJOR=$(node -p "parseInt(process.versions.node.split('.')[0], 10)")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node.js $(node -v) is too old (version 18+ required)."
  echo "Please update Node.js from: https://nodejs.org/"
  exit 1
fi
echo "  OK: Node.js $(node -v), npm $(npm -v)"

# 2. Check Ollama installed and running
echo ""
echo "[2/5] Checking Ollama..."
if ! command -v ollama >/dev/null 2>&1; then
  echo "ERROR: Ollama is not installed."
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "Download and install Ollama for Mac from: https://ollama.com/download"
  else
    echo "Install Ollama on Linux with: curl -fsSL https://ollama.com/install.sh | sh"
  fi
  echo "Then start Ollama and run ./setup.sh again."
  exit 1
fi
echo "  OK: $(ollama --version)"

OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
check_ollama_running() {
  if command -v curl >/dev/null 2>&1; then
    curl -sf --max-time 3 "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1
  else
    node -e "fetch('${OLLAMA_HOST}/api/tags').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1
  fi
}

if ! check_ollama_running; then
  echo "  Ollama does not appear to be running at ${OLLAMA_HOST}."
  if [ "$(uname -s)" = "Darwin" ] && [ -d "/Applications/Ollama.app" ]; then
    echo "  Attempting to start Ollama.app..."
    open -a Ollama || true
    sleep 4
  else
    echo "  Attempting to start 'ollama serve' in the background..."
    nohup ollama serve >/tmp/fakegpt-ollama.log 2>&1 &
    sleep 3
  fi
fi

if ! check_ollama_running; then
  echo "ERROR: Could not connect to Ollama at ${OLLAMA_HOST}."
  echo "Please launch Ollama (open the Ollama app, or run 'ollama serve' in another terminal) and run ./setup.sh again."
  exit 1
fi
echo "  OK: Ollama is running at ${OLLAMA_HOST}"

# 3. Pull required AI models
echo ""
echo "[3/5] Downloading AI models (${GEN_MODEL} and ${EMBED_MODEL})..."
echo "  (This downloads ~3.2 GB the first time and may take a few minutes.)"
ollama pull "${GEN_MODEL}"
ollama pull "${EMBED_MODEL}"
echo "  OK: Models ready."

# 4. Download and extract competitor corpora
echo ""
echo "[4/5] Checking competitor corpora..."
mkdir -p corpora
if [ -f "corpora/manifest.json" ] && [ "$FORCE_CORPORA" -eq 0 ]; then
  echo "  OK: corpora/manifest.json already exists (pass --force-corpora to re-download)."
else
  TMP_ZIP="$(mktemp /tmp/fakegpt-corpora-XXXXXX.zip)"
  trap 'rm -f "$TMP_ZIP"' EXIT
  echo "  Downloading ${CORPORA_URL}..."
  if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar "${CORPORA_URL}" -o "${TMP_ZIP}"
  else
    node -e "
      import('fs').then(async fs => {
        const res = await fetch('${CORPORA_URL}');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync('${TMP_ZIP}', buf);
      });
    "
  fi

  echo "  Extracting into corpora/..."
  if command -v unzip >/dev/null 2>&1; then
    unzip -o -q "${TMP_ZIP}" -d corpora/
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "${TMP_ZIP}" corpora/
  elif command -v tar >/dev/null 2>&1; then
    tar -xf "${TMP_ZIP}" -C corpora/
  else
    echo "ERROR: No unzip tool found (unzip, python3, or tar)."
    echo "Please download ${CORPORA_URL} manually and extract it into the corpora/ folder."
    exit 1
  fi

  # Flatten accidental nested corpora/corpora/ directory if present
  if [ ! -f "corpora/manifest.json" ] && [ -f "corpora/corpora/manifest.json" ]; then
    mv corpora/corpora/* corpora/
    rmdir corpora/corpora || true
  fi

  if [ ! -f "corpora/manifest.json" ]; then
    echo "WARNING: corpora/manifest.json not found after extraction. Please check the corpora/ folder."
  else
    echo "  OK: Competitor corpora ready in corpora/."
  fi
fi

# 5. Install Node.js dependencies
echo ""
echo "[5/5] Installing FakeGPT dependencies (npm install)..."
npm install

echo ""
echo "========================================="
echo "  Setup complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Start FakeGPT:  npm run dev"
echo "  2. Open in browser: http://localhost:5173"
echo ""
