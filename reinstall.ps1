param(
  [string]$RepoUrl = "https://github.com/ziggear/mt_splash_annotate.git",
  [string]$Branch = "main",
  [string]$InstallDir = "$env:LOCALAPPDATA\ManuTechHeightAnnotator"
)

$ErrorActionPreference = "Stop"

function Get-InstallerUrl {
  param(
    [string]$TargetRepoUrl,
    [string]$TargetBranch
  )
  if ($TargetRepoUrl -match "^https://github.com/([^/]+)/([^/.]+)(\.git)?$") {
    return "https://raw.githubusercontent.com/$($Matches[1])/$($Matches[2])/$TargetBranch/install.ps1"
  }
  return "https://raw.githubusercontent.com/ziggear/mt_splash_annotate/$TargetBranch/install.ps1"
}

function Stop-AppProcesses {
  $names = @(
    "manutech-height-backend",
    "ManuTech Height Annotator",
    "manutech-height-annotator"
  )
  foreach ($name in $names) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
Stop-AppProcesses

if (Test-Path $InstallDir) {
  $backup = "$InstallDir.old.$(Get-Date -Format 'yyyyMMddHHmmss')"
  Move-Item -Path $InstallDir -Destination $backup
  Write-Host "Existing install moved to $backup"
}

$installer = Join-Path $env:TEMP "manutech-height-install.ps1"
$installerUrl = Get-InstallerUrl -TargetRepoUrl $RepoUrl -TargetBranch $Branch
Invoke-WebRequest -Uri $installerUrl -OutFile $installer

& powershell -ExecutionPolicy Bypass -File $installer `
  -RepoUrl $RepoUrl `
  -Branch $Branch `
  -InstallDir $InstallDir
