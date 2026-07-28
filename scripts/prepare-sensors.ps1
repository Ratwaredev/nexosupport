$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $Root 'tools\Nexo.SensorReader\Nexo.SensorReader.csproj'
$Destination = Join-Path $Root 'src-tauri\resources\sensor-helper'
$Executable = Join-Path $Destination 'Nexo.SensorReader.exe'

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw '.NET SDK 8 is required to build the NEXO sensor reader.'
}

Remove-Item $Destination -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

Write-Host 'Publishing native NEXO sensor reader...'
dotnet publish $Project `
  --configuration Release `
  --runtime win-x64 `
  --self-contained true `
  --output $Destination `
  /p:PublishSingleFile=false `
  /p:PublishTrimmed=false
if ($LASTEXITCODE -ne 0) { throw "Sensor reader publish failed with code $LASTEXITCODE." }

if (-not (Test-Path $Executable)) { throw 'Nexo.SensorReader.exe was not generated.' }
$mainDll = Join-Path $Destination 'LibreHardwareMonitorLib.dll'
if (-not (Test-Path $mainDll)) { throw 'LibreHardwareMonitorLib.dll was not published with the helper.' }

$files = @(Get-ChildItem $Destination -File)
$totalBytes = ($files | Measure-Object Length -Sum).Sum
if ($files.Count -lt 10 -or $totalBytes -lt 10000000) {
  throw "The self-contained sensor helper looks incomplete: $($files.Count) files, $totalBytes bytes."
}

Write-Host "Sensor helper prepared: $($files.Count) files, $totalBytes bytes."
