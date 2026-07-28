use super::types::HardwareSnapshot;
use rand::{distributions::Alphanumeric, Rng};
#[cfg(target_os = "windows")]
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri::AppHandle;
#[cfg(target_os = "windows")]
use tauri::{path::BaseDirectory, Manager};
#[cfg(not(target_os = "windows"))]
use chrono::Utc;

#[tauri::command]
pub async fn read_hardware_sensors(app: AppHandle, elevated: bool) -> Result<HardwareSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || read_hardware_sensors_blocking(app, elevated))
        .await
        .map_err(|_| "La lectura de temperatura se interrumpió.".to_string())?
}

fn read_hardware_sensors_blocking(app: AppHandle, elevated: bool) -> Result<HardwareSnapshot, String> {
    #[cfg(target_os = "windows")]
    {
        let Some(dll) = find_sensor_library(&app) else {
            return acpi_fallback("El componente de temperatura no está instalado.");
        };
        match run_lhm_snapshot(&dll, elevated) {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => {
                eprintln!("[nexo:sensors] {error}");
                acpi_fallback("La temperatura avanzada no está disponible en este equipo.")
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, elevated);
        Ok(HardwareSnapshot {
            generated_at: Utc::now().to_rfc3339(),
            source: "unavailable".to_string(),
            elevated: false,
            permission_required: false,
            note: "La temperatura está disponible solamente en Windows.".to_string(),
            sensors: vec![],
        })
    }
}

#[cfg(target_os = "windows")]
fn find_sensor_library(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for relative in [
        "resources/sensors/LibreHardwareMonitorLib.dll",
        "sensors/LibreHardwareMonitorLib.dll",
        "resources/LibreHardwareMonitorLib.dll",
    ] {
        if let Ok(path) = app.path().resolve(relative, BaseDirectory::Resource) {
            candidates.push(path);
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("sensors").join("LibreHardwareMonitorLib.dll"));
        candidates.push(resource_dir.join("sensors").join("LibreHardwareMonitorLib.dll"));
        candidates.push(resource_dir.join("LibreHardwareMonitorLib.dll"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join("sensors").join("LibreHardwareMonitorLib.dll"));
            candidates.push(dir.join("sensors").join("LibreHardwareMonitorLib.dll"));
            candidates.push(dir.join("LibreHardwareMonitorLib.dll"));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(target_os = "windows")]
fn lhm_script(elevated: bool) -> String {
    let elevated_literal = if elevated { "$true" } else { "$false" };
    format!(
        r#"
param([string]$DllPath, [string]$OutPath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$LibraryDir = Split-Path -Parent $DllPath
[Environment]::CurrentDirectory = $LibraryDir
$Resolver = [System.ResolveEventHandler]{{
  param($Sender, $Args)
  try {{
    $Name = (New-Object System.Reflection.AssemblyName($Args.Name)).Name + '.dll'
    $Candidate = Join-Path $LibraryDir $Name
    if (Test-Path $Candidate) {{ return [System.Reflection.Assembly]::LoadFrom($Candidate) }}
  }} catch {{}}
  return $null
}}
[AppDomain]::CurrentDomain.add_AssemblyResolve($Resolver)
try {{
  Add-Type -Path $DllPath
  $computer = [LibreHardwareMonitor.Hardware.Computer]::new()
  $computer.IsCpuEnabled = $true
  $computer.IsGpuEnabled = $true
  $computer.IsMemoryEnabled = $true
  $computer.IsMotherboardEnabled = $true
  $computer.IsControllerEnabled = $true
  $computer.IsStorageEnabled = $true
  $computer.IsNetworkEnabled = $false
  try {{
    $computer.Open()
    $sensors = New-Object System.Collections.Generic.List[object]
    function Read-Hardware([object]$hardware) {{
      $hardware.Update()
      foreach ($sensor in $hardware.Sensors) {{
        if ($null -ne $sensor.Value) {{
          $sensors.Add([PSCustomObject]@{{
            hardwareType = $hardware.HardwareType.ToString()
            hardwareName = $hardware.Name
            sensorType = $sensor.SensorType.ToString()
            sensorName = $sensor.Name
            value = [Math]::Round([double]$sensor.Value, 2)
            min = if ($null -ne $sensor.Min) {{ [Math]::Round([double]$sensor.Min, 2) }} else {{ $null }}
            max = if ($null -ne $sensor.Max) {{ [Math]::Round([double]$sensor.Max, 2) }} else {{ $null }}
          }})
        }}
      }}
      foreach ($sub in $hardware.SubHardware) {{ Read-Hardware $sub }}
    }}
    foreach ($hardware in $computer.Hardware) {{ Read-Hardware $hardware }}
    $cpuTemperature = @($sensors | Where-Object {{ $_.hardwareType -match 'Cpu' -and $_.sensorType -eq 'Temperature' }})
    $fanSensors = @($sensors | Where-Object {{ $_.sensorType -eq 'Fan' }})
    $permissionRequired = (-not {elevated_literal}) -and ($cpuTemperature.Count -eq 0 -and $fanSensors.Count -eq 0)
    $note = if ($permissionRequired) {{ 'Algunos sensores necesitan permiso de Windows.' }} elseif ($sensors.Count -eq 0) {{ 'Este equipo no expone temperaturas compatibles.' }} else {{ 'Temperaturas leídas directamente del hardware.' }}
    $result = [PSCustomObject]@{{ generatedAt = (Get-Date).ToUniversalTime().ToString('o'); source = 'libre-hardware-monitor'; elevated = {elevated_literal}; permissionRequired = [bool]$permissionRequired; note = $note; sensors = @($sensors) }}
    $json = $result | ConvertTo-Json -Compress -Depth 6
    [IO.File]::WriteAllText($OutPath, $json)
  }} finally {{
    try {{ $computer.Close() }} catch {{}}
  }}
}} finally {{
  [AppDomain]::CurrentDomain.remove_AssemblyResolve($Resolver)
}}
"#
    )
}

#[cfg(target_os = "windows")]
fn run_lhm_snapshot(dll: &Path, elevated: bool) -> Result<HardwareSnapshot, String> {
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();
    let temp = std::env::temp_dir();
    let script_path = temp.join(format!("nexo-sensors-{token}.ps1"));
    let output_path = temp.join(format!("nexo-sensors-{token}.json"));
    fs::write(&script_path, lhm_script(elevated))
        .map_err(|_| "No se pudo preparar la lectura de temperatura.".to_string())?;

    let result = if elevated {
        run_elevated(&script_path, dll, &output_path)
    } else {
        let mut command = Command::new("powershell");
        command
            .arg("-NoLogo")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(&script_path)
            .arg("-DllPath")
            .arg(dll)
            .arg("-OutPath")
            .arg(&output_path);
        let output = super::diagnostics::run_command_with_timeout(
            command,
            Duration::from_secs(28),
            "la lectura de sensores",
        )?;
        if output.status.success() {
            Ok(())
        } else {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !detail.is_empty() {
                eprintln!("[nexo:sensors:powershell] {detail}");
            }
            Err("El lector de temperatura no pudo iniciarse.".to_string())
        }
    };

    if let Err(error) = result {
        cleanup(&script_path, &output_path);
        return Err(error);
    }

    let raw = fs::read_to_string(&output_path)
        .map_err(|_| "No se recibió una lectura de temperatura.".to_string())?;
    cleanup(&script_path, &output_path);
    serde_json::from_str(&raw)
        .map_err(|_| "La lectura de temperatura no pudo interpretarse.".to_string())
}

#[cfg(target_os = "windows")]
fn run_elevated(script: &Path, dll: &Path, output: &Path) -> Result<(), String> {
    let escaped_script = ps_quote(script.to_string_lossy().as_ref());
    let escaped_dll = ps_quote(dll.to_string_lossy().as_ref());
    let escaped_output = ps_quote(output.to_string_lossy().as_ref());
    let command_text = format!(
        "$argsLine = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"{escaped_script}\" -DllPath \"{escaped_dll}\" -OutPath \"{escaped_output}\"'; $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList $argsLine; exit $p.ExitCode"
    );
    let mut command = Command::new("powershell");
    command.args([
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &command_text,
    ]);
    let result = super::diagnostics::run_command_with_timeout(
        command,
        Duration::from_secs(120),
        "la autorización de sensores",
    )?;
    if result.status.success() {
        Ok(())
    } else {
        Err("La autorización fue cancelada o Windows rechazó la lectura.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn cleanup(script: &Path, output: &Path) {
    let _ = fs::remove_file(script);
    let _ = fs::remove_file(output);
}

#[cfg(target_os = "windows")]
fn ps_quote(value: &str) -> String {
    value.replace('`', "``").replace('"', "`\"")
}

#[cfg(target_os = "windows")]
fn acpi_fallback(reason: &str) -> Result<HardwareSnapshot, String> {
    let raw = super::diagnostics::run_powershell(
        r#"
$zones = @()
try {
  $zones = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -OperationTimeoutSec 5 | ForEach-Object {
    if ($null -ne $_.CurrentTemperature) {
      [PSCustomObject]@{ hardwareType = 'Mainboard'; hardwareName = 'ACPI'; sensorType = 'Temperature'; sensorName = $_.InstanceName; value = [Math]::Round(($_.CurrentTemperature / 10) - 273.15, 1); min = $null; max = $null }
    }
  }
} catch {}
[PSCustomObject]@{ generatedAt = (Get-Date).ToUniversalTime().ToString('o'); source = 'acpi-fallback'; elevated = $false; permissionRequired = $false; note = ''; sensors = @($zones) } | ConvertTo-Json -Compress -Depth 5
"#,
    )?;
    let mut snapshot: HardwareSnapshot =
        serde_json::from_str(&raw).map_err(|_| "No se pudo leer la temperatura.".to_string())?;
    snapshot.note = if snapshot.sensors.is_empty() {
        reason.to_string()
    } else {
        "Temperatura aproximada del sistema. La CPU puede no estar disponible.".to_string()
    };
    Ok(snapshot)
}
