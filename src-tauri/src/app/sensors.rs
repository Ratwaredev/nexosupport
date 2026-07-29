use super::types::HardwareSnapshot;
use rand::{distributions::Alphanumeric, Rng};
#[cfg(target_os = "windows")]
use std::{
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri::AppHandle;
#[cfg(target_os = "windows")]
use tauri::{path::BaseDirectory, Manager};
#[cfg(not(target_os = "windows"))]
use chrono::Utc;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub async fn read_hardware_sensors(app: AppHandle, elevated: bool) -> Result<HardwareSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || read_hardware_sensors_blocking(app, elevated))
        .await
        .map_err(|_| "La lectura de temperatura se interrumpió.".to_string())?
}

fn read_hardware_sensors_blocking(app: AppHandle, elevated: bool) -> Result<HardwareSnapshot, String> {
    #[cfg(target_os = "windows")]
    {
        let Some(helper) = find_sensor_helper(&app) else {
            return acpi_fallback("El lector de sensores no está instalado.");
        };

        match run_sensor_helper(&helper, elevated) {
            Ok(snapshot) if has_plausible_temperature(&snapshot) || snapshot.permission_required => Ok(snapshot),
            Ok(snapshot) => match acpi_fallback(&snapshot.note) {
                Ok(fallback) if has_plausible_temperature(&fallback) => Ok(fallback),
                _ => Ok(snapshot),
            },
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
fn find_sensor_helper(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for relative in [
        "resources/sensor-helper/Nexo.SensorReader.exe",
        "sensor-helper/Nexo.SensorReader.exe",
        "resources/Nexo.SensorReader.exe",
    ] {
        if let Ok(path) = app.path().resolve(relative, BaseDirectory::Resource) {
            candidates.push(path);
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("sensor-helper").join("Nexo.SensorReader.exe"));
        candidates.push(resource_dir.join("sensor-helper").join("Nexo.SensorReader.exe"));
        candidates.push(resource_dir.join("Nexo.SensorReader.exe"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join("sensor-helper").join("Nexo.SensorReader.exe"));
            candidates.push(dir.join("sensor-helper").join("Nexo.SensorReader.exe"));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(target_os = "windows")]
fn run_sensor_helper(helper: &Path, elevated: bool) -> Result<HardwareSnapshot, String> {
    let token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();
    let output_path = std::env::temp_dir().join(format!("nexo-sensors-{token}.json"));

    let result = if elevated {
        run_elevated(helper, &output_path)
    } else {
        let mut command = Command::new(helper);
        command
            .arg("--output")
            .arg(&output_path)
            .creation_flags(CREATE_NO_WINDOW);
        if let Some(directory) = helper.parent() {
            command.current_dir(directory);
        }
        let output = super::diagnostics::run_command_with_timeout(
            command,
            Duration::from_secs(42),
            "la lectura de sensores",
        )?;
        if output.status.success() {
            Ok(())
        } else {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !detail.is_empty() {
                eprintln!("[nexo:sensors:helper] {detail}");
            }
            Err("El lector de sensores no pudo iniciarse.".to_string())
        }
    };

    if let Err(error) = result {
        let _ = fs::remove_file(&output_path);
        return Err(error);
    }

    let raw = fs::read_to_string(&output_path)
        .map_err(|_| "No se recibió una lectura de temperatura.".to_string())?;
    let _ = fs::remove_file(&output_path);
    serde_json::from_str(&raw)
        .map_err(|_| "La lectura de temperatura no pudo interpretarse.".to_string())
}

#[cfg(target_os = "windows")]
fn run_elevated(helper: &Path, output: &Path) -> Result<(), String> {
    let escaped_helper = ps_quote(helper.to_string_lossy().as_ref());
    let escaped_output = ps_quote(output.to_string_lossy().as_ref());
    let command_text = format!(
        "$p = Start-Process -FilePath \"{escaped_helper}\" -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('--output', '\"{escaped_output}\"'); exit $p.ExitCode"
    );
    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &command_text,
        ])
        .creation_flags(CREATE_NO_WINDOW);
    let result = super::diagnostics::run_command_with_timeout(
        command,
        Duration::from_secs(140),
        "la autorización de sensores",
    )?;
    if result.status.success() {
        Ok(())
    } else {
        Err("La autorización fue cancelada o Windows rechazó la lectura.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn has_plausible_temperature(snapshot: &HardwareSnapshot) -> bool {
    snapshot.sensors.iter().any(|sensor| {
        sensor.sensor_type.eq_ignore_ascii_case("temperature")
            && sensor.value.is_finite()
            && sensor.value >= 5.0
            && sensor.value <= 125.0
    })
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
      $value = [Math]::Round(($_.CurrentTemperature / 10) - 273.15, 1)
      if ($value -ge 5 -and $value -le 125) {
        [PSCustomObject]@{ hardwareType = 'Mainboard'; hardwareName = 'ACPI'; sensorType = 'Temperature'; sensorName = $_.InstanceName; value = $value; min = $null; max = $null }
      }
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
        "Temperatura aproximada del sistema. Puede no representar la CPU.".to_string()
    };
    Ok(snapshot)
}
