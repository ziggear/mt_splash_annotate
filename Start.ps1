param(
  [int]$Port = 37864,
  [switch]$NoBrowser,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$FrontendDist = Join-Path $Root "frontend\dist"
$LogDir = Join-Path $env:LOCALAPPDATA "ManuTechHeightAnnotator\logs"
$FrameCache = Join-Path $env:LOCALAPPDATA "ManuTechHeightAnnotator\frame_cache"
$DatasetsConfig = Join-Path $env:LOCALAPPDATA "ManuTechHeightAnnotator\height_annot_datasets.json"
$ModelDir = Join-Path $Root "models\xgb_peak\060b_dino_quality"

if (!(Test-Path $VenvPython)) {
  if ($SkipInstall) {
    throw "Python venv missing: $VenvPython"
  }
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    py -3 -m venv (Join-Path $Root ".venv")
  } else {
    python -m venv (Join-Path $Root ".venv")
  }
  & $VenvPython -m pip install -U pip
  & $VenvPython -m pip install -r (Join-Path $Root "backend\requirements.txt")
}

if (!(Test-Path (Join-Path $FrontendDist "index.html"))) {
  throw "Frontend build missing: $FrontendDist. Run install.ps1 on a machine with Node/npm, or commit frontend/dist for portable delivery."
}

foreach ($name in @("model.ubj", "feature_columns.json", "train_config.json")) {
  if (!(Test-Path (Join-Path $ModelDir $name))) {
    Write-Warning "Missing model file: $(Join-Path $ModelDir $name). Prepare annotation will fail until model files are copied."
  }
}

New-Item -ItemType Directory -Force $LogDir | Out-Null
New-Item -ItemType Directory -Force $FrameCache | Out-Null

$env:ANNOTATION_FRONTEND_DIST = $FrontendDist
$env:ANNOTATION_LOG_DIR = $LogDir
$env:HEIGHT_ANNOT_FRAME_CACHE = $FrameCache
$env:HEIGHT_ANNOT_DATASETS_CONFIG = $DatasetsConfig
$env:HEIGHT_ANNOT_XGB_060B_MODEL_DIR = $ModelDir

$Url = "http://127.0.0.1:$Port/"
if (!$NoBrowser) {
  Start-Process $Url
}

Write-Host "ManuTech Height Annotator"
Write-Host "URL: $Url"
Write-Host "Logs: $LogDir"
Write-Host "Press Ctrl+C to stop."

Push-Location (Join-Path $Root "backend")
try {
  & $VenvPython (Join-Path $Root "backend\annotation_backend_main.py") `
    --port $Port `
    --log-dir $LogDir `
    --frontend-dist $FrontendDist `
    --frame-cache $FrameCache `
    --datasets-config $DatasetsConfig
} finally {
  Pop-Location
}
