param(
    [switch]$ForceCorpora
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$CorporaUrl = if ($env:CORPORA_URL) { $env:CORPORA_URL } else { "https://people.dsv.su.se/~thva5058/corpora.zip" }
$GenModel   = if ($env:GEN_MODEL)   { $env:GEN_MODEL }   else { "qwen3:4b" }
$EmbedModel = if ($env:EMBED_MODEL) { $env:EMBED_MODEL } else { "embeddinggemma" }
$OllamaHost = if ($env:OLLAMA_HOST) { $env:OLLAMA_HOST } else { "http://localhost:11434" }

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  FakeGPT Setup (Windows)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js (v18+)
Write-Host "[1/5] Checking Node.js..."
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "ERROR: Node.js is not installed." -ForegroundColor Red
    Write-Host "Download and install Node.js (version 18 or higher) from: https://nodejs.org/"
    Write-Host "After installing, close this window and run setup.bat again."
    exit 1
}

$nodeVerRaw = (& node -v).Trim()
$nodeMajor = [int]($nodeVerRaw.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) {
    Write-Host "ERROR: Node.js $nodeVerRaw is too old (version 18+ required)." -ForegroundColor Red
    Write-Host "Please update Node.js from: https://nodejs.org/"
    exit 1
}
$npmVer = (& npm -v).Trim()
Write-Host "  OK: Node.js $nodeVerRaw, npm $npmVer" -ForegroundColor Green

# 2. Check Ollama installed and running
Write-Host ""
Write-Host "[2/5] Checking Ollama..."
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCmd) {
    Write-Host "ERROR: Ollama is not installed." -ForegroundColor Red
    Write-Host "Download and install Ollama for Windows from: https://ollama.com/download"
    Write-Host "After installing, launch Ollama from the Start menu and run setup.bat again."
    exit 1
}
Write-Host "  OK: $((& ollama --version).Trim())" -ForegroundColor Green

function Test-OllamaRunning {
    try {
        $null = Invoke-RestMethod -Uri "$OllamaHost/api/tags" -TimeoutSec 3
        return $true
    } catch {
        return $false
    }
}

if (-not (Test-OllamaRunning)) {
    Write-Host "  Ollama is not running yet. Attempting to start Ollama..." -ForegroundColor Yellow
    $ollamaApp = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"
    if (Test-Path $ollamaApp) {
        Start-Process $ollamaApp
        Start-Sleep -Seconds 5
    } else {
        Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 4
    }
}

if (-not (Test-OllamaRunning)) {
    Write-Host "ERROR: Could not connect to Ollama at $OllamaHost." -ForegroundColor Red
    Write-Host "Please open the Ollama app from the Windows Start menu, wait a few seconds, and run setup.bat again."
    exit 1
}
Write-Host "  OK: Ollama is running at $OllamaHost" -ForegroundColor Green

# 3. Pull required AI models
Write-Host ""
Write-Host "[3/5] Downloading AI models ($GenModel and $EmbedModel)..."
Write-Host "  (This downloads ~3.2 GB the first time and may take a few minutes.)"
& ollama pull $GenModel
if ($LASTEXITCODE -ne 0) { throw "Failed to pull $GenModel" }
& ollama pull $EmbedModel
if ($LASTEXITCODE -ne 0) { throw "Failed to pull $EmbedModel" }
Write-Host "  OK: Models ready." -ForegroundColor Green

# 4. Download and extract competitor corpora
Write-Host ""
Write-Host "[4/5] Checking competitor corpora..."
$corporaDir = Join-Path $PSScriptRoot "corpora"
if (-not (Test-Path $corporaDir)) {
    New-Item -ItemType Directory -Path $corporaDir | Out-Null
}
$manifestPath = Join-Path $corporaDir "manifest.json"
if ((Test-Path $manifestPath) -and (-not $ForceCorpora)) {
    Write-Host "  OK: corpora\manifest.json already exists (pass -ForceCorpora to re-download)." -ForegroundColor Green
} else {
    $tmpZip = Join-Path $env:TEMP "fakegpt-corpora.zip"
    Write-Host "  Downloading $CorporaUrl..."
    Invoke-WebRequest -Uri $CorporaUrl -OutFile $tmpZip -UseBasicParsing
    Write-Host "  Extracting into corpora\..."
    Expand-Archive -Path $tmpZip -DestinationPath $corporaDir -Force
    Remove-Item $tmpZip -ErrorAction SilentlyContinue

    # Flatten accidental nested corpora\corpora\ directory if present
    $nestedDir = Join-Path $corporaDir "corpora"
    if ((-not (Test-Path $manifestPath)) -and (Test-Path (Join-Path $nestedDir "manifest.json"))) {
        Move-Item (Join-Path $nestedDir "*") $corporaDir -Force
        Remove-Item $nestedDir -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path $manifestPath) {
        Write-Host "  OK: Competitor corpora ready in corpora\." -ForegroundColor Green
    } else {
        Write-Host "WARNING: corpora\manifest.json not found after extraction. Please check the corpora\ folder." -ForegroundColor Yellow
    }
}

# 5. Install Node.js dependencies
Write-Host ""
Write-Host "[5/5] Installing FakeGPT dependencies (npm install)..."
& npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Start FakeGPT:   npm run dev"
Write-Host "  2. Open in browser: http://localhost:5173"
Write-Host ""
