fn clean_release_version(value: &str) -> Option<String> {
    let version = value.trim().trim_start_matches('v');
    if version.is_empty()
        || version.len() > 32
        || !version
            .chars()
            .all(|character| character.is_ascii_digit() || character == '.')
    {
        return None;
    }
    Some(version.to_string())
}

#[tauri::command]
pub fn open_update_download(version: String) -> Result<(), String> {
    let version = clean_release_version(&version).ok_or("Versión inválida.")?;
    let url = format!(
        "https://github.com/Ratwaredev/nexosupport/releases/download/v{0}/NEXO.Support_{0}_x64-setup.exe",
        version
    );
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|error| error.to_string())
}
