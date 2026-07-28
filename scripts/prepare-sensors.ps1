$ErrorActionPreference = 'Stop'
$Version = '0.9.6'
$Root = Split-Path -Parent $PSScriptRoot
$Destination = Join-Path $Root 'src-tauri\resources\sensors'
$MainDll = Join-Path $Destination 'LibreHardwareMonitorLib.dll'
$Marker = Join-Path $Destination '.nexo-sensors-version'

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$prepared = (Test-Path $MainDll) -and (Test-Path $Marker) -and ((Get-Content $Marker -Raw).Trim() -eq $Version)
if ($prepared) {
  $dllCount = @(Get-ChildItem $Destination -Filter '*.dll' -File).Count
  if ($dllCount -ge 4) {
    Write-Host "LibreHardwareMonitor $Version ya está preparado ($dllCount DLLs)."
    exit 0
  }
}

$Work = Join-Path $env:TEMP ("nexo-lhm-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Work | Out-Null

try {
  $Archive = Join-Path $Work 'LibreHardwareMonitor.zip'
  $Extracted = Join-Path $Work 'portable'
  $Url = "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v$Version/LibreHardwareMonitor.zip"

  Write-Host "Descargando distribución oficial de LibreHardwareMonitor $Version..."
  & curl.exe --fail --location --retry 3 --silent --show-error --output $Archive $Url
  if ($LASTEXITCODE -ne 0) { throw "GitHub rechazó la descarga con código $LASTEXITCODE." }
  if (-not (Test-Path $Archive)) { throw 'No se generó el archivo de sensores.' }
  if ((Get-Item $Archive).Length -lt 1000000) { throw 'La descarga de sensores es demasiado pequeña.' }

  Expand-Archive -Path $Archive -DestinationPath $Extracted -Force
  $SourceDll = Get-ChildItem $Extracted -Recurse -Filter 'LibreHardwareMonitorLib.dll' -File | Select-Object -First 1
  if (-not $SourceDll) { throw 'La distribución oficial no contiene LibreHardwareMonitorLib.dll.' }

  $SourceDirectory = $SourceDll.Directory.FullName
  Remove-Item (Join-Path $Destination '*') -Recurse -Force -ErrorAction SilentlyContinue

  $Patterns = @('*.dll', '*.sys', '*.config', '*.manifest', 'LICENSE*', 'THIRD-PARTY-LICENSES*')
  foreach ($Pattern in $Patterns) {
    Get-ChildItem $SourceDirectory -Filter $Pattern -File -ErrorAction SilentlyContinue | Copy-Item -Destination $Destination -Force
  }

  if (-not (Test-Path $MainDll)) { throw 'No se copió la biblioteca principal de sensores.' }

  $Required = @('LibreHardwareMonitorLib.dll', 'HidSharp.dll')
  foreach ($File in $Required) {
    if (-not (Test-Path (Join-Path $Destination $File))) {
      throw "La distribución de sensores quedó incompleta: falta $File."
    }
  }

  Set-Content -Path $Marker -Value $Version -Encoding ascii
  $dllCount = @(Get-ChildItem $Destination -Filter '*.dll' -File).Count
  $totalBytes = (Get-ChildItem $Destination -File | Measure-Object Length -Sum).Sum
  Write-Host "Sensores preparados: $dllCount DLLs, $totalBytes bytes."
} finally {
  Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
}
