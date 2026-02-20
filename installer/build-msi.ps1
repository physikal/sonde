#Requires -Version 7.0
<#
.SYNOPSIS
  Builds the Sonde Hub MSI installer.

.DESCRIPTION
  1. Downloads Node.js 22 LTS (x64 zip) and extracts node.exe
  2. Builds all monorepo packages (turbo build)
  3. Stages the production app payload
  4. Downloads WinSW binary
  5. Invokes WiX v5 to produce the MSI

.NOTES
  Prerequisites: .NET 8 SDK, WiX v5 CLI (dotnet tool install --global wix)
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$InstallerDir = $PSScriptRoot
$StageDir = Join-Path $InstallerDir 'stage'
$OutDir = Join-Path $InstallerDir 'out'

$NodeVersion = '22.13.1'
$NodeZipUrl = "https://nodejs.org/dist/v${NodeVersion}/node-v${NodeVersion}-win-x64.zip"
$NodeZipSha256 = '398a61e250a5584a62a5959e2f69f5d597fc83f1a5ebe3ed8fff29ba39d55f14'
$WinSWVersion = '2.12.0'
$WinSWUrl = "https://github.com/winsw/winsw/releases/download/v${WinSWVersion}/WinSW-x64.exe"
# WinSW does not publish checksums. Populate by running:
#   (Get-FileHash WinSW-x64.exe -Algorithm SHA256).Hash
$WinSWSha256 = ''

# Read hub version from package.json
$HubPkg = Get-Content (Join-Path $RepoRoot 'packages/hub/package.json') |
  ConvertFrom-Json
$Version = $HubPkg.version

function Assert-FileHash {
  param([string]$Path, [string]$ExpectedHash)
  if (-not $ExpectedHash) {
    Write-Host "  (checksum verification skipped — no hash configured)" -ForegroundColor DarkGray
    return
  }
  $Actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash
  if ($Actual -ne $ExpectedHash.ToUpper()) {
    Write-Error ("Checksum mismatch for {0}`n  Expected: {1}`n  Actual:   {2}" -f $Path, $ExpectedHash, $Actual)
    exit 1
  }
}

Write-Host "Building Sonde Hub MSI v${Version}" -ForegroundColor Cyan
Write-Host "  Node.js: v${NodeVersion}"
Write-Host "  WinSW:   v${WinSWVersion}"
Write-Host ""

# Clean previous stage
if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $StageDir | Out-Null
New-Item -ItemType Directory -Path $OutDir | Out-Null

# --- Step 1: Download Node.js ---
Write-Host "[1/5] Downloading Node.js v${NodeVersion}..." -ForegroundColor Yellow
$NodeZip = Join-Path $env:TEMP "node-v${NodeVersion}-win-x64.zip"
if (-not (Test-Path $NodeZip)) {
  Invoke-WebRequest -Uri $NodeZipUrl -OutFile $NodeZip -UseBasicParsing
}
Assert-FileHash -Path $NodeZip -ExpectedHash $NodeZipSha256

$NodeStage = Join-Path $StageDir 'node'
New-Item -ItemType Directory -Path $NodeStage | Out-Null

$NodeExtract = Join-Path $env:TEMP "node-v${NodeVersion}-win-x64"
if (-not (Test-Path $NodeExtract)) {
  Expand-Archive -Path $NodeZip -DestinationPath $env:TEMP -Force
}
Copy-Item (Join-Path $NodeExtract "node-v${NodeVersion}-win-x64\node.exe") `
  -Destination $NodeStage

# --- Step 2: Build monorepo ---
Write-Host "[2/5] Building monorepo packages..." -ForegroundColor Yellow
Push-Location $RepoRoot
try {
  npm ci
  npx turbo build
} finally {
  Pop-Location
}

# --- Step 3: Stage app payload ---
Write-Host "[3/5] Staging production app payload..." -ForegroundColor Yellow
$AppStage = Join-Path $StageDir 'app'
New-Item -ItemType Directory -Path $AppStage | Out-Null

# Copy root package.json and package-lock.json
Copy-Item (Join-Path $RepoRoot 'package.json') -Destination $AppStage
Copy-Item (Join-Path $RepoRoot 'package-lock.json') -Destination $AppStage

# Copy workspace packages (dist + package.json only)
$Packages = @('shared', 'packs', 'hub', 'dashboard')
foreach ($pkg in $Packages) {
  $SrcPkg = Join-Path $RepoRoot "packages/$pkg"
  $DstPkg = Join-Path $AppStage "packages/$pkg"
  New-Item -ItemType Directory -Path $DstPkg -Force | Out-Null

  # Copy dist
  $DistDir = Join-Path $SrcPkg 'dist'
  if (Test-Path $DistDir) {
    Copy-Item $DistDir -Destination $DstPkg -Recurse
  }

  # Copy package.json
  Copy-Item (Join-Path $SrcPkg 'package.json') -Destination $DstPkg
}

# Install production dependencies in staged app
Push-Location $AppStage
try {
  npm ci --omit=dev
} finally {
  Pop-Location
}

# Copy setup-env.cjs into staged app for custom action
$ScriptsStage = Join-Path $AppStage 'installer-scripts'
New-Item -ItemType Directory -Path $ScriptsStage | Out-Null
Copy-Item (Join-Path $InstallerDir 'scripts/setup-env.cjs') -Destination $ScriptsStage

# --- Step 4: Download WinSW + stage service configs ---
Write-Host "[4/5] Downloading WinSW v${WinSWVersion}..." -ForegroundColor Yellow
$ServiceStage = Join-Path $StageDir 'service'
New-Item -ItemType Directory -Path $ServiceStage | Out-Null

$WinSWExe = Join-Path $ServiceStage 'sonde-hub.exe'
if (-not (Test-Path $WinSWExe)) {
  Invoke-WebRequest -Uri $WinSWUrl -OutFile $WinSWExe -UseBasicParsing
}
Assert-FileHash -Path $WinSWExe -ExpectedHash $WinSWSha256

# Copy service config files
Copy-Item (Join-Path $InstallerDir 'service-configs/sonde-hub.xml') `
  -Destination $ServiceStage
Copy-Item (Join-Path $InstallerDir 'service-configs/start-hub.cmd') `
  -Destination $ServiceStage

# --- Step 5: Build MSI ---
Write-Host "[5/5] Building MSI with WiX..." -ForegroundColor Yellow
$WxsFiles = Get-ChildItem (Join-Path $InstallerDir 'wix') -Filter '*.wxs' |
  ForEach-Object { $_.FullName }

$MsiPath = Join-Path $OutDir "sonde-hub-${Version}-x64.msi"

$WixArgs = @('build')
$WixArgs += $WxsFiles
$WixArgs += '-ext', 'WixToolset.Util.wixext'
$WixArgs += '-d', "StageDir=$StageDir"
$WixArgs += '-d', "Version=$Version"
$WixArgs += '-arch', 'x64'
$WixArgs += '-o', $MsiPath

wix @WixArgs

if ($LASTEXITCODE -ne 0) {
  Write-Error "WiX build failed with exit code $LASTEXITCODE"
  exit 1
}

$MsiSize = [math]::Round((Get-Item $MsiPath).Length / 1MB, 1)
Write-Host ""
Write-Host "MSI built: $MsiPath ($MsiSize MB)" -ForegroundColor Green
