param(
  [string]$Version = '1.4.9',
  [string]$ReleaseTag = 'nightly',
  [string]$Sha256 = '4cd9af0d822891f2676088e11c869d4a75d956ee7af50797092986b6d4878f85'
)

$ErrorActionPreference = 'Stop'
$headers = @{ 'User-Agent' = 'NEXO-Support-Build' }
$fileName = "rustdesk-$Version-x86_64.exe"
$downloadUrl = "https://github.com/rustdesk/rustdesk/releases/download/$ReleaseTag/$fileName"

$targetDirectory = Join-Path $PSScriptRoot '..\src-tauri\resources\rustdesk'
$targetDirectory = [System.IO.Path]::GetFullPath($targetDirectory)
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
$target = Join-Path $targetDirectory 'rustdesk-installer.exe'

Invoke-WebRequest -Uri $downloadUrl -Headers $headers -OutFile $target -UseBasicParsing -MaximumRetryCount 4 -RetryIntervalSec 3
if ((Get-Item $target).Length -lt 5MB) { throw 'Downloaded RustDesk installer is unexpectedly small.' }

$actual = (Get-FileHash -Path $target -Algorithm SHA256).Hash.ToLowerInvariant()
$expected = $Sha256.Trim().ToLowerInvariant()
if ($actual -ne $expected) {
  Remove-Item $target -Force -ErrorAction SilentlyContinue
  throw "RustDesk SHA256 mismatch. Expected $expected, got $actual. Update the pinned artifact intentionally before shipping."
}

Write-Host "RustDesk $Version prepared from pinned artifact: $target"
