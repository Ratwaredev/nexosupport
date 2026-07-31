use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[cfg(target_os = "windows")]
use std::{
    env,
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize, Serialize)]
struct ActiveInstall {
    path: String,
    version: String,
}

fn version_parts(value: &str) -> Vec<u64> {
    value
        .trim_start_matches('v')
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(|character| character.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

fn is_newer(candidate: &str, current: &str) -> bool {
    let candidate = version_parts(candidate);
    let current = version_parts(current);
    let length = candidate.len().max(current.len());
    for index in 0..length {
        let left = *candidate.get(index).unwrap_or(&0);
        let right = *current.get(index).unwrap_or(&0);
        if left != right {
            return left > right;
        }
    }
    false
}

#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<Option<AvailableUpdate>, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    let current = app.package_info().version.to_string();

    Ok(update.and_then(|release| {
        if !is_newer(&release.version, &current) {
            return None;
        }
        Some(AvailableUpdate {
            version: release.version,
            notes: release.body,
        })
    }))
}

#[cfg(target_os = "windows")]
fn active_install_marker() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|root| root.join("NEXO Support").join("active-install.json"))
}

#[cfg(target_os = "windows")]
fn canonical_install() -> Option<PathBuf> {
    ["ProgramW6432", "ProgramFiles"]
        .into_iter()
        .filter_map(env::var_os)
        .map(PathBuf::from)
        .map(|root| root.join("NEXO Support").join("NEXO Support.exe"))
        .find(|candidate| candidate.is_file())
}

#[cfg(target_os = "windows")]
fn normalize(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(target_os = "windows")]
fn read_active_install() -> Option<ActiveInstall> {
    let marker = active_install_marker()?;
    let text = fs::read_to_string(marker).ok()?;
    serde_json::from_str(&text).ok()
}

#[cfg(target_os = "windows")]
fn persist_active_install(path: &Path, version: &str) -> Result<(), String> {
    let marker = active_install_marker().ok_or("No se encontró LOCALAPPDATA.")?;
    let parent = marker.parent().ok_or("Ruta de instalación inválida.")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let payload = ActiveInstall {
        path: path.to_string_lossy().to_string(),
        version: version.to_string(),
    };
    let json = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    fs::write(marker, json).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
pub fn redirect_to_active_install(current_version: &str) -> bool {
    let Ok(current) = env::current_exe() else {
        return false;
    };
    let Some(active) = read_active_install() else {
        return false;
    };
    let target = PathBuf::from(&active.path);
    if !target.is_file() || normalize(&current) == normalize(&target) {
        return false;
    }
    if is_newer(current_version, &active.version) {
        let _ = persist_active_install(&current, current_version);
        return false;
    }

    Command::new(target)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .is_ok()
}

#[cfg(not(target_os = "windows"))]
pub fn redirect_to_active_install(_current_version: &str) -> bool {
    false
}

#[cfg(target_os = "windows")]
pub fn register_current_install(current_version: &str) {
    let Ok(current) = env::current_exe() else {
        return;
    };
    match read_active_install() {
        None => {
            let _ = persist_active_install(&current, current_version);
        }
        Some(active) => {
            let active_path = PathBuf::from(active.path);
            if !active_path.is_file() || is_newer(current_version, &active.version) {
                let _ = persist_active_install(&current, current_version);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn register_current_install(_current_version: &str) {}

#[cfg(target_os = "windows")]
fn powershell_literal(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn finish_windows_update(app: &AppHandle, expected_version: &str) -> Result<(), String> {
    let current = env::current_exe().map_err(|error| error.to_string())?;
    let canonical = canonical_install().ok_or("No se encontró la instalación actualizada.")?;
    persist_active_install(&canonical, expected_version)?;

    if normalize(&current) == normalize(&canonical) {
        app.restart();
    }

    let current = powershell_literal(&current);
    let canonical = powershell_literal(&canonical);
    let marker = powershell_literal(
        &active_install_marker().ok_or("No se encontró LOCALAPPDATA.")?,
    );
    let expected = expected_version.replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference='SilentlyContinue'; \
         Start-Sleep -Milliseconds 1400; \
         $source='{canonical}'; \
         $old='{current}'; \
         $marker='{marker}'; \
         if((Test-Path -LiteralPath $source) -and $old -ne $source){{ \
           Copy-Item -LiteralPath $source -Destination $old -Force \
         }}; \
         @{{path=$source;version='{expected}'}} | ConvertTo-Json -Compress | Set-Content -LiteralPath $marker -Encoding UTF8; \
         $shell=New-Object -ComObject WScript.Shell; \
         foreach($link in @(\
           (Join-Path ([Environment]::GetFolderPath('Desktop')) 'NEXO Support.lnk'), \
           (Join-Path ([Environment]::GetFolderPath('Programs')) 'NEXO Support.lnk')\
         )){{ \
           $shortcut=$shell.CreateShortcut($link); \
           $shortcut.TargetPath=$source; \
           $shortcut.WorkingDirectory=Split-Path $source; \
           $shortcut.Save() \
         }}; \
         Start-Process -FilePath $source"
    );

    Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("No se pudo abrir la versión instalada: {error}"))?;

    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    expected_version: String,
) -> Result<(), String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Err("No hay una actualización disponible.".to_string());
    };

    let current = app.package_info().version.to_string();
    if update.version != expected_version {
        return Err("La versión disponible cambió. Buscá la actualización nuevamente.".to_string());
    }
    if !is_newer(&update.version, &current) {
        return Err("NEXO ya tiene esta versión o una más nueva.".to_string());
    }

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    {
        return finish_windows_update(&app, &expected_version);
    }

    #[cfg(not(target_os = "windows"))]
    {
        app.restart();
    }
}
