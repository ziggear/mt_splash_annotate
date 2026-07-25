param(
  [string]$ModelDir = "",
  [switch]$SkipPythonInstall
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$BackendDist = Join-Path $Root "backend_dist"
$BundledModelDir = Join-Path $Root "models\xgb_peak\055_base"

Write-Host "Root: $Root"

if ($ModelDir -ne "") {
  $ModelDirResolved = Resolve-Path $ModelDir
  New-Item -ItemType Directory -Force $BundledModelDir | Out-Null
  Copy-Item -Force (Join-Path $ModelDirResolved "model.ubj") $BundledModelDir
  Copy-Item -Force (Join-Path $ModelDirResolved "feature_columns.json") $BundledModelDir
  Copy-Item -Force (Join-Path $ModelDirResolved "train_config.json") $BundledModelDir
}

foreach ($Required in @("model.ubj", "feature_columns.json", "train_config.json")) {
  $Path = Join-Path $BundledModelDir $Required
  if (!(Test-Path $Path)) {
    throw "Missing model file: $Path. Pass -ModelDir <055_base folder>."
  }
}

Push-Location $Frontend
npm ci
npm run build
Pop-Location

Push-Location $Root
npm ci
Pop-Location

$VenvPython = Join-Path $Backend ".venv\Scripts\python.exe"
if (!(Test-Path $VenvPython)) {
  py -3 -m venv (Join-Path $Backend ".venv")
}

if (!$SkipPythonInstall) {
  & $VenvPython -m pip install -U pip
  & $VenvPython -m pip install -r (Join-Path $Backend "requirements.txt") pyinstaller
}

if (Test-Path $BackendDist) {
  Remove-Item -Recurse -Force $BackendDist
}
New-Item -ItemType Directory -Force $BackendDist | Out-Null

Push-Location $Root
& $VenvPython -m PyInstaller --clean --distpath $BackendDist --workpath (Join-Path $Root "build\pyinstaller") (Join-Path $Backend "pyinstaller-height-backend.spec")
Pop-Location

$BackendExe = Join-Path $BackendDist "manutech-height-backend.exe"
if (!(Test-Path $BackendExe)) {
  throw "Backend exe not created: $BackendExe"
}

Push-Location $Root
npm run tauri:build
Pop-Location

Write-Host "Windows package output:"
Get-ChildItem -Recurse (Join-Path $Root "src-tauri\target\release\bundle") | Select-Object FullName
