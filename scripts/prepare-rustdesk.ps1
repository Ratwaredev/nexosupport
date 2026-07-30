param(
  [string]$Version = '1.4.9'
)

$ErrorActionPreference = 'Stop'
$headers = @{ 'User-Agent' = 'NEXO-Support-Build' }
$releaseUrl = "https://api.github.com/repos/rustdesk/rustdesk/releases/tags/$Version"
$release = Invoke-RestMethod -Uri $releaseUrl -Headers $headers
$expectedName = "rustdesk-$Version-x86_64.exe"
$asset = @($release.assets | Where-Object { $_.name -eq $expectedName }) | Select-Object -First 1
if (-not $asset) { throw "RustDesk asset not found: $expectedName" }

$targetDirectory = Join-Path $PSScriptRoot '..\src-tauri\resources\rustdesk'
$targetDirectory = [System.IO.Path]::GetFullPath($targetDirectory)
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
$target = Join-Path $targetDirectory 'rustdesk-installer.exe'
Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $target -UseBasicParsing

if ((Get-Item $target).Length -lt 5MB) { throw 'Downloaded RustDesk installer is unexpectedly small.' }
if ($asset.digest -and $asset.digest -match '^sha256:(.+)$') {
  $actual = (Get-FileHash -Path $target -Algorithm SHA256).Hash.ToLowerInvariant()
  $expected = $Matches[1].ToLowerInvariant()
  if ($actual -ne $expected) { throw "RustDesk SHA256 mismatch. Expected $expected, got $actual." }
}

Write-Host "RustDesk $Version prepared at $target"
