//! LoraShelf backend: a parallel shelf to the prompt cards, with its own
//! groups and tags tables. Schema mirrors `cards.rs` so both shelves evolve
//! the same way; the SQL differs only in table/column names.

use crate::cards::{clean_tags, image_info_from_row};
use crate::dedup;
use crate::images::{self, ImportSettings};
use crate::models::{
    es, DuplicateCheckInput, DuplicateHit, GroupInfo, ImageInfo, ListFilter, LoraDetail, LoraSummary,
    MoveCardsInput, NewGroupInput, NewLoraInput, RenameGroupInput, TagCount, UpdateLoraInput,
};
use crate::store;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::path::Path;

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Trims each entry, drops empties/oversized ones, de-duplicates case-insensitive.
fn clean_strings(values: &[String], max_each: usize, max_total: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for v in values {
        if out.len() >= max_total {
            break;
        }
        let v = v.trim().to_string();
        if v.is_empty() || v.len() > max_each {
            continue;
        }
        if seen.insert(v.to_lowercase()) {
            out.push(v);
        }
    }
    out
}

fn strings_json(values: &[String]) -> String {
    serde_json::to_string(&clean_strings(values, 96, 64)).unwrap_or_else(|_| "[]".to_string())
}

fn parse_strings(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn tag_id(conn: &Connection, name: &str) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO lora_tags(name) VALUES(?1) ON CONFLICT(name) DO NOTHING",
        params![name],
    )
    .map_err(es)?;
    conn.query_row("SELECT id FROM lora_tags WHERE name = ?1", params![name], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(es)
}

fn link_tags(conn: &Connection, lora_id: &str, tags: &[String]) -> Result<(), String> {
    for t in tags {
        let id = tag_id(conn, t)?;
        conn.execute(
            "INSERT OR IGNORE INTO lora_card_tags(lora_id, tag_id) VALUES(?1, ?2)",
            params![lora_id, id],
        )
        .map_err(es)?;
    }
    Ok(())
}

fn drop_orphan_tags(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM lora_tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM lora_card_tags)",
        [],
    )
    .map_err(es)?;
    Ok(())
}

fn abs(dir: &Path, rel_path: &str) -> String {
    dir.join(rel_path).to_string_lossy().into_owned()
}

/// `civitai:model:<id>` → the model page link behind the source key. Manual
/// loras (no import origin) stay empty — the detail card then hides the link.
fn lora_source_url(source_key: &str) -> String {
    source_key
        .strip_prefix("civitai:model:")
        .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()))
        .map(|id| format!("https://civitai.com/models/{id}"))
        .unwrap_or_default()
}

fn tags_for_loras(conn: &Connection, ids: &[String]) -> Result<HashMap<String, Vec<String>>, String> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    let idset: HashSet<&String> = ids.iter().collect();
    let mut stmt = conn
        .prepare(
            "SELECT ct.lora_id, t.name FROM lora_card_tags ct
             JOIN lora_tags t ON t.id = ct.tag_id ORDER BY t.name",
        )
        .map_err(es)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(es)?;
    for row in rows {
        let (lora_id, name) = row.map_err(es)?;
        if idset.contains(&lora_id) {
            map.entry(lora_id).or_default().push(name);
        }
    }
    Ok(map)
}

// ---------------------------------------------------------------- list

