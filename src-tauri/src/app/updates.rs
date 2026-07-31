use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[cfg(target_os = "windows")]
use std::{
    env,
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
fn canonical_install() -> Option<PathBuf> {
    ["ProgramW6432", "ProgramFiles"]
        .into_iter()
        .filter_map(env::var_os)
        .map(PathBuf::from)
        .map(|root| root.join("NEXO Support").join("NEXO Support.exe"))
        .find(|candidate| candidate.is_file())
}

#[cfg(target_os = "windows")]
fn powershell_literal(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn finish_windows_update(app: &AppHandle) -> Result<(), String> {
    let current = env::current_exe().map_err(|error| error.to_string())?;
    let Some(canonical) = canonical_install() else {
        // Never restart the executable that initiated the update: it may be a stale
        // per-user copy. Closing is safer than entering an endless update loop.
        app.exit(0);
        return Ok(());
    };

    let current_normalized = current.canonicalize().unwrap_or_else(|_| current.clone());
    let canonical_normalized = canonical
        .canonicalize()
        .unwrap_or_else(|_| canonical.clone());

    if current_normalized == canonical_normalized {
        app.restart();
    }

    let old_directory = current.parent().unwrap_or(Path::new("")).to_path_buf();
    let target = powershell_literal(&canonical);
    let old = powershell_literal(&old_directory);
    let script = format!(
        "$ErrorActionPreference='SilentlyContinue'; \
         Start-Sleep -Milliseconds 900; \
         $target='{target}'; \
         $shell=New-Object -ComObject WScript.Shell; \
         $links=@(\
           [Environment]::GetFolderPath('Desktop') + '\\NEXO Support.lnk', \
           [Environment]::GetFolderPath('Programs') + '\\NEXO Support.lnk'\
         ); \
         foreach($link in $links){{ \
           $shortcut=$shell.CreateShortcut($link); \
           $shortcut.TargetPath=$target; \
           $shortcut.WorkingDirectory=Split-Path $target; \
           $shortcut.Save() \
         }}; \
         Start-Process -FilePath $target; \
         Start-Sleep -Seconds 2; \
         $old='{old}'; \
         if($old -and (Test-Path -LiteralPath $old)){{ Remove-Item -LiteralPath $old -Recurse -Force }}"
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
        .map_err(|error| format!("No se pudo abrir la instalación nueva: {error}"))?;

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
        return finish_windows_update(&app);
    }

    #[cfg(not(target_os = "windows"))]
    {
        app.restart();
    }
}
