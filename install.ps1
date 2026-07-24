param(
  [string]$RepoUrl = "https://github.com/ziggear/mt_splash_annotate.git",
  [string]$Branch = "main",
  [string]$InstallDir = "$env:LOCALAPPDATA\ManuTechHeightAnnotator",
  [string]$ModelDir = "",
  [switch]$SkipFrontendBuild
)

$ErrorActionPreference = "Stop"

function Install-PythonWithWinget {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (!$winget) {
    return $false
  }

  Write-Host "Python 3 was not found. Installing Python 3.12 with winget..."
  winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements

  $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
  return $true
}

function Find-Python {
  $candidates = @("py", "python", "python3")
  foreach ($cmd in $candidates) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($found) {
      if ($cmd -eq "py") {
        return @{ Command = "py"; Args = @("-3") }
      }
      return @{ Command = $cmd; Args = @() }
    }
  }

  if (Install-PythonWithWinget) {
    foreach ($cmd in $candidates) {
      $found = Get-Command $cmd -ErrorAction SilentlyContinue
      if ($found) {
        if ($cmd -eq "py") {
          return @{ Command = "py"; Args = @("-3") }
        }
        return @{ Command = $cmd; Args = @() }
      }
    }
  }

  throw "Python 3 was not found. Install Python 3.12 from python.org, then rerun this script."
}

function Invoke-Python {
  param(
    [hashtable]$Python,
    [string[]]$Args
  )
  & $Python.Command @($Python.Args + $Args)
}

function Copy-ModelFiles {
  param(
    [string]$Source,
    [string]$Target
  )
  if ($Source -eq "") {
    $missing = @()
    foreach ($name in @("model.ubj", "feature_columns.json", "train_config.json")) {
      if (!(Test-Path (Join-Path $Target $name))) {
        $missing += $name
      }
    }
    if ($missing.Count -eq 0) {
      Write-Host "Using bundled 060b model files: $Target"
    } else {
      Write-Warning "No -ModelDir supplied and bundled model files are missing: $($missing -join ', '). Prepare will fail until model files are copied to $Target"
    }
    return
  }
  $resolved = Resolve-Path $Source
  New-Item -ItemType Directory -Force $Target | Out-Null
  foreach ($name in @("model.ubj", "feature_columns.json", "train_config.json")) {
    $src = Join-Path $resolved $name
    if (!(Test-Path $src)) {
      throw "Missing model file in -ModelDir: $src"
    }
    Copy-Item -Force $src (Join-Path $Target $name)
  }
}

$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$Parent = Split-Path $InstallDir -Parent
New-Item -ItemType Directory -Force $Parent | Out-Null

if ((Test-Path $InstallDir) -and !(Test-Path (Join-Path $InstallDir "Start.ps1"))) {
  throw "InstallDir exists but does not look like ManuTechHeightAnnotator: $InstallDir"
}

if (!(Test-Path $InstallDir)) {
  if ($RepoUrl -eq "") {
    throw "RepoUrl is required for first install. Example: -RepoUrl https://github.com/ziggear/mt_splash_annotate.git"
  }
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    git clone --branch $Branch --depth 1 $RepoUrl $InstallDir
  } else {
    $zipUrl = $RepoUrl
    if ($RepoUrl.EndsWith(".git")) {
      $zipUrl = $RepoUrl.Substring(0, $RepoUrl.Length - 4) + "/archive/refs/heads/$Branch.zip"
    }
    $zipPath = Join-Path $env:TEMP "manutech-height-annotator.zip"
    $extractDir = Join-Path $env:TEMP ("manutech-height-annotator-" + [guid]::NewGuid().ToString("N"))
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    $child = Get-ChildItem $extractDir | Select-Object -First 1
    Move-Item $child.FullName $InstallDir
  }
} else {
  Write-Host "Using existing install: $InstallDir"
}

Set-Location $InstallDir

$Python = Find-Python
if (!(Test-Path ".venv")) {
  Invoke-Python -Python $Python -Args @("-m", "venv", ".venv")
}

$VenvPython = Join-Path $InstallDir ".venv\Scripts\python.exe"
& $VenvPython -m pip install -U pip
& $VenvPython -m pip install -r (Join-Path $InstallDir "backend\requirements.txt")

if (!$SkipFrontendBuild -and !(Test-Path (Join-Path $InstallDir "frontend\dist\index.html"))) {
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($npm) {
    Push-Location (Join-Path $InstallDir "frontend")
    npm ci
    npm run build
    Pop-Location
  } else {
    throw "Node/npm not found and frontend/dist is missing. Publish a repository or release zip that includes frontend/dist."
  }
}

Copy-ModelFiles -Source $ModelDir -Target (Join-Path $InstallDir "models\xgb_peak\060b_dino_quality")

Write-Host "Installed ManuTech Height Annotator at $InstallDir"
Write-Host "Start with:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$InstallDir\Start.ps1`""

& powershell -ExecutionPolicy Bypass -File (Join-Path $InstallDir "Start.ps1")