fn build_filter_sql(filter: &ListFilter) -> (String, Vec<rusqlite::types::Value>) {
    use rusqlite::types::Value;
    let mut clauses: Vec<String> = Vec::new();
    let mut vals: Vec<Value> = Vec::new();

    if let Some(q) = filter.q.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let escaped = q
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pat = format!("%{}%", escaped.to_lowercase());
        clauses.push(
            "(LOWER(c.name) LIKE ? ESCAPE '\\' OR LOWER(c.description) LIKE ? ESCAPE '\\'
              OR LOWER(c.base_model) LIKE ? ESCAPE '\\' OR LOWER(c.trigger_words) LIKE ? ESCAPE '\\'
              OR EXISTS (
                SELECT 1 FROM lora_card_tags ct2 JOIN lora_tags t2 ON t2.id = ct2.tag_id
                WHERE ct2.lora_id = c.id AND LOWER(t2.name) LIKE ? ESCAPE '\\'
              ))"
            .to_string(),
        );
        for _ in 0..5 {
            vals.push(Value::Text(pat.clone()));
        }
    }

    let tags = clean_tags(&filter.tags);
    if !tags.is_empty() {
        let placeholders = vec!["?"; tags.len()].join(",");
        clauses.push(format!(
            "c.id IN (SELECT ct.lora_id FROM lora_card_tags ct JOIN lora_tags t ON t.id = ct.tag_id WHERE t.name COLLATE NOCASE IN ({placeholders}))"
        ));
        for t in tags {
            vals.push(Value::Text(t));
        }
    }

    let min_rating = filter.min_rating.clamp(0, 5);
    if min_rating > 0 {
        clauses.push("c.rating >= ?".to_string());
        vals.push(Value::Integer(min_rating));
    }

    if let Some(g) = filter.group_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        clauses.push("c.group_id = ?".to_string());
        vals.push(Value::Text(g.to_string()));
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };

    let order_sql = match filter.sort.as_deref() {
        Some("oldest") => "c.created_at ASC".to_string(),
        Some("rating") => "c.rating DESC, c.created_at DESC".to_string(),
        _ => "c.created_at DESC".to_string(),
    };

    (format!("{where_sql} ORDER BY {order_sql}"), vals)
}

