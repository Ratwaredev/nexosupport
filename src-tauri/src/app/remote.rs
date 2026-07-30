use serde::Serialize;
use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};
use tauri::{path::BaseDirectory, AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteClientStatus {
    pub installed: bool,
    pub name: String,
    pub path: Option<String>,
    pub id: Option<String>,
    pub message: String,
}

fn missing() -> RemoteClientStatus {
    RemoteClientStatus {
        installed: false,
        name: "RustDesk".to_string(),
        path: None,
        id: None,
        message: "RustDesk no está listo.".to_string(),
    }
}

#[cfg(target_os = "windows")]
fn executable(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn find_rustdesk() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "APPDATA"] {
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
    candidates.into_iter().find(|path| executable(path))
}

#[cfg(target_os = "windows")]
fn rustdesk_id(path: &Path) -> Option<String> {
    let mut command = Command::new(path);
    command.arg("--get-id").creation_flags(CREATE_NO_WINDOW);
    let output = super::diagnostics::run_command_with_timeout(
        command,
        Duration::from_secs(12),
        "el ID de RustDesk",
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    raw.lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && line.chars().any(|value| value.is_ascii_digit()))
        .map(ToOwned::to_owned)
}

#[cfg(target_os = "windows")]
fn status() -> RemoteClientStatus {
    let Some(path) = find_rustdesk() else {
        return missing();
    };
    RemoteClientStatus {
        installed: true,
        name: "RustDesk".to_string(),
        id: rustdesk_id(&path),
        path: Some(path.to_string_lossy().to_string()),
        message: "Listo para soporte.".to_string(),
    }
}

#[cfg(target_os = "windows")]
fn find_bundled_installer(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for relative in [
        "resources/rustdesk/rustdesk-installer.exe",
        "rustdesk/rustdesk-installer.exe",
        "rustdesk-installer.exe",
    ] {
        if let Ok(path) = app.path().resolve(relative, BaseDirectory::Resource) {
            candidates.push(path);
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("resources")
                .join("rustdesk")
                .join("rustdesk-installer.exe"),
        );
        candidates.push(resource_dir.join("rustdesk").join("rustdesk-installer.exe"));
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(directory) = exe.parent() {
            candidates.push(
                directory
                    .join("resources")
                    .join("rustdesk")
                    .join("rustdesk-installer.exe"),
            );
        }
    }
    candidates.into_iter().find(|path| executable(path))
}

#[cfg(target_os = "windows")]
fn powershell_quote(value: &str) -> String {
    value.replace('`', "``").replace('"', "`\"")
}

#[tauri::command]
pub fn remote_tool_status() -> Result<RemoteClientStatus, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(status())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(missing())
    }
}

#[tauri::command]
pub async fn install_remote_tool(app: AppHandle) -> Result<RemoteClientStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let current = status();
            if current.installed {
                return Ok(current);
            }
            let installer = find_bundled_installer(&app)
                .ok_or_else(|| "No encontré el instalador de RustDesk dentro de NEXO.".to_string())?;
            let installer_text = powershell_quote(installer.to_string_lossy().as_ref());
            let script = format!(
                "$p=Start-Process -FilePath \"{installer_text}\" -ArgumentList '--silent-install' -Verb RunAs -Wait -PassThru; exit $p.ExitCode"
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
                    &script,
                ])
                .creation_flags(CREATE_NO_WINDOW);
            let output = super::diagnostics::run_command_with_timeout(
                command,
                Duration::from_secs(180),
                "la instalación de RustDesk",
            )?;
            if !output.status.success() {
                return Err("Windows no pudo instalar RustDesk.".to_string());
            }
            for _ in 0..30 {
                let next = status();
                if next.installed {
                    return Ok(next);
                }
                thread::sleep(Duration::from_secs(1));
            }
            Err("RustDesk terminó de instalarse, pero todavía no aparece disponible.".to_string())
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = app;
            Ok(missing())
        }
    })
    .await
    .map_err(|error| format!("La preparación remota se interrumpió: {error}"))?
}

#[tauri::command]
pub fn open_remote_tool() -> Result<RemoteClientStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let current = status();
        let path = current
            .path
            .as_deref()
            .ok_or_else(|| "RustDesk no está instalado.".to_string())?;
        let mut command = Command::new(path);
        command.creation_flags(CREATE_NO_WINDOW);
        command
            .spawn()
            .map_err(|error| format!("No se pudo abrir RustDesk: {error}"))?;
        Ok(current)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(missing())
    }
}
