use super::types::AgentActionResult;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    env,
    fs,
    path::PathBuf,
    time::{Duration, SystemTime},
};
use tauri::ipc::Channel;
use walkdir::WalkDir;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizerProgress {
    pub percent: u8,
    pub processed_files: u64,
    pub total_files: u64,
    pub freed_bytes: u64,
    pub current: String,
}

#[derive(Clone)]
struct Candidate {
    path: PathBuf,
    bytes: u64,
    category: String,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct CategoryResult {
    name: String,
    deleted: u64,
    freed_bytes: u64,
    failed: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupResult {
    generated_at: String,
    deleted_files: u64,
    freed_bytes: u64,
    freed_mb: f64,
    failed_files: u64,
    categories: Vec<CategoryResult>,
}

fn roots() -> Vec<(String, PathBuf)> {
    let mut roots = Vec::new();
    if let Some(path) = env::var_os("TEMP") {
        roots.push(("Temporales".to_string(), PathBuf::from(path)));
    }
    if let Some(path) = env::var_os("WINDIR") {
        roots.push(("Windows Temp".to_string(), PathBuf::from(path).join("Temp")));
    }
    if let Some(path) = env::var_os("LOCALAPPDATA") {
        roots.push(("Errores".to_string(), PathBuf::from(path).join("CrashDumps")));
    }
    if let Some(path) = env::var_os("ProgramData") {
        roots.push((
            "Informes".to_string(),
            PathBuf::from(path).join("Microsoft").join("Windows").join("WER"),
        ));
    }
    roots
}

fn candidates() -> Vec<Candidate> {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(24 * 60 * 60))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let mut files = Vec::new();

    for (category, root) in roots() {
        if !root.is_dir() {
            continue;
        }
        for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(Result::ok) {
            let file_type = entry.file_type();
            if !file_type.is_file() || file_type.is_symlink() {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let old_enough = metadata.modified().map(|modified| modified < cutoff).unwrap_or(false);
            if !old_enough {
                continue;
            }
            files.push(Candidate {
                path: entry.path().to_path_buf(),
                bytes: metadata.len(),
                category: category.clone(),
            });
        }
    }
    files
}

fn send_progress(
    channel: &Channel<OptimizerProgress>,
    percent: u8,
    processed_files: u64,
    total_files: u64,
    freed_bytes: u64,
    current: impl Into<String>,
) {
    let _ = channel.send(OptimizerProgress {
        percent,
        processed_files,
        total_files,
        freed_bytes,
        current: current.into(),
    });
}

fn optimize_blocking(channel: Channel<OptimizerProgress>) -> Result<AgentActionResult, String> {
    let files = candidates();
    let total = files.len() as u64;
    send_progress(&channel, 0, 0, total, 0, "Preparando");

    let mut deleted = 0_u64;
    let mut failed = 0_u64;
    let mut freed = 0_u64;
    let mut categories: BTreeMap<String, CategoryResult> = BTreeMap::new();
    let mut last_percent = 0_u8;

    for (index, candidate) in files.into_iter().enumerate() {
        let category = categories
            .entry(candidate.category.clone())
            .or_insert_with(|| CategoryResult {
                name: candidate.category.clone(),
                ..CategoryResult::default()
            });

        match fs::remove_file(&candidate.path) {
            Ok(_) => {
                deleted += 1;
                freed = freed.saturating_add(candidate.bytes);
                category.deleted += 1;
                category.freed_bytes = category.freed_bytes.saturating_add(candidate.bytes);
            }
            Err(_) => {
                failed += 1;
                category.failed += 1;
            }
        }

        let processed = index as u64 + 1;
        let percent = if total == 0 {
            100
        } else {
            ((processed.saturating_mul(100) / total).min(99)) as u8
        };
        if percent != last_percent || processed == total {
            last_percent = percent;
            send_progress(
                &channel,
                percent,
                processed,
                total,
                freed,
                candidate.category,
            );
        }
    }

    send_progress(&channel, 100, total, total, freed, "Listo");
    let payload = CleanupResult {
        generated_at: chrono::Utc::now().to_rfc3339(),
        deleted_files: deleted,
        freed_bytes: freed,
        freed_mb: (freed as f64 / 1024.0 / 1024.0 * 10.0).round() / 10.0,
        failed_files: failed,
        categories: categories.into_values().collect(),
    };

    Ok(AgentActionResult {
        action: "clean_temp_files".to_string(),
        ok: true,
        message: "Optimización terminada.".to_string(),
        details: vec![serde_json::to_string(&payload).map_err(|error| error.to_string())?],
    })
}

#[tauri::command]
pub async fn optimize_temp_files(
    on_event: Channel<OptimizerProgress>,
) -> Result<AgentActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || optimize_blocking(on_event))
        .await
        .map_err(|error| format!("La optimización se interrumpió: {error}"))?
}
