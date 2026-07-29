use super::types::DiagnosticReport;
#[cfg(not(target_os = "windows"))]
use super::types::ThermalZoneReading;
#[cfg(not(target_os = "windows"))]
use chrono::Utc;
#[cfg(target_os = "windows")]
use std::{
    os::windows::process::CommandExt,
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub async fn run_quick_diagnostic() -> Result<DiagnosticReport, String> {
    tauri::async_runtime::spawn_blocking(run_quick_diagnostic_blocking)
        .await
        .map_err(|error| format!("El diagnóstico se interrumpió: {error}"))?
}

fn run_quick_diagnostic_blocking() -> Result<DiagnosticReport, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = run_windows_diagnostic()?;
        let mut report: DiagnosticReport = serde_json::from_str(&raw)
            .map_err(|error| format!("No se pudo interpretar el diagnóstico: {error}."))?;
        report.recommendations = build_recommendations(&report);
        Ok(report)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(DiagnosticReport {
            generated_at: Utc::now().to_rfc3339(),
            computer_name: "Equipo no Windows".to_string(),
            user_name: whoami_fallback(),
            os: std::env::consts::OS.to_string(),
            cpu: "No detectado".to_string(),
            ram_total_gb: 0.0,
            ram_free_gb: 0.0,
            system_drive_total_gb: 0.0,
            system_drive_free_gb: 0.0,
            startup_items: 0,
            defender_status: "No aplica".to_string(),
            pending_reboot: false,
            max_temperature_c: None,
            temperature_note: "La lectura de hardware está disponible en Windows.".to_string(),
            thermal_zones: Vec::<ThermalZoneReading>::new(),
            recommendations: vec![],
        })
    }
}

#[cfg(target_os = "windows")]
fn run_windows_diagnostic() -> Result<String, String> {
    run_powershell(
        r#"
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 5
$cpu = Get-CimInstance Win32_Processor -OperationTimeoutSec 5 | Select-Object -First 1
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -OperationTimeoutSec 5
$startupCount = (Get-CimInstance Win32_StartupCommand -OperationTimeoutSec 5 | Measure-Object).Count
$defender = Get-MpComputerStatus
$pending = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
$defenderStatus = if ($defender.AMServiceEnabled -eq $true) { 'Activo' } elseif ($null -eq $defender) { 'No detectado' } else { 'Revisar' }
[PSCustomObject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  computerName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'Mi PC' }
  userName = if ($env:USERNAME) { $env:USERNAME } else { 'Usuario' }
  os = if ($os) { ($os.Caption + ' ' + $os.Version) } else { 'Windows' }
  cpu = if ($cpu) { $cpu.Name } else { 'No detectado' }
  ramTotalGb = if ($os) { [Math]::Round($os.TotalVisibleMemorySize / 1MB, 1) } else { 0 }
  ramFreeGb = if ($os) { [Math]::Round($os.FreePhysicalMemory / 1MB, 1) } else { 0 }
  systemDriveTotalGb = if ($disk) { [Math]::Round($disk.Size / 1GB, 1) } else { 0 }
  systemDriveFreeGb = if ($disk) { [Math]::Round($disk.FreeSpace / 1GB, 1) } else { 0 }
  startupItems = [int]$startupCount
  defenderStatus = $defenderStatus
  pendingReboot = [bool]$pending
  maxTemperatureC = $null
  temperatureNote = 'La temperatura exacta se obtiene mediante la lectura de sensores autorizada.'
  thermalZones = @()
  recommendations = @()
} | ConvertTo-Json -Compress -Depth 4
"#,
    )
}

fn build_recommendations(report: &DiagnosticReport) -> Vec<String> {
    let mut items = Vec::new();
    if report.system_drive_total_gb > 0.0
        && report.system_drive_free_gb / report.system_drive_total_gb < 0.15
    {
        items.push("Hay poco espacio libre en el disco principal.".to_string());
    }
    if report.startup_items > 14 {
        items.push("Hay muchos programas arrancando con Windows.".to_string());
    }
    if report.pending_reboot {
        items.push("Windows tiene un reinicio pendiente.".to_string());
    }
    if report.defender_status != "Activo" {
        items.push("La protección de Windows necesita revisión.".to_string());
    }
    items
}

#[cfg(target_os = "windows")]
pub fn run_powershell(script: &str) -> Result<String, String> {
    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW);
    let output = run_command_with_timeout(command, Duration::from_secs(18), "La herramienta de Windows")?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "Windows rechazó la acción.".to_string()
        } else {
            detail
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "windows")]
pub fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
    label: &str,
) -> Result<Output, String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("No se pudo iniciar {label}: {error}"))?;
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|error| format!("No se pudo obtener el resultado de {label}: {error}"));
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{label} tardó demasiado y fue detenida."));
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("No se pudo comprobar {label}: {error}"));
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn whoami_fallback() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "usuario".to_string())
}
