param(
  [int]$Port = 37864,
  [switch]$NoBrowser,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$MinPythonMajor = 3
$MinPythonMinor = 10
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$FrontendDist = Join-Path $Root "frontend\dist"
$LogDir = Join-Path $env:LOCALAPPDATA "ManuTechHeightAnnotator\logs"
$FrameCache = Join-Path $env:LOCALAPPDATA "ManuTechHeightAnnotator\frame_cache"
$DatasetsConfig = Join-Path $env:LOCALAPPDATA "ManuTechHeightAnnotator\height_annot_datasets.json"
$ModelDir = Join-Path $Root "models\xgb_peak\060b_dino_quality"

function Install-PythonWithWinget {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (!$winget) {
    return $false
  }

  Write-Host "Python $MinPythonMajor.$MinPythonMinor+ was not found. Installing Python 3.12 with winget..."
  winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    return $false
  }

  $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
  return $true
}

function Test-PythonExe {
  param([string]$PythonExe)

  if (!(Test-Path $PythonExe) -and !(Get-Command $PythonExe -ErrorAction SilentlyContinue)) {
    return $false
  }
  $versionText = & $PythonExe -c "import sys; print(str(sys.version_info[0]) + '.' + str(sys.version_info[1]) + '.' + str(sys.version_info[2]))" 2>$null
  if ($LASTEXITCODE -ne 0 -or !$versionText) {
    return $false
  }
  $parts = $versionText.Trim().Split(".")
  if ($parts.Count -lt 2) {
    return $false
  }
  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  if ($major -gt $MinPythonMajor -or ($major -eq $MinPythonMajor -and $minor -ge $MinPythonMinor)) {
    return $true
  }
  Write-Host "Python venv uses $versionText, but this app requires Python $MinPythonMajor.$MinPythonMinor+."
  return $false
}

function New-Venv {
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    $commands = @(
      @{ Command = "py"; Args = @("-3.12") },
      @{ Command = "py"; Args = @("-3.11") },
      @{ Command = "py"; Args = @("-3.10") },
      @{ Command = "python"; Args = @() },
      @{ Command = "python3"; Args = @() }
    )
    foreach ($candidate in $commands) {
      $found = Get-Command $candidate.Command -ErrorAction SilentlyContinue
      if (!$found) {
        continue
      }
      $versionText = & $candidate.Command @($candidate.Args + @("-c", "import sys; print(str(sys.version_info[0]) + '.' + str(sys.version_info[1]))")) 2>$null
      if ($LASTEXITCODE -ne 0 -or !$versionText) {
        continue
      }
      $parts = $versionText.Trim().Split(".")
      if ([int]$parts[0] -gt $MinPythonMajor -or ([int]$parts[0] -eq $MinPythonMajor -and [int]$parts[1] -ge $MinPythonMinor)) {
        & $candidate.Command @($candidate.Args + @("-m", "venv", (Join-Path $Root ".venv")))
        return
      }
    }

    if ($attempt -eq 0) {
      if (Install-PythonWithWinget) {
        continue
      }
    }
    break
  }
  throw "Python $MinPythonMajor.$MinPythonMinor+ was not found. Install Python 3.12 from python.org, then rerun install.ps1."
}

if (!(Test-Path $VenvPython)) {
  if ($SkipInstall) {
    throw "Python venv missing: $VenvPython"
  }
  New-Venv
  & $VenvPython -m pip install -U pip
  & $VenvPython -m pip install -r (Join-Path $Root "backend\requirements.txt")
}

if (!(Test-PythonExe -PythonExe $VenvPython)) {
  if ($SkipInstall) {
    throw "Python $MinPythonMajor.$MinPythonMinor+ venv is required: $VenvPython"
  }
  $backupName = ".venv.old." + (Get-Date -Format "yyyyMMddHHmmss")
  Write-Host "Renaming incompatible Python venv to $backupName"
  Rename-Item (Join-Path $Root ".venv") $backupName
  New-Venv
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
