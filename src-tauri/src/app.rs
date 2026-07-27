#[cfg(not(target_os = "windows"))]
use chrono::Utc;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, process::Command};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition, WindowEvent,
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticReport {
    generated_at: String,
    computer_name: String,
    user_name: String,
    os: String,
    cpu: String,
    ram_total_gb: f64,
    ram_free_gb: f64,
    system_drive_total_gb: f64,
    system_drive_free_gb: f64,
    startup_items: i64,
    defender_status: String,
    pending_reboot: bool,
    max_temperature_c: Option<f64>,
    temperature_note: String,
    thermal_zones: Vec<ThermalZoneReading>,
    recommendations: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThermalZoneReading {
    name: String,
    temperature_c: Option<f64>,
    source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteSession {
    code: String,
    expires_in_minutes: u8,
    instructions: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentStatus {
    mode: String,
    monitoring: bool,
    version: String,
    notes: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentActionResult {
    action: String,
    ok: bool,
    message: String,
    details: Vec<String>,
}

#[tauri::command]
fn hide_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn minimize_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn position_popup(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let monitor_size = monitor.size();
    let origin = monitor.position();
    let x = origin.x + monitor_size.width as i32 - size.width as i32 - 18;
    let y = origin.y + monitor_size.height as i32 - size.height as i32 - 66;
    let _ = window.set_position(PhysicalPosition::new(x.max(origin.x), y.max(origin.y)));
}

fn toggle_popup(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    position_popup(&window);
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
fn run_quick_diagnostic() -> Result<DiagnosticReport, String> {
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
            temperature_note: "No disponible fuera de Windows.".to_string(),
            thermal_zones: vec![],
            recommendations: vec!["NEXO Support prioriza Windows en esta versión.".to_string()],
        })
    }
}

#[tauri::command]
fn thermal_status() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = run_windows_thermal_status()?;
        Ok(action_ok("thermal_status", "Temperatura revisada.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(action_ok("thermal_status", "La temperatura ACPI no está disponible en este sistema.", vec![]))
    }
}

#[tauri::command]
fn create_remote_session() -> Result<RemoteSession, String> {
    let code: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(6)
        .map(char::from)
        .collect::<String>()
        .to_uppercase();
    Ok(RemoteSession {
        code,
        expires_in_minutes: 20,
        instructions: "La conexión remota solo se abre con autorización visible del usuario.".to_string(),
    })
}

#[tauri::command]
fn agent_status() -> Result<AgentStatus, String> {
    Ok(AgentStatus {
        mode: "tray-on-demand".to_string(),
        monitoring: true,
        version: env!("CARGO_PKG_VERSION").to_string(),
        notes: "NEXO realiza revisiones livianas y solo ejecuta cambios después de una confirmación visible.".to_string(),
    })
}

#[tauri::command]
fn run_agent_action(action_id: String) -> Result<AgentActionResult, String> {
    match action_id.as_str() {
        "temp_scan" => scan_temp_files(),
        "startup_review" => startup_review(),
        "windows_update" => open_windows_update(),
        "defender_status" => defender_status(),
        "defender_quick_scan" => defender_quick_scan(),
        "thermal_status" => thermal_status(),
        "network_check" => network_check(),
        "repair_network" => repair_network(),
        "clean_temp_files" => clean_temp_files(),
        other => Ok(AgentActionResult {
            action: other.to_string(),
            ok: false,
            message: "Esa acción no está autorizada por NEXO.".to_string(),
            details: vec!["No se ejecutó ningún comando.".to_string()],
        }),
    }
}

#[tauri::command]
fn open_remote_tool() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(path) = find_rustdesk() {
            Command::new("cmd")
                .arg("/C")
                .arg("start")
                .arg("")
                .arg(path.as_os_str())
                .spawn()
                .map_err(|error| format!("No se pudo abrir la asistencia remota: {error}"))?;
            return Ok("Asistencia remota abierta. El usuario mantiene el control.".to_string());
        }
        Ok("No encontré la herramienta remota instalada. El pedido técnico quedó creado.".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok("La conexión remota de esta versión está preparada para Windows.".to_string())
    }
}

fn action_ok(action: &str, message: &str, details: Vec<String>) -> AgentActionResult {
    AgentActionResult { action: action.to_string(), ok: true, message: message.to_string(), details }
}

#[cfg(target_os = "windows")]
fn run_windows_diagnostic() -> Result<String, String> {
    run_powershell(r#"
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$startupCount = (Get-CimInstance Win32_StartupCommand | Measure-Object).Count
$defender = Get-MpComputerStatus
$pending = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
$defenderStatus = if ($defender.AMServiceEnabled -eq $true) { 'Activo' } elseif ($null -eq $defender) { 'No detectado' } else { 'Revisar' }
$thermalZones = @()
try {
  $thermalZones = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | ForEach-Object {
    $tempC = if ($null -ne $_.CurrentTemperature) { [Math]::Round(($_.CurrentTemperature / 10) - 273.15, 1) } else { $null }
    [PSCustomObject]@{ name = $_.InstanceName; temperatureC = $tempC; source = 'root\wmi:MSAcpi_ThermalZoneTemperature' }
  }
} catch { $thermalZones = @() }
$validTemps = $thermalZones | Where-Object { $null -ne $_.temperatureC }
$maxTemperatureC = if ($validTemps.Count -gt 0) { [Math]::Round((($validTemps | Measure-Object temperatureC -Maximum).Maximum), 1) } else { $null }
$temperatureNote = if ($validTemps.Count -gt 0) { 'Lectura térmica ACPI disponible.' } else { 'Windows no expuso una lectura térmica compatible.' }
[PSCustomObject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  computerName = $env:COMPUTERNAME
  userName = $env:USERNAME
  os = ($os.Caption + ' ' + $os.Version)
  cpu = $cpu.Name
  ramTotalGb = [Math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  ramFreeGb = [Math]::Round($os.FreePhysicalMemory / 1MB, 1)
  systemDriveTotalGb = [Math]::Round($disk.Size / 1GB, 1)
  systemDriveFreeGb = [Math]::Round($disk.FreeSpace / 1GB, 1)
  startupItems = $startupCount
  defenderStatus = $defenderStatus
  pendingReboot = [bool]$pending
  maxTemperatureC = $maxTemperatureC
  temperatureNote = $temperatureNote
  thermalZones = @($thermalZones)
  recommendations = @()
} | ConvertTo-Json -Compress -Depth 4
"#)
}

#[cfg(target_os = "windows")]
fn run_windows_thermal_status() -> Result<String, String> {
    run_powershell(r#"
$ErrorActionPreference = 'SilentlyContinue'
$zones = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | ForEach-Object {
  [PSCustomObject]@{ name = $_.InstanceName; temperatureC = [Math]::Round(($_.CurrentTemperature / 10) - 273.15, 1) }
}
$zones | ConvertTo-Json -Compress -Depth 3
"#)
}

fn build_recommendations(report: &DiagnosticReport) -> Vec<String> {
    let mut items = Vec::new();
    if report.system_drive_total_gb > 0.0 && report.system_drive_free_gb / report.system_drive_total_gb < 0.15 {
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
    if report.max_temperature_c.unwrap_or(0.0) >= 85.0 {
        items.push("La temperatura informada es alta.".to_string());
    }
    items
}

#[cfg(target_os = "windows")]
fn run_powershell(script: &str) -> Result<String, String> {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
        .output()
        .map_err(|error| format!("No se pudo ejecutar la herramienta de Windows: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() { "Windows rechazó la acción.".to_string() } else { detail });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn scan_temp_files() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = run_powershell(r#"
$paths = @($env:TEMP) | Where-Object { $_ -and (Test-Path $_) }
$items = foreach ($path in $paths) { Get-ChildItem $path -Recurse -Force -File -ErrorAction SilentlyContinue }
$total = ($items | Measure-Object Length -Sum).Sum
[PSCustomObject]@{ count = ($items | Measure-Object).Count; gb = [Math]::Round($total / 1GB, 2) } | ConvertTo-Json -Compress
"#)?;
        Ok(action_ok("temp_scan", "Terminé de buscar archivos temporales. No borré nada.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(action_ok("temp_scan", "Esta revisión está disponible en Windows.", vec![])) }
}

fn clean_temp_files() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = run_powershell(r#"
$cutoff = (Get-Date).AddDays(-1)
$items = Get-ChildItem $env:TEMP -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff }
$deleted = 0
$freed = 0
foreach ($item in $items) {
  try { $length = $item.Length; Remove-Item $item.FullName -Force -ErrorAction Stop; $deleted++; $freed += $length } catch {}
}
[PSCustomObject]@{ deleted = $deleted; freedGb = [Math]::Round($freed / 1GB, 2) } | ConvertTo-Json -Compress
"#)?;
        Ok(action_ok("clean_temp_files", "Liberé espacio borrando temporales antiguos.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(action_ok("clean_temp_files", "Esta limpieza está disponible en Windows.", vec![])) }
}

fn startup_review() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = run_powershell("Get-CimInstance Win32_StartupCommand | Select-Object -First 20 Name, Command, Location | ConvertTo-Json -Compress -Depth 4")?;
        Ok(action_ok("startup_review", "Revisé los programas de inicio. No desactivé ninguno.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(action_ok("startup_review", "Esta revisión está disponible en Windows.", vec![])) }
}

fn network_check() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = run_powershell(r#"
$adapter = Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1 Name, InterfaceDescription, LinkSpeed
$gateway = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1 -ExpandProperty NextHop
$dns = $false
try { Resolve-DnsName microsoft.com -ErrorAction Stop | Out-Null; $dns = $true } catch {}
$internet = Test-NetConnection 1.1.1.1 -Port 443 -InformationLevel Quiet
[PSCustomObject]@{ adapter = $adapter; gateway = $gateway; dns = [bool]$dns; internet = [bool]$internet } | ConvertTo-Json -Compress -Depth 4
"#)?;
        Ok(action_ok("network_check", "Terminé de revisar la conexión.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(action_ok("network_check", "Esta revisión está disponible en Windows.", vec![])) }
}

fn repair_network() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = run_powershell("Clear-DnsClientCache; ipconfig /flushdns | Out-String")?;
        Ok(action_ok("repair_network", "Limpié la caché de red. Probá Internet otra vez.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(action_ok("repair_network", "Esta reparación está disponible en Windows.", vec![])) }
}

fn open_windows_update() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd").args(["/C", "start", "", "ms-settings:windowsupdate"]).spawn()
            .map_err(|error| format!("No se pudo abrir Windows Update: {error}"))?;
        Ok(action_ok("windows_update", "Abrí Windows Update para que vos controles la instalación.", vec![]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(action_ok("windows_update", "Windows Update no aplica en este sistema.", vec![])) }
}

fn defender_status() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = run_powershell(r#"
$defender = Get-MpComputerStatus
[PSCustomObject]@{ service = $defender.AMServiceEnabled; antivirus = $defender.AntivirusEnabled; realtime = $defender.RealTimeProtectionEnabled; quickScanAge = $defender.QuickScanAge; fullScanAge = $defender.FullScanAge } | ConvertTo-Json -Compress
"#)?;
        Ok(action_ok("defender_status", "Terminé de revisar la seguridad de Windows.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(action_ok("defender_status", "Microsoft Defender no aplica en este sistema.", vec![])) }
}

fn defender_quick_scan() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        run_powershell("Start-MpScan -ScanType QuickScan")?;
        Ok(action_ok("defender_quick_scan", "Inicié el análisis rápido de Microsoft Defender.", vec!["El análisis continúa con las herramientas oficiales de Windows.".to_string()]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(action_ok("defender_quick_scan", "Microsoft Defender no aplica en este sistema.", vec![])) }
}

#[cfg(target_os = "windows")]
fn find_rustdesk() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(directory) = exe.parent() {
            candidates.push(directory.join("tools").join("rustdesk").join("rustdesk.exe"));
            candidates.push(directory.join("rustdesk.exe"));
        }
    }
    candidates.push(PathBuf::from(r"C:\Program Files\RustDesk\RustDesk.exe"));
    candidates.push(PathBuf::from(r"C:\Program Files (x86)\RustDesk\RustDesk.exe"));
    candidates.into_iter().find(|path| path.exists())
}

#[cfg(not(target_os = "windows"))]
fn whoami_fallback() -> String {
    std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_else(|_| "usuario".to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window missing");
            let close_window = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = close_window.hide();
                }
            });

            TrayIconBuilder::with_id("nexo-support")
                .icon(app.default_window_icon().expect("default app icon missing").clone())
                .tooltip("NEXO Support")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => toggle_popup(tray.app_handle()),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_main_window,
            minimize_main_window,
            exit_app,
            run_quick_diagnostic,
            thermal_status,
            create_remote_session,
            agent_status,
            run_agent_action,
            open_remote_tool
        ])
        .run(tauri::generate_context!())
        .expect("error while running NEXO Support");
}
