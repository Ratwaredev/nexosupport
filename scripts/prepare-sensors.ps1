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
$Packages = Join-Path $Work 'packages'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
try {
  $Project = Join-Path $Work 'Sensors.csproj'
  @"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup><PackageReference Include="LibreHardwareMonitorLib" Version="$Version" /></ItemGroup>
</Project>
"@ | Set-Content -Path $Project -Encoding UTF8

  Write-Host "Restaurando LibreHardwareMonitorLib $Version desde NuGet oficial..."
  dotnet restore $Project --packages $Packages --nologo
  if ($LASTEXITCODE -ne 0) { throw 'NuGet no pudo restaurar LibreHardwareMonitorLib.' }

  $PackageRoot = Join-Path $Packages "librehardwaremonitorlib\$Version"
  $Candidates = @(
    (Join-Path $PackageRoot 'lib\net472\LibreHardwareMonitorLib.dll'),
    (Join-Path $PackageRoot 'lib\netstandard2.0\LibreHardwareMonitorLib.dll'),
    (Join-Path $PackageRoot 'lib\net8.0\LibreHardwareMonitorLib.dll')
  )
  $Dll = $Candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $Dll) {
    $Dll = Get-ChildItem $PackageRoot -Recurse -Filter 'LibreHardwareMonitorLib.dll' | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $Dll) { throw 'El paquete oficial no contiene LibreHardwareMonitorLib.dll.' }
  Copy-Item $Dll $DllTarget -Force

  $LicenseFile = Get-ChildItem $PackageRoot -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|LICENSE\.txt|license\.md)$' } | Select-Object -First 1
  if ($LicenseFile) {
    Copy-Item $LicenseFile.FullName $LicenseTarget -Force
  } else {
    @"
LibreHardwareMonitorLib $Version
Official project: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor
License: Mozilla Public License 2.0 (MPL-2.0)
Package: https://www.nuget.org/packages/LibreHardwareMonitorLib/$Version
"@ | Set-Content -Path $LicenseTarget -Encoding UTF8
  }

  $Hash = (Get-FileHash $DllTarget -Algorithm SHA256).Hash
  Write-Host "Sensor library ready. SHA256: $Hash"
} finally {
  Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
}
