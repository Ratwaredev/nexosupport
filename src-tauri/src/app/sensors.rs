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
        .map_err(|error| format!("La lectura de sensores se interrumpió: {error}"))?
}

fn read_hardware_sensors_blocking(app: AppHandle, elevated: bool) -> Result<HardwareSnapshot, String> {
    #[cfg(target_os = "windows")]
    {
        let Some(dll) = find_sensor_library(&app) else {
            return acpi_fallback("No se encontró el componente de sensores. Volvé a instalar o actualizar NEXO Support.");
        };
        match run_lhm_snapshot(&dll, elevated) {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => acpi_fallback(&format!("No se pudo iniciar la lectura completa: {error}")),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, elevated);
        Ok(HardwareSnapshot {
            generated_at: Utc::now().to_rfc3339(),
            source: "acpi-fallback".to_string(),
            elevated: false,
            permission_required: false,
            note: "Los sensores avanzados están disponibles en Windows.".to_string(),
            sensors: vec![],
        })
    }
}

#[cfg(target_os = "windows")]
fn find_sensor_library(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(path) = app
        .path()
        .resolve("resources/LibreHardwareMonitorLib.dll", BaseDirectory::Resource)
    {
        candidates.push(path);
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("LibreHardwareMonitorLib.dll"));
        candidates.push(resource_dir.join("LibreHardwareMonitorLib.dll"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join("LibreHardwareMonitorLib.dll"));
            candidates.push(dir.join("LibreHardwareMonitorLib.dll"));
        }
    }
    candidates.into_iter().find(|path| path.exists())
}

#[cfg(target_os = "windows")]
fn lhm_script(elevated: bool) -> String {
    let elevated_literal = if elevated { "$true" } else { "$false" };
    format!(
        r#"
param([string]$DllPath, [string]$OutPath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
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
  $note = if ($permissionRequired) {{ 'Windows no expuso algunos sensores. Podés intentar una lectura avanzada con autorización.' }} elseif ($sensors.Count -eq 0) {{ 'La placa o sus controladores no exponen sensores compatibles.' }} else {{ 'Lectura directa de los sensores expuestos por el hardware.' }}
  $result = [PSCustomObject]@{{ generatedAt = (Get-Date).ToUniversalTime().ToString('o'); source = 'libre-hardware-monitor'; elevated = {elevated_literal}; permissionRequired = [bool]$permissionRequired; note = $note; sensors = @($sensors) }}
  $json = $result | ConvertTo-Json -Compress -Depth 6
  [IO.File]::WriteAllText($OutPath, $json)
}} finally {{
  try {{ $computer.Close() }} catch {{}}
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
        .map_err(|error| format!("No se pudo preparar la lectura: {error}"))?;

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
            Duration::from_secs(24),
            "la lectura de sensores",
        )?;
        if output.status.success() {
            Ok(())
        } else {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if detail.is_empty() {
                "Windows rechazó la lectura de sensores.".to_string()
            } else {
                detail
            })
        }
    };

    if let Err(error) = result {
        cleanup(&script_path, &output_path);
        return Err(error);
    }

    let raw = fs::read_to_string(&output_path)
        .map_err(|error| format!("No se encontró el resultado de sensores: {error}"))?;
    cleanup(&script_path, &output_path);
    serde_json::from_str(&raw)
        .map_err(|error| format!("La lectura de sensores devolvió datos inválidos: {error}"))
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
[PSCustomObject]@{ generatedAt = (Get-Date).ToUniversalTime().ToString('o'); source = 'acpi-fallback'; elevated = $false; permissionRequired = $false; note = 'Lectura ACPI limitada: no representa necesariamente la temperatura exacta del procesador.'; sensors = @($zones) } | ConvertTo-Json -Compress -Depth 5
"#,
    )?;
    let mut snapshot: HardwareSnapshot =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    snapshot.note = format!("{} {}", snapshot.note, reason);
    Ok(snapshot)
}