pub fn list_loras_inner(dir: &Path, filter: &ListFilter) -> Result<Vec<LoraSummary>, String> {
    let conn = store::open(dir)?;
    store::default_lora_group_id(&conn)?;

    let (tail, vals) = build_filter_sql(filter);
    // Columns: 0..=9 lora fields, 10..=16 cover image, 17 group, 18 origin.
    let sql = format!(
        "SELECT c.id, c.name, c.base_model, c.published_at, c.primary_tag, c.trigger_words, c.rating, c.created_at, c.updated_at, c.cover_image_id,
                cv.id, cv.file, cv.thumb, cv.original, cv.width, cv.height, cv.bytes,
                c.group_id, c.source_key
         FROM loras c
         LEFT JOIN lora_images cv ON cv.lora_id = c.id
           AND cv.id = COALESCE(c.cover_image_id,
                 (SELECT x.id FROM lora_images x WHERE x.lora_id = c.id ORDER BY x.sort, x.id LIMIT 1))
         {tail}"
    );

    let mut stmt = conn.prepare(&sql).map_err(es)?;
    let mapped = stmt
        .query_map(rusqlite::params_from_iter(vals.iter()), |r| {
            let cover_id: Option<String> = r.get(9)?;
            let file: Option<String> = r.get(11)?;
            let cover = if cover_id.is_some() && file.is_some() {
                Some(ImageInfo {
                    id: r.get(10)?,
                    file: abs(dir, &file.unwrap()),
                    thumb: abs(dir, &r.get::<_, String>(12)?),
                    original: r.get::<_, Option<String>>(13)?.map(|p| abs(dir, &p)),
                    width: r.get(14)?,
                    height: r.get(15)?,
                    bytes: r.get(16)?,
                })
            } else {
                None
            };
            let trigger_raw: String = r.get(5)?;
            let source_key: String = r.get(18)?;
            Ok(LoraSummary {
                id: r.get(0)?,
                name: r.get(1)?,
                base_model: r.get(2)?,
                published_at: r.get(3)?,
                primary_tag: r.get(4)?,
                trigger_words: parse_strings(&trigger_raw),
                rating: r.get(6)?,
                created_at: r.get(7)?,
                updated_at: r.get(8)?,
                source_url: lora_source_url(&source_key),
                tags: Vec::new(),
                cover,
                group_id: r.get::<_, Option<String>>(17)?.unwrap_or_default(),
            })
        })
        .map_err(es)?;

    let mut out: Vec<LoraSummary> = Vec::new();
    let mut ids: Vec<String> = Vec::new();
    for row in mapped {
        let entry = row.map_err(es)?;
        ids.push(entry.id.clone());
        out.push(entry);
    }
    drop(stmt);
    let tag_map = tags_for_loras(&conn, &ids)?;
    for (i, id) in ids.iter().enumerate() {
        out[i].tags = tag_map.get(id).cloned().unwrap_or_default();
    }
    // legacy NULL groups fall back to the lora default group
    let mut fallback: Option<String> = None;
    for s in &mut out {
        if s.group_id.is_empty() {
            if fallback.is_none() {
                fallback = Some(store::default_lora_group_id(&conn)?);
            }
            s.group_id = fallback.clone().unwrap_or_default();
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- detail

pub fn get_lora_inner(dir: &Path, id: &str) -> Result<LoraDetail, String> {
    let conn = store::open(dir)?;

    let mut lora = conn
        .query_row(
            "SELECT id, name, base_model, published_at, usage_tips, trigger_words, description,
                    primary_tag, note, rating, created_at, updated_at, group_id, source_key
             FROM loras WHERE id = ?1",
            params![id],
            |r| {
                let usage_raw: String = r.get(4)?;
                let trigger_raw: String = r.get(5)?;
                Ok(LoraDetail {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    base_model: r.get(2)?,
                    published_at: r.get(3)?,
                    usage_tips: parse_strings(&usage_raw),
                    trigger_words: parse_strings(&trigger_raw),
                    description: r.get(6)?,
                    primary_tag: r.get(7)?,
                    note: r.get(8)?,
                    rating: r.get(9)?,
                    created_at: r.get(10)?,
                    updated_at: r.get(11)?,
                    source_url: lora_source_url(&r.get::<_, String>(13)?),
                    group_id: r.get::<_, Option<String>>(12)?.unwrap_or_default(),
                    tags: Vec::new(),
                    images: Vec::new(),
                    cover: None,
                })
            },
        )
        .map_err(|e| format!("lora not found: {e}"))?;
    if lora.group_id.is_empty() {
        lora.group_id = store::default_lora_group_id(&conn)?;
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT id, file, thumb, original, width, height, bytes
                 FROM lora_images WHERE lora_id = ?1 ORDER BY sort, id",
            )
            .map_err(es)?;
        let rows = stmt.query_map(params![id], |r| image_info_from_row(dir, r)).map_err(es)?;
        for row in rows {
            lora.images.push(row.map_err(es)?);
        }
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT t.name FROM lora_card_tags ct JOIN lora_tags t ON t.id = ct.tag_id
                 WHERE ct.lora_id = ?1 ORDER BY t.name",
            )
            .map_err(es)?;
        let rows = stmt.query_map(params![id], |r| r.get::<_, String>(0)).map_err(es)?;
        for row in rows {
            lora.tags.push(row.map_err(es)?);
        }
    }

    lora.cover = lora.images.first().cloned();
    Ok(lora)
}

// ---------------------------------------------------------------- create

pub fn create_lora_inner(dir: &Path, input: NewLoraInput) -> Result<LoraDetail, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("LORA_NAME_REQUIRED".to_string());
    }
    let conn = store::open(dir)?;
    let settings: ImportSettings = images::import_settings(&conn);

    // Compress staged preview images first; roll back created files on failure.
    let mut processed: Vec<images::Processed> = Vec::new();
    for p in &input.images {
        match images::process_into(Path::new(p), dir, &settings) {
            Ok(pr) => processed.push(pr),
            Err(e) => {
                for pr in &processed {
                    let _ = std::fs::remove_file(dir.join(&pr.file));
                    let _ = std::fs::remove_file(dir.join(&pr.thumb));
                    if let Some(o) = &pr.original {
                        let _ = std::fs::remove_file(dir.join(o));
                    }
                }
                return Err(e);
            }
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    let ts = now();
    let rating = input.rating.clamp(0, 5);
    let tags = clean_tags(&input.tags);
    let base_model = input.base_model.trim().to_string();
    let published_at = input.published_at.trim().to_string();
    let usage_tips = strings_json(&input.usage_tips);
    let trigger_words = strings_json(&input.trigger_words);
    let description = input.description.trim().to_string();
    let primary_tag = input
        .primary_tag
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 48)
        .map(|s| s.to_string());
    let note = input.note.trim().to_string();
    let source_key = input
        .source_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let text_hash = dedup::text_fingerprint(&name);

    let group_id = match input.group_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(g) => {
            let ok: bool = conn
                .query_row("SELECT 1 FROM lora_groups WHERE id = ?1", params![g], |_| Ok(true))
                .optional()
                .map_err(es)?
                .unwrap_or(false);
            if ok { g.to_string() } else { store::default_lora_group_id(&conn)? }
        }
        None => store::default_lora_group_id(&conn)?,
    };

    conn.execute(
        "INSERT INTO loras(id, name, base_model, published_at, usage_tips, trigger_words, description,
                           primary_tag, note, rating, created_at, updated_at, group_id, source_key, text_hash)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,?12,?13,?14)",
        params![
            id, name, base_model, published_at, usage_tips, trigger_words, description,
            primary_tag, note, rating, ts, group_id, source_key, text_hash
        ],
    )
    .map_err(es)?;

    for (i, pr) in processed.iter().enumerate() {
        let img_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO lora_images(id, lora_id, file, thumb, original, width, height, bytes, sort)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![img_id, id, pr.file, pr.thumb, pr.original, pr.width, pr.height, pr.bytes, i as i64],
        )
        .map_err(es)?;
        if i == 0 {
            conn.execute("UPDATE loras SET cover_image_id = ?1 WHERE id = ?2", params![img_id, id])
                .map_err(es)?;
        }
    }

    link_tags(&conn, &id, &tags)?;
    drop_orphan_tags(&conn)?;

    for p in &input.images {
        let _ = std::fs::remove_file(p);
    }

    get_lora_inner(dir, &id)
}

