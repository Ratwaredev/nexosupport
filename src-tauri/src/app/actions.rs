use super::types::{AgentActionResult, AgentStatus, RemoteSession, RemoteToolStatus};
use rand::{distributions::Alphanumeric, Rng};
#[cfg(target_os = "windows")]
use std::{
    env,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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
        notes: "Las revisiones se ejecutan en segundo plano únicamente cuando el usuario las autoriza."
            .to_string(),
    })
}

#[tauri::command]
pub async fn run_agent_action(action_id: String) -> Result<AgentActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_agent_action_blocking(&action_id))
        .await
        .map_err(|error| format!("La acción se interrumpió: {error}"))?
}

fn run_agent_action_blocking(action_id: &str) -> Result<AgentActionResult, String> {
    match action_id {
        "temp_scan" => scan_temp_files(),
        "startup_review" => startup_review(),
        "windows_update" | "open_windows_update" => open_windows_update(),
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
pub fn remote_tool_status() -> Result<RemoteToolStatus, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(status_from_path(find_rustdesk()))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(RemoteToolStatus {
            installed: false,
            name: "RustDesk".to_string(),
            path: None,
            message: "El escritorio remoto está disponible en Windows.".to_string(),
        })
    }
}

#[tauri::command]
pub fn open_remote_tool() -> Result<RemoteToolStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let Some(path) = find_rustdesk() else {
            return Ok(status_from_path(None));
        };

        let mut command = Command::new(&path);
        command.creation_flags(CREATE_NO_WINDOW);
        command
            .spawn()
            .map_err(|error| format!("No se pudo abrir RustDesk: {error}"))?;

        Ok(RemoteToolStatus {
            installed: true,
            name: "RustDesk".to_string(),
            path: Some(path.to_string_lossy().to_string()),
            message: "RustDesk está abierto. El usuario debe compartir el ID visible y aceptar la conexión."
                .to_string(),
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        remote_tool_status()
    }
}

