use serde::Serialize;
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
fn migration_marker() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|root| root.join("NEXO Support").join("canonical-install-v2.ok"))
}

#[cfg(target_os = "windows")]
fn normalize(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(target_os = "windows")]
fn powershell_literal(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

/// Program Files is the only authoritative installation. Legacy AppData copies
/// may still be referenced by old Windows shortcuts, so they only forward once
/// to the canonical executable and then exit before creating any windows/tray.
#[cfg(target_os = "windows")]
pub fn redirect_to_canonical_install() -> bool {
    let Ok(current) = env::current_exe() else {
        return false;
    };
    let Some(canonical) = canonical_install() else {
        return false;
    };
    if normalize(&current) == normalize(&canonical) {
        return false;
    }

    Command::new(canonical)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .is_ok()
}

#[cfg(not(target_os = "windows"))]
pub fn redirect_to_canonical_install() -> bool {
    false
}

/// Once the canonical app is running, remove the old per-user executable and
/// rebuild the user-facing shortcuts so Windows Search can no longer revive it.
/// The marker is only a completed-migration flag; it is never used for routing.
#[cfg(target_os = "windows")]
pub fn repair_legacy_installations() {
    let Ok(current) = env::current_exe() else {
        return;
    };
    let Some(canonical) = canonical_install() else {
        return;
    };
    if normalize(&current) != normalize(&canonical) {
        return;
    }

    let Some(marker) = migration_marker() else {
        return;
    };
    if marker.is_file() {
        return;
    }

    let canonical = powershell_literal(&canonical);
    let marker = powershell_literal(&marker);
    let script = format!(
        "$ErrorActionPreference='SilentlyContinue'; \
         Start-Sleep -Milliseconds 1400; \
         $canonical='{canonical}'; \
         $marker='{marker}'; \
         $legacyProgram=Join-Path $env:LOCALAPPDATA 'Programs\\NEXO Support'; \
         if(Test-Path -LiteralPath $legacyProgram){{Remove-Item -LiteralPath $legacyProgram -Recurse -Force}}; \
         $legacyRoot=Join-Path $env:LOCALAPPDATA 'NEXO Support'; \
         foreach($name in @('NEXO Support.exe','NEXO Support.obsolete.exe','active-install.json')){{ \
           $item=Join-Path $legacyRoot $name; \
           if(Test-Path -LiteralPath $item){{Remove-Item -LiteralPath $item -Force}} \
         }}; \
         $desktop=Join-Path ([Environment]::GetFolderPath('Desktop')) 'NEXO Support.lnk'; \
         $programs=Join-Path ([Environment]::GetFolderPath('Programs')) 'NEXO Support.lnk'; \
         $pinned=Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\NEXO Support.lnk'; \
         foreach($link in @($desktop,$programs,$pinned)){{ \
           if(Test-Path -LiteralPath $link){{Remove-Item -LiteralPath $link -Force}} \
         }}; \
         $shell=New-Object -ComObject WScript.Shell; \
         foreach($link in @($desktop,$programs)){{ \
           $shortcut=$shell.CreateShortcut($link); \
           $shortcut.TargetPath=$canonical; \
           $shortcut.WorkingDirectory=Split-Path $canonical; \
           $shortcut.Save() \
         }}; \
         $appPath='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\NEXO Support.exe'; \
         New-Item -Path $appPath -Force | Out-Null; \
         Set-Item -Path $appPath -Value $canonical -Force; \
         New-ItemProperty -Path $appPath -Name 'Path' -Value (Split-Path $canonical) -PropertyType String -Force | Out-Null; \
         New-Item -ItemType Directory -Path (Split-Path $marker) -Force | Out-Null; \
         Set-Content -LiteralPath $marker -Value $canonical -Encoding UTF8"
    );

    let _ = Command::new("powershell.exe")
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
        .spawn();
}

#[cfg(not(target_os = "windows"))]
pub fn repair_legacy_installations() {}

#[cfg(target_os = "windows")]
fn finish_windows_update(app: &AppHandle) -> Result<(), String> {
    let current = env::current_exe().map_err(|error| error.to_string())?;

    if let Some(canonical) = canonical_install() {
        if normalize(&current) == normalize(&canonical) {
            app.restart();
        }

        let canonical = powershell_literal(&canonical);
        let script = format!(
            "$ErrorActionPreference='SilentlyContinue'; \
             Start-Sleep -Milliseconds 1400; \
             Start-Process -FilePath '{canonical}'"
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
        return Ok(());
    }

    // A legacy per-user install may update itself before the one-time clean
    // installer is applied. Restart it rather than inventing another install path.
    app.restart();
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