// ---------------------------------------------------------------- update / delete

pub fn update_lora_inner(dir: &Path, input: UpdateLoraInput) -> Result<LoraDetail, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("LORA_NAME_REQUIRED".to_string());
    }
    let conn = store::open(dir)?;
    let rating = input.rating.clamp(0, 5);
    let tags = clean_tags(&input.tags);
    let base_model = input.base_model.trim().to_string();
    let usage_tips = strings_json(&input.usage_tips);
    let trigger_words = strings_json(&input.trigger_words);
    let description = input.description.trim().to_string();
    let primary_tag = input
        .primary_tag
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 48)
        .map(|s| s.to_string());
    let note = input.note.trim().to_string();

    let n = conn
        .execute(
            "UPDATE loras SET name = ?1, base_model = ?2, usage_tips = ?3, trigger_words = ?4,
                              description = ?5, primary_tag = ?6, note = ?7, rating = ?8,
                              text_hash = ?9, updated_at = ?10
             WHERE id = ?11",
            params![name, base_model, usage_tips, trigger_words, description, primary_tag, note, rating, dedup::text_fingerprint(&name), now(), input.id],
        )
        .map_err(es)?;
    if n == 0 {
        return Err("lora not found".to_string());
    }

    conn.execute("DELETE FROM lora_card_tags WHERE lora_id = ?1", params![input.id]).map_err(es)?;
    link_tags(&conn, &input.id, &tags)?;
    drop_orphan_tags(&conn)?;

    get_lora_inner(dir, &input.id)
}

