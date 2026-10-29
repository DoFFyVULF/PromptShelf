mod cards;
mod civitai;
mod images;
mod models;
mod store;
mod transfer;
mod util;

#[cfg(test)]
mod tests_cards;
#[cfg(test)]
mod tests_images;

use std::path::PathBuf;
use tauri::Manager;

/// Shared application state: the active library dir and the default one
/// (where the location manifest lives).
pub struct AppState {
    pub dir: PathBuf,
    pub default_dir: PathBuf,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let default_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&default_dir).map_err(|e| e.to_string())?;
            // A custom library location, if recorded, wins over the default.
            let dir = util::read_manifest_dir(&default_dir).unwrap_or_else(|| default_dir.clone());
            std::fs::create_dir_all(dir.join("images")).map_err(|e| e.to_string())?;
            std::fs::create_dir_all(dir.join("images").join("originals")).map_err(|e| e.to_string())?;
            {
                let conn = store::open(&dir)?;
                store::init_schema(&conn)?;
            }
            app.manage(AppState { dir, default_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cards::list_cards,
            cards::get_card,
            cards::create_card,
            cards::update_card,
            cards::delete_card,
            cards::add_card_image,
            cards::delete_card_image,
            cards::set_cover,
            cards::list_tags,
            cards::list_groups,
            cards::create_group,
            cards::rename_group,
            cards::delete_group,
            cards::move_cards,
            images::import_dropped_file,
            civitai::civitai_import,
            store::get_settings,
            store::set_settings,
            images::paste_image_from_clipboard,
            images::save_temp_image,
            images::preview_image,
            images::discard_temp,
            transfer::export_library,
            transfer::import_library,
            util::get_library_paths,
            util::move_library,
            util::reveal_file,
            util::copy_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
