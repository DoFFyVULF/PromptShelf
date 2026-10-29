use crate::models::{es, LibraryPaths};
use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};

#[tauri::command]
pub fn get_library_paths(state: tauri::State<'_, crate::AppState>) -> LibraryPaths {
    LibraryPaths {
        data_dir: state.dir.to_string_lossy().into_owned(),
        db_path: state.dir.join("library.db").to_string_lossy().into_owned(),
    }
}

#[tauri::command]
pub async fn move_library(
    state: tauri::State<'_, crate::AppState>,
    new_dir: String,
) -> Result<(), String> {
    let from = state.dir.clone();
    let default_dir = state.default_dir.clone();
    let handle = tauri::async_runtime::spawn_blocking(move || {
        move_library_blocking(&from, &default_dir, &new_dir)
    });
    let res = handle
        .await
        .map_err(|e| format!("LIBRARY_MOVE: {e}"))?;
    res
}

/// Copy the whole library to `new_dir` and record the location in the
/// manifest by the app's default data dir (read next start). The old copy is
/// left in place, so the switch is never destructive.
fn move_library_blocking(from: &Path, default_dir: &Path, new_dir_raw: &str) -> Result<(), String> {
    let new_rel_err = || "LIBRARY_MOVE".to_string();
    let new_dir = PathBuf::from(new_dir_raw.trim());
    if from == new_dir {
        return Err(new_rel_err());
    }
    // Refuse nesting in either direction: a move into itself breaks the copy.
    if new_dir.starts_with(from) || from.starts_with(&new_dir) {
        return Err(new_rel_err());
    }
    std::fs::create_dir_all(&new_dir).map_err(es)?;
    std::fs::create_dir_all(new_dir.join("images")).map_err(es)?;
    std::fs::create_dir_all(new_dir.join("images").join("originals")).map_err(es)?;

    // The db is snapshotted (WAL folded in) rather than copied raw.
    let target_db = new_dir.join("library.db");
    let _ = std::fs::remove_file(&target_db);
    {
        let conn = crate::store::open(from)?;
        let sql = format!(
            "VACUUM INTO '{}'",
            target_db.to_string_lossy().replace('\'', "''")
        );
        conn.execute_batch(&sql).map_err(es)?;
    }

    // Everything else (the images tree, temp files) is copied file by file.
    let mut skip = |p: &Path| -> bool {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        name == "library.db" || name.ends_with("library.db-wal") || name.ends_with("library.db-shm")
            || name == "library.json"
    };
    let mut files: Vec<(PathBuf, String)> = Vec::new();
    collect_files(from, from, &mut files, &mut skip)?;
    for (src, rel) in files {
        let dst = new_dir.join(rel);
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).map_err(es)?;
        }
        std::fs::copy(src, &dst).map_err(es)?;
    }

    // Manifest lives in the default app-data dir: it is found before any
    // custom location is known.
    write_manifest(default_dir, &new_dir)?;

    Ok(())
}

fn write_manifest(default_dir: &Path, dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(default_dir).map_err(es)?;
    let body = serde_json::json!({ "dir": dir.to_string_lossy() });
    let mut f = std::fs::File::create(default_dir.join("library.json")).map_err(es)?;
    f.write_all(
        serde_json::to_string_pretty(&body)
            .map_err(es)?
            .as_bytes(),
    )
    .map_err(es)?;
    Ok(())
}

pub fn read_manifest_dir(default_dir: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(default_dir.join("library.json")).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let dir = v.get("dir")?.as_str()?.trim().to_string();
    if dir.is_empty() {
        return None;
    }
    Some(PathBuf::from(dir))
}

fn collect_files(
    dir: &Path,
    base: &Path,
    out: &mut Vec<(PathBuf, String)>,
    skip: &mut dyn FnMut(&Path) -> bool,
) -> Result<(), String> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                collect_files(&p, base, out, skip)?;
            } else if !skip(&p) {
                if let Ok(rel) = p.strip_prefix(base) {
                    let rel = rel.to_string_lossy().replace('\\', "/");
                    out.push((p, rel));
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_file(state: tauri::State<'_, crate::AppState>, path: String) -> Result<(), String> {
    let _ = &state;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(es)
}

#[tauri::command]
pub fn copy_text(state: tauri::State<'_, crate::AppState>, text: String) -> Result<(), String> {
    let _ = &state;
    let mut cb = arboard::Clipboard::new().map_err(es)?;
    cb.set_text(text).map_err(es)
}