pub fn delete_lora_inner(dir: &Path, id: &str) -> Result<(), String> {
    let conn = store::open(dir)?;

    let mut files: Vec<String> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT file, thumb, original FROM lora_images WHERE lora_id = ?1")
            .map_err(es)?;
        let rows = stmt
            .query_map(params![id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(es)?;
        for row in rows {
            let (f, t, o) = row.map_err(es)?;
            files.push(f);
            files.push(t);
            if let Some(o) = o {
                files.push(o);
            }
        }
    }

    conn.execute("DELETE FROM loras WHERE id = ?1", params![id]).map_err(es)?;
    drop_orphan_tags(&conn)?;

    for f in files {
        let _ = std::fs::remove_file(dir.join(f));
    }
    Ok(())
}

// ---------------------------------------------------------------- images

pub fn add_lora_image_inner(dir: &Path, lora: &str, path: &str) -> Result<ImageInfo, String> {
    let conn = store::open(dir)?;
    let settings = images::import_settings(&conn);
    let pr = images::process_into(Path::new(path), dir, &settings)?;
    let _ = std::fs::remove_file(path);

    let next: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort) + 1, 0) FROM lora_images WHERE lora_id = ?1",
            params![lora],
            |r| r.get(0),
        )
        .map_err(es)?;
    let img_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO lora_images(id, lora_id, file, thumb, original, width, height, bytes, sort)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![img_id, lora, pr.file, pr.thumb, pr.original, pr.width, pr.height, pr.bytes, next],
    )
    .map_err(es)?;

    conn.execute(
        "UPDATE loras SET cover_image_id = ?1 WHERE id = ?2 AND cover_image_id IS NULL",
        params![img_id, lora],
    )
    .map_err(es)?;

    Ok(ImageInfo {
        id: img_id,
        file: abs(dir, &pr.file),
        thumb: abs(dir, &pr.thumb),
        original: pr.original.map(|p| abs(dir, &p)),
        width: pr.width,
        height: pr.height,
        bytes: pr.bytes,
    })
}

pub fn delete_lora_image_inner(dir: &Path, id: &str) -> Result<(), String> {
    let conn = store::open(dir)?;
    let row = conn
        .query_row(
            "SELECT file, thumb, original FROM lora_images WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .map_err(|e| format!("image not found: {e}"))?;

    conn.execute("DELETE FROM lora_images WHERE id = ?1", params![id]).map_err(es)?;
    conn.execute("UPDATE loras SET cover_image_id = NULL WHERE cover_image_id = ?1", params![id])
        .map_err(es)?;

    let _ = std::fs::remove_file(dir.join(&row.0));
    let _ = std::fs::remove_file(dir.join(&row.1));
    if let Some(o) = row.2 {
        let _ = std::fs::remove_file(dir.join(o));
    }
    Ok(())
}

pub fn set_lora_cover_inner(dir: &Path, id: &str) -> Result<(), String> {
    let conn = store::open(dir)?;
    let lora: String = conn
        .query_row("SELECT lora_id FROM lora_images WHERE id = ?1", params![id], |r| r.get(0))
        .map_err(es)?;
    conn.execute("UPDATE loras SET cover_image_id = ?1 WHERE id = ?2", params![id, lora])
        .map_err(es)?;
    Ok(())
}

// ---------------------------------------------------------------- groups

pub fn list_lora_groups_inner(dir: &Path) -> Result<Vec<GroupInfo>, String> {
    let conn = store::open(dir)?;
    store::default_lora_group_id(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT g.id, g.name, g.is_default, COUNT(c.id)
             FROM lora_groups g
             LEFT JOIN loras c ON c.group_id = g.id
             GROUP BY g.id
             ORDER BY g.is_default DESC, g.sort, g.name COLLATE NOCASE",
        )
        .map_err(es)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(GroupInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                is_default: r.get::<_, i64>(2)? != 0,
                count: r.get(3)?,
            })
        })
        .map_err(es)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(es)?);
    }
    Ok(out)
}

fn clean_group_name(name: &str) -> Result<String, String> {
    let name = name.trim().replace('\n', " ");
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err("GROUP_NAME_REQUIRED".to_string());
    }
    if name.len() > 48 {
        return Err("GROUP_NAME_TOO_LONG".to_string());
    }
    Ok(name)
}

pub fn create_lora_group_inner(dir: &Path, input: NewGroupInput) -> Result<GroupInfo, String> {
    let name = clean_group_name(&input.name)?;
    let conn = store::open(dir)?;
    let sort: i64 = conn
        .query_row("SELECT COALESCE(MAX(sort) + 1, 1) FROM lora_groups", [], |r| r.get(0))
        .map_err(es)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO lora_groups(id, name, is_default, sort, created_at) VALUES(?1, ?2, 0, ?3, ?4)",
        params![id, name, sort, now()],
    )
    .map_err(es)?;
    Ok(GroupInfo { id, name, is_default: false, count: 0 })
}

