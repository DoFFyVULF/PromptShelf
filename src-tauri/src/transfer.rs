use crate::models::es;
use crate::store;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

fn collect_files(dir: &Path, base: &Path, out: &mut Vec<(PathBuf, String)>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                collect_files(&p, base, out);
            } else if let Ok(rel) = p.strip_prefix(base) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                out.push((p, rel));
            }
        }
    }
}

#[tauri::command]
pub fn export_library(state: tauri::State<'_, crate::AppState>, path: String) -> Result<(), String> {
    // Snapshot the database so the export is consistent even with WAL.
    let tmp_db = std::env::temp_dir().join(format!("promptshelf-snap-{}.db", uuid::Uuid::new_v4()));
    {
        let conn = store::open(&state.dir)?;
        let sql = format!(
            "VACUUM INTO '{}'",
            tmp_db.to_string_lossy().replace('\'', "''")
        );
        conn.execute_batch(&sql).map_err(es)?;
    }

    let file = std::fs::File::create(&path).map_err(es)?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::SimpleFileOptions =
        zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .large_file(true);

    let result = (|| -> Result<(), String> {
        zip.start_file("library.db", options.clone()).map_err(es)?;
        let bytes = std::fs::read(&tmp_db).map_err(es)?;
        zip.write_all(&bytes).map_err(es)?;

        let mut files: Vec<(PathBuf, String)> = Vec::new();
        collect_files(&state.dir.join("images"), &state.dir, &mut files);
        for (p, rel) in files {
            let name = format!("images/{rel}");
            if name.contains("..") {
                continue;
            }
            zip.start_file(name, options.clone()).map_err(es)?;
            let bytes = std::fs::read(&p).map_err(es)?;
            zip.write_all(&bytes).map_err(es)?;
        }
        zip.finish().map_err(es)?;
        Ok(())
    })();

    let _ = std::fs::remove_file(&tmp_db);
    if result.is_err() {
        let _ = std::fs::remove_file(&path);
    }
    result
}

#[tauri::command]
pub fn import_library(state: tauri::State<'_, crate::AppState>, path: String) -> Result<(), String> {
    let f = std::fs::File::open(&path).map_err(es)?;
    let mut zip = zip::ZipArchive::new(f).map_err(es)?;

    let work = std::env::temp_dir().join(format!("promptshelf-import-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&work).map_err(es)?;

    let result = (|| -> Result<(), String> {
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(es)?;
            let name = entry.name().to_string();
            if name.contains("..") || name.starts_with('/') {
                continue;
            }
            let target = work.join(&name);
            if entry.is_dir() {
                std::fs::create_dir_all(&target).map_err(es)?;
                continue;
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(es)?;
            }
            let mut out = std::fs::File::create(&target).map_err(es)?;
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(es)?;
            out.write_all(&buf).map_err(es)?;
        }

        let db_src = work.join("library.db");
        if !db_src.exists() {
            return Err("INVALID_ARCHIVE".to_string());
        }
        {
            let conn = open_db(&db_src)?;
            let _: i64 = conn
                .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
                .map_err(|_| "INVALID_ARCHIVE".to_string())?;
        }

        // Replace current library
        let db_dst = state.dir.join("library.db");
        let _ = std::fs::remove_file(db_dst.with_extension("db-wal"));
        let _ = std::fs::remove_file(db_dst.with_extension("db-shm"));
        let _ = std::fs::remove_file(&db_dst);
        std::fs::copy(&db_src, &db_dst).map_err(es)?;

        let images_dst = state.dir.join("images");
        let _ = std::fs::remove_dir_all(&images_dst);
        std::fs::create_dir_all(&images_dst).map_err(es)?;
        if work.join("images").exists() {
            copy_tree(&work.join("images"), &images_dst)?;
        }
        std::fs::create_dir_all(images_dst.join("originals")).map_err(es)?;
        Ok(())
    })();

    let _ = std::fs::remove_dir_all(&work);
    result
}

fn open_db(p: &Path) -> Result<rusqlite::Connection, String> {
    rusqlite::Connection::open(p).map_err(es)
}

fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(es)?;
    for entry in std::fs::read_dir(src).map_err(es)?.flatten() {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(es)?;
        }
    }
    Ok(())
}