#[cfg(target_os = "windows")]
fn run_powershell_long(script: &str, timeout_seconds: u64, label: &str) -> Result<String, String> {
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
    let output = super::diagnostics::run_command_with_timeout(
        command,
        Duration::from_secs(timeout_seconds),
        label,
    )?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            format!("Windows rechazó {label}.")
        } else {
            detail
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn scan_temp_files() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = run_powershell_long(
            r#"$ErrorActionPreference='SilentlyContinue';
$cutoff=(Get-Date).AddDays(-1);
$roots=@(
  [PSCustomObject]@{name='Temporales del usuario';path=$env:TEMP},
  [PSCustomObject]@{name='Temporales de Windows';path=(Join-Path $env:WINDIR 'Temp')},
  [PSCustomObject]@{name='Volcados de errores';path=(Join-Path $env:LOCALAPPDATA 'CrashDumps')},
  [PSCustomObject]@{name='Informes de errores';path=(Join-Path $env:ProgramData 'Microsoft\Windows\WER')}
);
$categories=@();
foreach($root in $roots){
  if([string]::IsNullOrWhiteSpace($root.path) -or -not (Test-Path -LiteralPath $root.path)){continue}
  $files=@(Get-ChildItem -LiteralPath $root.path -Recurse -Force -File -Attributes !ReparsePoint -ErrorAction SilentlyContinue | Where-Object {$_.LastWriteTime -lt $cutoff});
  $bytes=[int64](($files | Measure-Object Length -Sum).Sum);
  $categories += [PSCustomObject]@{name=$root.name;path=$root.path;files=$files.Count;bytes=$bytes};
}
$totalFiles=[int](($categories | Measure-Object files -Sum).Sum);
$totalBytes=[int64](($categories | Measure-Object bytes -Sum).Sum);
[PSCustomObject]@{
  generatedAt=(Get-Date).ToUniversalTime().ToString('o');
  totalFiles=$totalFiles;
  totalBytes=$totalBytes;
  totalMb=[Math]::Round($totalBytes/1MB,1);
  categories=$categories;
  exclusions=@('Perfiles de navegadores','Cookies','Sesiones','Historial','Extensiones','Contraseñas guardadas','Datos de formularios')
} | ConvertTo-Json -Compress -Depth 6"#,
            75,
            "el análisis de temporales",
        )?;
        Ok(ok(
            "temp_scan",
            "Analicé únicamente ubicaciones temporales autorizadas. No borré nada.",
            vec![raw],
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(ok(
            "temp_scan",
            "Esta revisión está disponible en Windows.",
            vec![],
        ))
    }
}

fn clean_temp_files() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = run_powershell_long(
            r#"$ErrorActionPreference='SilentlyContinue';
$cutoff=(Get-Date).AddDays(-1);
$roots=@(
  [PSCustomObject]@{name='Temporales del usuario';path=$env:TEMP},
  [PSCustomObject]@{name='Temporales de Windows';path=(Join-Path $env:WINDIR 'Temp')},
  [PSCustomObject]@{name='Volcados de errores';path=(Join-Path $env:LOCALAPPDATA 'CrashDumps')},
  [PSCustomObject]@{name='Informes de errores';path=(Join-Path $env:ProgramData 'Microsoft\Windows\WER')}
);
$categories=@();$deletedTotal=0;$freedTotal=[int64]0;$failedTotal=0;
foreach($root in $roots){
  if([string]::IsNullOrWhiteSpace($root.path) -or -not (Test-Path -LiteralPath $root.path)){continue}
  $files=@(Get-ChildItem -LiteralPath $root.path -Recurse -Force -File -Attributes !ReparsePoint -ErrorAction SilentlyContinue | Where-Object {$_.LastWriteTime -lt $cutoff});
  $deleted=0;$freed=[int64]0;$failed=0;
  foreach($item in $files){
    try{
      $length=[int64]$item.Length;
      Remove-Item -LiteralPath $item.FullName -Force -ErrorAction Stop;
      $deleted++;$freed+=$length;
    }catch{$failed++}
  }
  Get-ChildItem -LiteralPath $root.path -Recurse -Force -Directory -Attributes !ReparsePoint -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | ForEach-Object { try { if(-not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue)){Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue} } catch {} };
  $deletedTotal+=$deleted;$freedTotal+=$freed;$failedTotal+=$failed;
  $categories += [PSCustomObject]@{name=$root.name;path=$root.path;deleted=$deleted;freedBytes=$freed;failed=$failed};
}
[PSCustomObject]@{
  generatedAt=(Get-Date).ToUniversalTime().ToString('o');
  deletedFiles=$deletedTotal;
  freedBytes=$freedTotal;
  freedMb=[Math]::Round($freedTotal/1MB,1);
  failedFiles=$failedTotal;
  categories=$categories;
  exclusions=@('Perfiles de navegadores','Cookies','Sesiones','Historial','Extensiones','Contraseñas guardadas','Datos de formularios')
} | ConvertTo-Json -Compress -Depth 6"#,
            120,
            "la optimización segura",
        )?;
        Ok(ok(
            "clean_temp_files",
            "Optimización completada. No se tocaron datos ni sesiones de navegadores.",
            vec![raw],
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(ok(
            "clean_temp_files",
            "Esta limpieza está disponible en Windows.",
            vec![],
        ))
    }
}

fn startup_review() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = super::diagnostics::run_powershell(
            r#"$items=@(Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue | Select-Object -First 40 Name,Command,Location); [PSCustomObject]@{count=$items.Count;items=$items} | ConvertTo-Json -Compress -Depth 5"#,
        )?;
        Ok(ok(
            "startup_review",
            "Revisé los programas de inicio y no desactivé ninguno.",
            vec![raw],
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(ok(
            "startup_review",
            "Esta revisión está disponible en Windows.",
            vec![],
        ))
    }
}

fn network_check() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = super::diagnostics::run_powershell(
            r#"$a=Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | Select-Object -First 1; $adapter=$null; if($a){$adapter=[PSCustomObject]@{Name=$a.Name;InterfaceDescription=$a.InterfaceDescription;LinkSpeed=$a.LinkSpeed}}; $gateway=Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1 -ExpandProperty NextHop; $dns=$false; try{Resolve-DnsName microsoft.com -ErrorAction Stop | Out-Null;$dns=$true}catch{}; $internet=$false; try{$internet=[bool](Test-NetConnection 1.1.1.1 -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue)}catch{}; [PSCustomObject]@{adapter=$adapter;gateway=$gateway;dns=[bool]$dns;internet=[bool]$internet} | ConvertTo-Json -Compress -Depth 5"#,
        )?;
        Ok(ok(
            "network_check",
            "Terminé las comprobaciones de red.",
            vec![raw],
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(ok(
            "network_check",
            "Esta revisión está disponible en Windows.",
            vec![],
        ))
    }
}

