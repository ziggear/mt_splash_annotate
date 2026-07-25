param(
  [string]$RepoUrl = "https://github.com/ziggear/mt_splash_annotate.git",
  [string]$Branch = "main",
  [string]$InstallDir = "$env:LOCALAPPDATA\ManuTechHeightAnnotator",
  [string]$ModelDir = "",
  [switch]$SkipFrontendBuild
)

$ErrorActionPreference = "Stop"
$MinPythonMajor = 3
$MinPythonMinor = 10
$MaxPythonMajor = 3
$MaxPythonMinor = 12

function Install-PythonWithWinget {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (!$winget) {
    return $false
  }

  Write-Host "Python 3 was not found. Installing Python 3.12 with winget..."
  winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    return $false
  }

  $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $processPath = [System.Environment]::GetEnvironmentVariable("Path", "Process")
  $env:Path = "$processPath;$machinePath;$userPath"
  return $true
}

function Get-InstalledPythonExePaths {
  $roots = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Python"),
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)}
  )
  $paths = @()
  foreach ($root in $roots) {
    if (!$root -or !(Test-Path $root)) {
      continue
    }
    $dirs = Get-ChildItem -Path $root -Directory -Filter "Python*" -ErrorAction SilentlyContinue
    foreach ($dir in $dirs) {
      $pythonExe = Join-Path $dir.FullName "python.exe"
      if (Test-Path $pythonExe) {
        $paths += $pythonExe
      }
    }
  }
  return $paths | Sort-Object -Descending -Unique
}

function Get-PythonCandidates {
  $candidates = @(
    @{ Command = "py"; Args = @("-3.12") },
    @{ Command = "py"; Args = @("-3.11") },
    @{ Command = "py"; Args = @("-3.10") },
    @{ Command = "python"; Args = @() },
    @{ Command = "python3"; Args = @() }
  )
  foreach ($path in Get-InstalledPythonExePaths) {
    $candidates += @{ Command = $path; Args = @() }
  }
  return $candidates
}

function Test-PythonVersion {
  param(
    [int]$Major,
    [int]$Minor
  )

  $meetsMin = $Major -gt $MinPythonMajor -or ($Major -eq $MinPythonMajor -and $Minor -ge $MinPythonMinor)
  $meetsMax = $Major -lt $MaxPythonMajor -or ($Major -eq $MaxPythonMajor -and $Minor -le $MaxPythonMinor)
  return $meetsMin -and $meetsMax
}

function Test-PythonCandidate {
  param([hashtable]$Candidate)

  try {
    $versionText = & $Candidate.Command @($Candidate.Args + @("-c", "import sys; print(str(sys.version_info[0]) + '.' + str(sys.version_info[1]) + '.' + str(sys.version_info[2]))")) 2>&1
  } catch {
    return $false
  }
  if ($LASTEXITCODE -ne 0 -or !$versionText) {
    return $false
  }

  $parts = $versionText.Trim().Split(".")
  if ($parts.Count -lt 2) {
    return $false
  }
  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  if (Test-PythonVersion -Major $major -Minor $minor) {
    Write-Host "Using Python $versionText via $($Candidate.Command) $($Candidate.Args -join ' ')"
    return $true
  }

  Write-Host "Skipping Python $versionText via $($Candidate.Command) $($Candidate.Args -join ' '): Python $MinPythonMajor.$MinPythonMinor-$MaxPythonMajor.$MaxPythonMinor is required."
  return $false
}

function Find-Python {
  $candidates = Get-PythonCandidates
  foreach ($candidate in $candidates) {
    if (Test-PythonCandidate -Candidate $candidate) {
      return $candidate
    }
  }

  if (Install-PythonWithWinget) {
    $candidates = Get-PythonCandidates
    foreach ($candidate in $candidates) {
      if (Test-PythonCandidate -Candidate $candidate) {
        return $candidate
      }
    }
  }

  throw "Python $MinPythonMajor.$MinPythonMinor-$MaxPythonMajor.$MaxPythonMinor was not found. Install Python 3.12 from python.org, then rerun this script."
}

function Invoke-Python {
  param(
    [hashtable]$Python,
    [string[]]$ArgList
  )
  & $Python.Command @($Python.Args + $ArgList)
  if ($LASTEXITCODE -ne 0) {
    throw "Python command failed: $($Python.Command) $($Python.Args + $ArgList -join ' ')"
  }
}

function Install-BackendRequirements {
  & $VenvPython -m pip install -U pip
  if ($LASTEXITCODE -ne 0) {
    throw "pip upgrade failed."
  }
  & $VenvPython -m pip install -r (Join-Path $InstallDir "backend\requirements.txt")
  if ($LASTEXITCODE -ne 0) {
    throw "Backend dependency install failed."
  }
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

function Update-ExistingInstall {
  param(
    [string]$TargetDir,
    [string]$TargetBranch,
    [string]$TargetRepoUrl
  )

  $gitDir = Join-Path $TargetDir ".git"
  if (!(Test-Path $gitDir)) {
    $zipUrl = $TargetRepoUrl
    if ($TargetRepoUrl.EndsWith(".git")) {
      $zipUrl = $TargetRepoUrl.Substring(0, $TargetRepoUrl.Length - 4) + "/archive/refs/heads/$TargetBranch.zip"
    }
    $zipPath = Join-Path $env:TEMP "manutech-height-annotator-update.zip"
    $extractDir = Join-Path $env:TEMP ("manutech-height-annotator-update-" + [guid]::NewGuid().ToString("N"))
    Write-Host "Updating existing non-git install from $zipUrl"
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    $child = Get-ChildItem $extractDir | Select-Object -First 1
    Copy-Item -Path (Join-Path $child.FullName "*") -Destination $TargetDir -Recurse -Force
    return
  }

  $git = Get-Command git -ErrorAction SilentlyContinue
  if (!$git) {
    Write-Warning "Git is not available, so the existing install cannot be updated automatically: $TargetDir"
    return
  }

  Push-Location $TargetDir
  try {
    git fetch origin $TargetBranch
    git checkout $TargetBranch
    git pull --ff-only origin $TargetBranch
  } finally {
    Pop-Location
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
  Update-ExistingInstall -TargetDir $InstallDir -TargetBranch $Branch -TargetRepoUrl $RepoUrl
}

Set-Location $InstallDir

$Python = Find-Python
$VenvPython = Join-Path $InstallDir ".venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
  $venvCandidate = @{ Command = $VenvPython; Args = @() }
  if (!(Test-PythonCandidate -Candidate $venvCandidate)) {
    $backupName = ".venv.old." + (Get-Date -Format "yyyyMMddHHmmss")
    Write-Host "Renaming incompatible Python venv to $backupName"
    Rename-Item ".venv" $backupName
  }
}
if (!(Test-Path $VenvPython)) {
  Invoke-Python -Python $Python -ArgList @("-m", "venv", ".venv")
}

Install-BackendRequirements

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
