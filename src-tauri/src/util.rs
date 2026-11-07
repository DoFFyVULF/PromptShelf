use crate::models::{es, LibraryInspection, LibraryPaths};
use rusqlite::Connection;
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

/// Reads what sits in a folder the user picked for the library location:
/// an existing `library.db` means "connect this library", anything else means
/// "copy the current library here".
#[tauri::command]
pub fn inspect_library_dir(path: String) -> LibraryInspection {
    match library_counts(&PathBuf::from(path.trim())) {
        Some((cards, loras)) => LibraryInspection {
            library: true,
            cards,
            loras,
        },
        None => LibraryInspection {
            library: false,
            cards: 0,
            loras: 0,
        },
    }
}

/// `(cards, loras)` when `dir` holds a PromptShelf database, `None` otherwise.
fn library_counts(dir: &Path) -> Option<(i64, i64)> {
    let db = dir.join("library.db");
    if !db.is_file() {
        return None;
    }
    let conn = Connection::open(&db).ok()?;
    let has_cards: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards')",
            [],
            |r| r.get(0),
        )
        .ok()?;
    if !has_cards {
        return None;
    }
    let cards = conn
        .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
        .unwrap_or(0);
    let loras = conn
        .query_row("SELECT COUNT(*) FROM loras", [], |r| r.get(0))
        .unwrap_or(0);
    Some((cards, loras))
}

#[tauri::command]
pub async fn move_library(
    state: tauri::State<'_, crate::AppState>,
    new_dir: String,
) -> Result<String, String> {
    let from = state.dir.clone();
    let default_dir = state.default_dir.clone();
    let handle = tauri::async_runtime::spawn_blocking(move || {
        move_library_blocking(&from, &default_dir, &new_dir)
    });
    handle
        .await
        .map_err(|e| format!("LIBRARY_MOVE: {e}"))?
}

/// Connect the library already in `new_dir`, or copy the current one there
/// when the folder is empty. Adopting is what the settings dialog does when
/// the user points at an older install: the db and images stay where they are
/// (the db is opened and migrated on the next start), the manifest only
/// records the new active dir. Returns "adopted" or "copied".
pub(crate) fn move_library_blocking(
    from: &Path,
    default_dir: &Path,
    new_dir_raw: &str,
) -> Result<String, String> {
    let new_rel_err = || "LIBRARY_MOVE".to_string();
    let new_dir = PathBuf::from(new_dir_raw.trim());
    if new_dir.as_os_str().is_empty() {
        return Err(new_rel_err());
    }

    if new_dir.join("library.db").is_file() {
        // Never overwrite a database the user pointed us at: if it is not a
        // PromptShelf library the move must fail instead of clobbering it.
        if library_counts(&new_dir).is_none() {
            return Err("LIBRARY_INVALID".to_string());
        }
        write_manifest(default_dir, &new_dir)?;
        return Ok("adopted".to_string());
    }

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

    Ok("copied".to_string())
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

/// Open a web link in the system browser (model-page buttons in the UI).
#[tauri::command]
pub fn open_url(state: tauri::State<'_, crate::AppState>, url: String) -> Result<(), String> {
    let _ = &state;
    let trimmed = url.trim();
    if !trimmed.starts_with("https://") {
        return Err("OPEN_URL".to_string());
    }
    tauri_plugin_opener::open_url(trimmed, None::<&str>).map_err(es)
}

#[tauri::command]
pub fn copy_text(state: tauri::State<'_, crate::AppState>, text: String) -> Result<(), String> {
    let _ = &state;
    let mut cb = arboard::Clipboard::new().map_err(es)?;
    cb.set_text(text).map_err(es)
}
