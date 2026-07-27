use super::types::{AgentActionResult, AgentStatus, RemoteSession};
use rand::{distributions::Alphanumeric, Rng};
#[cfg(target_os = "windows")]
use std::{path::PathBuf, process::Command};

fn ok(action: &str, message: &str, details: Vec<String>) -> AgentActionResult {
    AgentActionResult {
        action: action.to_string(),
        ok: true,
        message: message.to_string(),
        details,
    }
}

#[tauri::command]
pub fn create_remote_session() -> Result<RemoteSession, String> {
    let code: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(6)
        .map(char::from)
        .collect::<String>()
        .to_uppercase();
    Ok(RemoteSession {
        code,
        expires_in_minutes: 20,
        instructions: "La conexión remota solo se abre con autorización visible.".to_string(),
    })
}

#[tauri::command]
pub fn agent_status() -> Result<AgentStatus, String> {
    Ok(AgentStatus {
        mode: "tray-on-demand".to_string(),
        monitoring: false,
        version: env!("CARGO_PKG_VERSION").to_string(),
        notes: "Las revisiones automáticas se realizan únicamente cuando el usuario las autoriza."
            .to_string(),
    })
}

#[tauri::command]
pub fn run_agent_action(action_id: String) -> Result<AgentActionResult, String> {
    match action_id.as_str() {
        "temp_scan" => scan_temp_files(),
        "startup_review" => startup_review(),
        "windows_update" => open_windows_update(),
        "defender_status" => defender_status(),
        "defender_quick_scan" => defender_quick_scan(),
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
pub fn open_remote_tool() -> Result<String, String> {
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
        Ok("No encontré la herramienta remota instalada. La solicitud quedó creada.".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok("La conexión remota está preparada para Windows.".to_string())
    }
}

fn scan_temp_files() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = super::diagnostics::run_powershell(r#"$items = Get-ChildItem $env:TEMP -Recurse -Force -File -ErrorAction SilentlyContinue; $total = ($items | Measure-Object Length -Sum).Sum; [PSCustomObject]@{ count = ($items | Measure-Object).Count; gb = [Math]::Round($total / 1GB, 2) } | ConvertTo-Json -Compress"#)?;
        Ok(ok("temp_scan", "Terminé de buscar temporales. No borré nada.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(ok("temp_scan", "Esta revisión está disponible en Windows.", vec![])) }
}

fn clean_temp_files() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = super::diagnostics::run_powershell(r#"$cutoff=(Get-Date).AddDays(-1); $items=Get-ChildItem $env:TEMP -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object {$_.LastWriteTime -lt $cutoff}; $deleted=0; $freed=0; foreach($item in $items){try{$length=$item.Length;Remove-Item $item.FullName -Force -ErrorAction Stop;$deleted++;$freed+=$length}catch{}}; [PSCustomObject]@{deleted=$deleted;freedGb=[Math]::Round($freed/1GB,2)} | ConvertTo-Json -Compress"#)?;
        Ok(ok("clean_temp_files", "Liberé espacio borrando temporales antiguos.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(ok("clean_temp_files", "Esta limpieza está disponible en Windows.", vec![])) }
}

fn startup_review() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = super::diagnostics::run_powershell("Get-CimInstance Win32_StartupCommand | Select-Object -First 20 Name, Command, Location | ConvertTo-Json -Compress -Depth 4")?;
        Ok(ok("startup_review", "Revisé los programas de inicio. No desactivé ninguno.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(ok("startup_review", "Esta revisión está disponible en Windows.", vec![])) }
}

fn network_check() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = super::diagnostics::run_powershell(r#"$adapter=Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1 Name,InterfaceDescription,LinkSpeed; $gateway=Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1 -ExpandProperty NextHop; $dns=$false; try{Resolve-DnsName microsoft.com -ErrorAction Stop | Out-Null;$dns=$true}catch{}; $internet=Test-NetConnection 1.1.1.1 -Port 443 -InformationLevel Quiet; [PSCustomObject]@{adapter=$adapter;gateway=$gateway;dns=[bool]$dns;internet=[bool]$internet} | ConvertTo-Json -Compress -Depth 4"#)?;
        Ok(ok("network_check", "Terminé de revisar la conexión.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(ok("network_check", "Esta revisión está disponible en Windows.", vec![])) }
}

fn repair_network() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = super::diagnostics::run_powershell("Clear-DnsClientCache; ipconfig /flushdns | Out-String")?;
        Ok(ok("repair_network", "Limpié la caché DNS.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(ok("repair_network", "Esta reparación está disponible en Windows.", vec![])) }
}

fn open_windows_update() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:windowsupdate"])
            .spawn()
            .map_err(|error| format!("No se pudo abrir Windows Update: {error}"))?;
        Ok(ok("windows_update", "Abrí Windows Update para que controles la instalación.", vec![]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(ok("windows_update", "Windows Update no aplica en este sistema.", vec![])) }
}

fn defender_status() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = super::diagnostics::run_powershell(r#"$d=Get-MpComputerStatus; [PSCustomObject]@{service=$d.AMServiceEnabled;antivirus=$d.AntivirusEnabled;realtime=$d.RealTimeProtectionEnabled;quickScanAge=$d.QuickScanAge;fullScanAge=$d.FullScanAge} | ConvertTo-Json -Compress"#)?;
        Ok(ok("defender_status", "Terminé de revisar la seguridad de Windows.", vec![raw]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(ok("defender_status", "Microsoft Defender no aplica en este sistema.", vec![])) }
}

fn defender_quick_scan() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        super::diagnostics::run_powershell("Start-MpScan -ScanType QuickScan")?;
        Ok(ok("defender_quick_scan", "Inicié el análisis rápido de Microsoft Defender.", vec![]))
    }
    #[cfg(not(target_os = "windows"))]
    { Ok(ok("defender_quick_scan", "Microsoft Defender no aplica en este sistema.", vec![])) }
}

#[cfg(target_os = "windows")]
fn find_rustdesk() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("tools").join("rustdesk").join("rustdesk.exe"));
            candidates.push(dir.join("rustdesk.exe"));
        }
    }
    candidates.push(PathBuf::from(r"C:\Program Files\RustDesk\RustDesk.exe"));
    candidates.push(PathBuf::from(r"C:\Program Files (x86)\RustDesk\RustDesk.exe"));
    candidates.into_iter().find(|path| path.exists())
}