pub fn rename_lora_group_inner(dir: &Path, input: RenameGroupInput) -> Result<(), String> {
    let name = clean_group_name(&input.name)?;
    let conn = store::open(dir)?;
    let n = conn
        .execute("UPDATE lora_groups SET name = ?1 WHERE id = ?2", params![name, input.id])
        .map_err(es)?;
    if n == 0 {
        return Err("group not found".to_string());
    }
    Ok(())
}

pub fn delete_lora_group_inner(dir: &Path, id: &str) -> Result<(), String> {
    let conn = store::open(dir)?;
    let group: (i64, String) = conn
        .query_row("SELECT is_default, name FROM lora_groups WHERE id = ?1", params![id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get(1)?))
        })
        .optional()
        .map_err(es)?
        .ok_or_else(|| "group not found".to_string())?;
    if group.0 != 0 {
        return Err("GROUP_DEFAULT".to_string());
    }

    let default_id = store::default_lora_group_id(&conn)?;
    conn.execute(
        "UPDATE loras SET group_id = ?1 WHERE group_id = ?2",
        params![default_id, id],
    )
    .map_err(es)?;
    conn.execute("DELETE FROM lora_groups WHERE id = ?1", params![id]).map_err(es)?;
    Ok(())
}

pub fn move_loras_inner(dir: &Path, input: MoveCardsInput) -> Result<(), String> {
    if input.ids.is_empty() {
        return Ok(());
    }
    let conn = store::open(dir)?;
    let ok: bool = conn
        .query_row("SELECT 1 FROM lora_groups WHERE id = ?1", params![input.group_id], |_| Ok(true))
        .optional()
        .map_err(es)?
        .unwrap_or(false);
    if !ok {
        return Err("group not found".to_string());
    }

    let placeholders = vec!["?"; input.ids.len()].join(",");
    let sql = format!("UPDATE loras SET group_id = ?1, updated_at = ?2 WHERE id IN ({placeholders})");
    let mut vals: Vec<rusqlite::types::Value> =
        vec![rusqlite::types::Value::Text(input.group_id.clone()), rusqlite::types::Value::Text(now())];
    for id in &input.ids {
        vals.push(rusqlite::types::Value::Text(id.clone()));
    }
    conn.execute(&sql, rusqlite::params_from_iter(vals.iter())).map_err(es)?;
    Ok(())
}

// ---------------------------------------------------------------- tags

pub fn list_lora_tags_inner(dir: &Path) -> Result<Vec<TagCount>, String> {
    let conn = store::open(dir)?;
    let mut stmt = conn
        .prepare(
            "SELECT t.name, COUNT(ct.lora_id) FROM lora_tags t
             LEFT JOIN lora_card_tags ct ON ct.tag_id = t.id
             GROUP BY t.id ORDER BY COUNT(ct.lora_id) DESC, t.name ASC",
        )
        .map_err(es)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TagCount {
                name: r.get(0)?,
                count: r.get(1)?,
            })
        })
        .map_err(es)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(es)?);
    }
    Ok(out)
}

// ---------------------------------------------------------------- duplicates

/// Duplicate lookup for the lora shelf: by imported origin key when given,
/// otherwise by the normalized lora name.
pub fn find_lora_duplicates(dir: &Path, input: &DuplicateCheckInput) -> Result<Vec<DuplicateHit>, String> {
    let conn = store::open(dir)?;

    let source_key = input.source_key.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let (col, key) = if let Some(sk) = source_key {
        ("c.source_key", sk.to_string())
    } else {
        let name = input.prompt.as_deref().unwrap_or("").trim();
        if name.is_empty() {
            return Ok(vec![]);
        }
        ("c.text_hash", dedup::text_fingerprint(name))
    };
    let sql = format!(
        "SELECT c.id, c.created_at, c.name, ci.thumb
         FROM loras c
         LEFT JOIN lora_images ci ON ci.id = c.cover_image_id
         WHERE {col} = ?1
         ORDER BY c.created_at DESC
         LIMIT 5"
    );

    let mut stmt = conn.prepare(&sql).map_err(es)?;
    let mapped = stmt
        .query_map(params![key], |r| {
            Ok(DuplicateHit {
                id: r.get(0)?,
                created_at: r.get(1)?,
                prompt: r.get(2)?,
                thumb: r.get(3)?,
            })
        })
        .map_err(es)?;
    Ok(mapped.filter_map(|r| r.ok()).collect())
}

