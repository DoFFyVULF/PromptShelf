use crate::models::{app_settings_default, es, AppSettings, SettingsPatch};
use rusqlite::{Connection, OptionalExtension};
use std::path::Path;

pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    rating INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cover_image_id TEXT,
    loras TEXT NOT NULL DEFAULT '[]',
    group_id TEXT,
    author TEXT,
    checkpoint TEXT,
    meta_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_groups_sort ON groups(is_default DESC, sort, name);
CREATE TABLE IF NOT EXISTS card_images (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    thumb TEXT NOT NULL,
    original TEXT,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_images_card ON card_images(card_id, sort);
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS card_tags (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_card_tags_tag ON card_tags(tag_id);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

pub fn open(dir: &Path) -> Result<Connection, String> {
    let conn = Connection::open(dir.join("library.db")).map_err(es)?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    let _ = conn.execute_batch("PRAGMA foreign_keys=ON;");
    // Idempotent: CREATE IF NOT EXISTS + a cheap PRAGMA check. Keeps every
    // caller (and tests) safe without a separate init step.
    init_schema(&conn)?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA).map_err(es)?;
    ensure_columns(conn)?;
    // after ensure_columns: the index needs the migrated column to exist
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_cards_group ON cards(group_id);")
        .map_err(es)?;
    default_group_id(conn).map(|_| ())
}

/// Adds columns introduced after v1 to existing libraries.
fn ensure_columns(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn.prepare("PRAGMA table_info(cards)").map_err(es)?;
    let names = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(es)?
        .filter_map(|n| n.ok())
        .collect::<Vec<String>>();
    drop(stmt);

    if !names.iter().any(|n| n == "loras") {
        conn.execute(
            "ALTER TABLE cards ADD COLUMN loras TEXT NOT NULL DEFAULT '[]'",
            [],
        )
        .map_err(es)?;
    }
    if !names.iter().any(|n| n == "group_id") {
        conn.execute("ALTER TABLE cards ADD COLUMN group_id TEXT", [])
            .map_err(es)?;
    }
    if !names.iter().any(|n| n == "author") {
        conn.execute("ALTER TABLE cards ADD COLUMN author TEXT", []).map_err(es)?;
    }
    if !names.iter().any(|n| n == "checkpoint") {
        conn.execute("ALTER TABLE cards ADD COLUMN checkpoint TEXT", []).map_err(es)?;
    }
    if !names.iter().any(|n| n == "meta_json") {
        conn.execute("ALTER TABLE cards ADD COLUMN meta_json TEXT NOT NULL DEFAULT '[]'", [])
            .map_err(es)?;
    }
    Ok(())
}

/// Id of the default group; creates it (and backfills cards) when missing.
/// The seed name follows the stored UI language.
pub fn default_group_id(conn: &Connection) -> Result<String, String> {
    if let Some(id) = conn
        .query_row("SELECT id FROM groups WHERE is_default = 1 LIMIT 1", [], |r| r.get::<_, String>(0))
        .optional()
        .map_err(es)?
    {
        return Ok(id);
    }

    let lang: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'lang'", [], |r| r.get(0))
        .optional()
        .map_err(es)?;
    let name = if lang.as_deref() == Some("ru") { "Домашняя" } else { "Home" };
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO groups(id, name, is_default, sort, created_at) VALUES(?1, ?2, 1, 0, ?3)",
        rusqlite::params![id, name, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(es)?;
    conn.execute("UPDATE cards SET group_id = ?1 WHERE group_id IS NULL", rusqlite::params![id])
        .map_err(es)?;
    Ok(id)
}

pub fn read_settings(conn: &Connection) -> Result<AppSettings, String> {
    let mut s = app_settings_default();
    let mut stmt = conn.prepare("SELECT key, value FROM settings").map_err(es)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(es)?;
    for row in rows {
        let (k, v) = row.map_err(es)?;
        match k.as_str() {
            "max_side" => {
                if let Ok(n) = v.parse::<u32>() {
                    s.max_side = n.clamp(320, 4096);
                }
            }
            "quality" => {
                if let Ok(n) = v.parse::<u8>() {
                    s.quality = n.clamp(30, 100);
                }
            }
            "format" => {
                if v == "jpeg" || v == "webp" {
                    s.format = v;
                }
            }
            "originals" => s.originals = v == "true",
            "thumbs" => s.thumbs = v != "false", // absent → default true
            "lang" => {
                if v == "en" || v == "ru" {
                    s.lang = v;
                }
            }
            "civitai_api_key" => s.civitai_api_key = v,
            _ => {}
        }
    }
    Ok(s)
}

fn put_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(es)?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, crate::AppState>) -> Result<AppSettings, String> {
    let conn = open(&state.dir)?;
    read_settings(&conn)
}

#[tauri::command]
pub fn set_settings(
    state: tauri::State<'_, crate::AppState>,
    patch: SettingsPatch,
) -> Result<AppSettings, String> {
    let conn = open(&state.dir)?;
    if let Some(v) = patch.max_side {
        put_setting(&conn, "max_side", &v.clamp(320, 4096).to_string())?;
    }
    if let Some(v) = patch.quality {
        put_setting(&conn, "quality", &v.clamp(30, 100).to_string())?;
    }
    if let Some(v) = patch.format {
        if v == "jpeg" || v == "webp" {
            put_setting(&conn, "format", &v)?;
        }
    }
    if let Some(v) = patch.originals {
        put_setting(&conn, "originals", if v { "true" } else { "false" })?;
    }
    if let Some(v) = patch.thumbs {
        put_setting(&conn, "thumbs", if v { "true" } else { "false" })?;
    }
    if let Some(v) = patch.lang {
        if v == "en" || v == "ru" {
            put_setting(&conn, "lang", &v)?;
        }
    }
    if let Some(v) = patch.civitai_api_key {
        put_setting(&conn, "civitai_api_key", v.trim())?;
    }
    read_settings(&conn)
}
