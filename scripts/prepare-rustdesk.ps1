param(
  [string]$Version = '1.4.9'
)

$ErrorActionPreference = 'Stop'
$headers = @{
  'User-Agent' = 'NEXO-Support-Build'
  'Accept' = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
}
$token = if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) { $env:GITHUB_TOKEN } else { $env:GH_TOKEN }
if (-not [string]::IsNullOrWhiteSpace($token)) {
  $headers['Authorization'] = "Bearer $token"
}

$releaseUrl = "https://api.github.com/repos/rustdesk/rustdesk/releases/tags/$Version"
$release = Invoke-RestMethod -Uri $releaseUrl -Headers $headers -MaximumRetryCount 4 -RetryIntervalSec 3
$expectedName = "rustdesk-$Version-x86_64.exe"
$asset = @($release.assets | Where-Object { $_.name -eq $expectedName }) | Select-Object -First 1
if (-not $asset) { throw "RustDesk asset not found: $expectedName" }

$targetDirectory = Join-Path $PSScriptRoot '..\src-tauri\resources\rustdesk'
$targetDirectory = [System.IO.Path]::GetFullPath($targetDirectory)
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
$target = Join-Path $targetDirectory 'rustdesk-installer.exe'
Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $target -UseBasicParsing -MaximumRetryCount 4 -RetryIntervalSec 3

if ((Get-Item $target).Length -lt 5MB) { throw 'Downloaded RustDesk installer is unexpectedly small.' }
if ($asset.digest -and $asset.digest -match '^sha256:(.+)$') {
  $actual = (Get-FileHash -Path $target -Algorithm SHA256).Hash.ToLowerInvariant()
  $expected = $Matches[1].ToLowerInvariant()
  if ($actual -ne $expected) { throw "RustDesk SHA256 mismatch. Expected $expected, got $actual." }
} else {
  throw 'RustDesk release did not provide a SHA256 digest.'
}

Write-Host "RustDesk $Version prepared at $target"
