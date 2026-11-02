use crate::models::{es, DuplicateHit, DuplicateCheckInput};
use crate::store;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::path::Path;

// ---------------------------------------------------------------- fingerprints

/// Stable key for an imported card origin, e.g. `civitai:images:146266112`.
/// Fingers the exact CivitAI image/post of the link the user pasted, so
/// re-importing the same link is detected regardless of any text edits.
pub fn civitai_key(kind: &str, id: &str) -> String {
    format!("civitai:{kind}:{id}")
}

/// 16-char (8-byte) SHA-256 hex fingerprint of the normalized prompt text.
/// Normalization: NFC → lowercase → collapse whitespace, so copy-pastes and
/// retyped variants of the same text collide into one row.
pub fn text_fingerprint(raw: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let nfc: String = raw.nfc().collect();
    let flat = nfc.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
    let digest = Sha256::digest(flat.as_bytes());
    let mut hex = String::with_capacity(16);
    for b in &digest[..8] {
        hex.push_str(&format!("{b:02x}"));
    }
    hex
}

// ---------------------------------------------------------------- lookup

/// The two lookup layers, funneling into one indexed query:
///   1. `source_key` — exact CivitAI origin match (asked on link imports);
///   2. `text_hash`  — normalized prompt text match (asked on manual input).
/// Returns up to 5 recent hits, each with the cover thumbnail for the dialog.
pub fn find_inner(dir: &Path, input: &DuplicateCheckInput) -> Result<Vec<DuplicateHit>, String> {
    let conn = store::open(dir)?;

    let source_key = input.source_key.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let prompt = input.prompt.as_deref().unwrap_or("");

    let sql = "SELECT c.id, c.created_at, c.prompt, ci.thumb
               FROM cards c
               LEFT JOIN card_images ci ON ci.id = c.cover_image_id
               WHERE {col} = ?1
               ORDER BY c.created_at DESC
               LIMIT 5";
    let (col, key) = if let Some(sk) = source_key {
        ("c.source_key", sk.to_string())
    } else {
        let normalized = prompt.trim();
        if normalized.is_empty() {
            return Ok(vec![]);
        }
        ("c.text_hash", text_fingerprint(normalized))
    };
    let sql = sql.replace("{col}", col);

    let mut stmt = conn.prepare(&sql).map_err(es)?;
    let mapped = stmt
        .query_map(params![key], |r| {
            Ok(DuplicateHit {
                id: r.get(0)?,
                created_at: r.get(1)?,
                prompt: r.get(2)?,
                thumb: r.get(3)?
            })
        })
        .map_err(es)?;
    let hits: Vec<DuplicateHit> = mapped.filter_map(|r| r.ok()).collect();
    Ok(hits)
}

#[tauri::command]
pub fn check_duplicates(state: tauri::State<'_, crate::AppState>, input: DuplicateCheckInput) -> Result<Vec<DuplicateHit>, String> {
    find_inner(&state.dir, &input)
}

// ---------------------------------------------------------------- migration

/// One-time backfill for libraries created before dedup existed:
///   - text_hash for every card (from the current prompt text);
///   - source_key for CivitAI imports, whose meta carries an "id" row
///     (the image id from `other_meta`) — derive `civitai:images:<id>` from it.
/// Gated by a settings flag so repeated opens don't rescan the library.
/// Skips silently on failure: the flag stays unset and the next launch retries.
pub fn backfill_once(conn: &Connection) {
    let flag: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'dup_backfill_v1'",
            [],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten();
    if flag.is_some() {
        return;
    }

    let done = (|| -> Result<(), String> {
        resolve_text_hashes(conn)?;
        resolve_source_keys(conn)?;
        conn.execute(
            "INSERT OR REPLACE INTO settings(key, value) VALUES('dup_backfill_v1', '1')",
            [],
        )
        .map_err(es)?;
        Ok(())
    })();

    if done.is_err() {
        // Soft: leave the flag unset, retry on the next open.
    }
}

fn resolve_text_hashes(conn: &Connection) -> Result<(), String> {
    let select = {
        let mut stmt = conn
            .prepare("SELECT id, prompt FROM cards WHERE text_hash IS NULL")
            .map_err(es)?;
        let mapped = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(es)?;
        mapped.filter_map(|r| r.ok()).collect()
    };
    let rows: Vec<(String, String)> = select;
    for (id, prompt) in rows {
        let _ = conn
            .execute(
                "UPDATE cards SET text_hash = ?1 WHERE id = ?2 AND text_hash IS NULL",
                params![text_fingerprint(&prompt), id],
            )
            .map_err(es);
    }
    Ok(())
}

fn resolve_source_keys(conn: &Connection) -> Result<(), String> {
    let select = {
        let mut stmt = conn
            .prepare("SELECT id, meta_json FROM cards WHERE source_key IS NULL AND meta_json LIKE '%\"k\":\"id\"%'")
            .map_err(es)?;
        let mapped = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(es)?;
        mapped.filter_map(|r| r.ok()).collect()
    };
    let rows: Vec<(String, String)> = select;
    for (id, meta_json) in rows {
        let Some(sk) = source_key_from_meta(&meta_json) else { continue };
        let _ = conn
            .execute(
                "UPDATE cards SET source_key = ?1 WHERE id = ?2 AND source_key IS NULL",
                params![sk, id],
            )
            .map_err(es);
    }
    Ok(())
}

/// CivitAI imports keep the numeric image id as a meta row { k: "id", v: "…" }.
fn source_key_from_meta(meta_json: &str) -> Option<String> {
    let items: Vec<crate::models::MetaItem> = serde_json::from_str(meta_json).ok()?;
    let row = items.iter().find(|i| i.k == "id")?;
    let v = row.v.trim().trim_end_matches('…');
    if v.chars().all(|c| c.is_ascii_digit()) && !v.is_empty() {
        Some(civitai_key("images", v))
    } else {
        None
    }
}
