use crate::models::{es, LibraryPaths};

#[tauri::command]
pub fn get_library_paths(state: tauri::State<'_, crate::AppState>) -> LibraryPaths {
    LibraryPaths {
        data_dir: state.dir.to_string_lossy().into_owned(),
        db_path: state.dir.join("library.db").to_string_lossy().into_owned(),
    }
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
