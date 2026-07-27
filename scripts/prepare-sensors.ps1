$ErrorActionPreference = 'Stop'
$Version = '0.9.6'
$Root = Split-Path -Parent $PSScriptRoot
$Destination = Join-Path $Root 'src-tauri\resources'
$DllTarget = Join-Path $Destination 'LibreHardwareMonitorLib.dll'
$LicenseTarget = Join-Path $Destination 'LibreHardwareMonitor.LICENSE.txt'

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
if ((Test-Path $DllTarget) -and (Test-Path $LicenseTarget)) {
  Write-Host 'LibreHardwareMonitor ya está preparado.'
  exit 0
}

$Work = Join-Path $env:TEMP ("nexo-lhm-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Work | Out-Null
try {
  $Package = Join-Path $Work 'librehardwaremonitorlib.zip'
  $PackageUrl = "https://api.nuget.org/v3-flatcontainer/librehardwaremonitorlib/$Version/librehardwaremonitorlib.$Version.nupkg"
  Write-Host "Descargando LibreHardwareMonitorLib $Version desde NuGet oficial..."
  Invoke-WebRequest -UseBasicParsing -Uri $PackageUrl -OutFile $Package
  Expand-Archive -Path $Package -DestinationPath (Join-Path $Work 'package') -Force

  $Candidates = @(
    (Join-Path $Work 'package\lib\net472\LibreHardwareMonitorLib.dll'),
    (Join-Path $Work 'package\lib\netstandard2.0\LibreHardwareMonitorLib.dll'),
    (Join-Path $Work 'package\lib\net8.0\LibreHardwareMonitorLib.dll')
  )
  $Dll = $Candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $Dll) {
    $Dll = Get-ChildItem (Join-Path $Work 'package') -Recurse -Filter 'LibreHardwareMonitorLib.dll' | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $Dll) { throw 'El paquete oficial no contiene LibreHardwareMonitorLib.dll.' }
  Copy-Item $Dll $DllTarget -Force

  $LicenseUrl = "https://raw.githubusercontent.com/LibreHardwareMonitor/LibreHardwareMonitor/v$Version/LICENSE"
  $ThirdPartyUrl = "https://raw.githubusercontent.com/LibreHardwareMonitor/LibreHardwareMonitor/v$Version/THIRD-PARTY-LICENSES"
  $License = "LibreHardwareMonitor v$Version`r`nOfficial project: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor`r`n`r`n"
  try { $License += (Invoke-WebRequest -UseBasicParsing -Uri $LicenseUrl).Content } catch { $License += 'Licensed under MPL-2.0.' }
  try { $License += "`r`n`r`nTHIRD-PARTY LICENSES`r`n" + (Invoke-WebRequest -UseBasicParsing -Uri $ThirdPartyUrl).Content } catch {}
  [IO.File]::WriteAllText($LicenseTarget, $License)

  $Hash = (Get-FileHash $DllTarget -Algorithm SHA256).Hash
  Write-Host "Sensor library ready. SHA256: $Hash"
} finally {
  Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
}