fn repair_network() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = super::diagnostics::run_powershell(
            r#"Clear-DnsClientCache; ipconfig /flushdns | Out-Null; [PSCustomObject]@{dnsCacheCleared=$true;changedRouter=$false;changedWifiPassword=$false} | ConvertTo-Json -Compress"#,
        )?;
        Ok(ok(
            "repair_network",
            "Limpié la caché DNS. No cambié el router ni la contraseña Wi-Fi.",
            vec![raw],
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(ok(
            "repair_network",
            "Esta reparación está disponible en Windows.",
            vec![],
        ))
    }
}

fn open_windows_update() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer.exe");
        command
            .arg("ms-settings:windowsupdate")
            .creation_flags(CREATE_NO_WINDOW);
        command
            .spawn()
            .map_err(|error| format!("No se pudo abrir Windows Update: {error}"))?;
        Ok(ok(
            "windows_update",
            "Abrí Windows Update para que controles la instalación.",
            vec![],
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(ok(
            "windows_update",
            "Windows Update no aplica en este sistema.",
            vec![],
        ))
    }
}

fn defender_status() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = super::diagnostics::run_powershell(
            r#"$d=Get-MpComputerStatus -ErrorAction Stop; [PSCustomObject]@{service=[bool]$d.AMServiceEnabled;antivirus=[bool]$d.AntivirusEnabled;realtime=[bool]$d.RealTimeProtectionEnabled;quickScanAge=$d.QuickScanAge;fullScanAge=$d.FullScanAge} | ConvertTo-Json -Compress"#,
        )?;
        Ok(ok(
            "defender_status",
            "Terminé de comprobar Microsoft Defender.",
            vec![raw],
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(ok(
            "defender_status",
            "Microsoft Defender no aplica en este sistema.",
            vec![],
        ))
    }
}

fn defender_quick_scan() -> Result<AgentActionResult, String> {
    #[cfg(target_os = "windows")]
    {
        super::diagnostics::run_powershell("Start-MpScan -ScanType QuickScan")?;
        Ok(ok(
            "defender_quick_scan",
            "Inicié el análisis rápido oficial de Microsoft Defender.",
            vec![],
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(ok(
            "defender_quick_scan",
            "Microsoft Defender no aplica en este sistema.",
            vec![],
        ))
    }
}

#[cfg(target_os = "windows")]
fn status_from_path(path: Option<PathBuf>) -> RemoteToolStatus {
    match path {
        Some(path) => RemoteToolStatus {
            installed: true,
            name: "RustDesk".to_string(),
            path: Some(path.to_string_lossy().to_string()),
            message: "RustDesk está instalado y listo para una sesión autorizada.".to_string(),
        },
        None => RemoteToolStatus {
            installed: false,
            name: "RustDesk".to_string(),
            path: None,
            message: "RustDesk no está instalado. NEXO no instala herramientas remotas sin permiso."
                .to_string(),
        },
    }
}

#[cfg(target_os = "windows")]
fn find_rustdesk() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("tools").join("rustdesk").join("rustdesk.exe"));
            candidates.push(dir.join("resources").join("rustdesk").join("rustdesk.exe"));
            candidates.push(dir.join("rustdesk.exe"));
        }
    }

    for variable in ["LOCALAPPDATA", "APPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = env::var_os(variable) {
            let root = PathBuf::from(root);
            candidates.push(root.join("RustDesk").join("rustdesk.exe"));
            candidates.push(root.join("Programs").join("RustDesk").join("rustdesk.exe"));
        }
    }

    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            candidates.push(directory.join("rustdesk.exe"));
        }
    }

    candidates.into_iter().find(|path| is_executable_file(path))
}

#[cfg(target_os = "windows")]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
}