// ---------------------------------------------------------------- commands (thin wrappers)

#[tauri::command]
pub fn list_loras(state: tauri::State<'_, crate::AppState>, filter: ListFilter) -> Result<Vec<LoraSummary>, String> {
    list_loras_inner(&state.dir, &filter)
}

#[tauri::command]
pub fn get_lora(state: tauri::State<'_, crate::AppState>, id: String) -> Result<LoraDetail, String> {
    get_lora_inner(&state.dir, &id)
}

#[tauri::command]
pub fn create_lora(state: tauri::State<'_, crate::AppState>, input: NewLoraInput) -> Result<LoraDetail, String> {
    create_lora_inner(&state.dir, input)
}

#[tauri::command]
pub fn update_lora(state: tauri::State<'_, crate::AppState>, input: UpdateLoraInput) -> Result<LoraDetail, String> {
    update_lora_inner(&state.dir, input)
}

#[tauri::command]
pub fn delete_lora(state: tauri::State<'_, crate::AppState>, id: String) -> Result<(), String> {
    delete_lora_inner(&state.dir, &id)
}

#[tauri::command]
pub fn add_lora_image(state: tauri::State<'_, crate::AppState>, lora: String, path: String) -> Result<ImageInfo, String> {
    add_lora_image_inner(&state.dir, &lora, &path)
}

#[tauri::command]
pub fn delete_lora_image(state: tauri::State<'_, crate::AppState>, id: String) -> Result<(), String> {
    delete_lora_image_inner(&state.dir, &id)
}

#[tauri::command]
pub fn set_lora_cover(state: tauri::State<'_, crate::AppState>, id: String) -> Result<(), String> {
    set_lora_cover_inner(&state.dir, &id)
}

#[tauri::command]
pub fn list_lora_tags(state: tauri::State<'_, crate::AppState>) -> Result<Vec<TagCount>, String> {
    list_lora_tags_inner(&state.dir)
}

#[tauri::command]
pub fn list_lora_groups(state: tauri::State<'_, crate::AppState>) -> Result<Vec<GroupInfo>, String> {
    list_lora_groups_inner(&state.dir)
}

#[tauri::command]
pub fn create_lora_group(state: tauri::State<'_, crate::AppState>, input: NewGroupInput) -> Result<GroupInfo, String> {
    create_lora_group_inner(&state.dir, input)
}

#[tauri::command]
pub fn rename_lora_group(state: tauri::State<'_, crate::AppState>, input: RenameGroupInput) -> Result<(), String> {
    rename_lora_group_inner(&state.dir, input)
}

#[tauri::command]
pub fn delete_lora_group(state: tauri::State<'_, crate::AppState>, id: String) -> Result<(), String> {
    delete_lora_group_inner(&state.dir, &id)
}

#[tauri::command]
pub fn move_loras(state: tauri::State<'_, crate::AppState>, input: MoveCardsInput) -> Result<(), String> {
    move_loras_inner(&state.dir, input)
}

#[tauri::command]
pub fn check_lora_duplicates(
    state: tauri::State<'_, crate::AppState>,
    input: DuplicateCheckInput,
) -> Result<Vec<DuplicateHit>, String> {
    find_lora_duplicates(&state.dir, &input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_string_lists() {
        let v = clean_strings(&["a".into(), " A ".into(), "".into(), "b".into()], 96, 64);
        assert_eq!(v, vec!["a", "b"]);
        assert_eq!(clean_strings(&["x".into()], 96, 0), Vec::<String>::new());
    }
}
