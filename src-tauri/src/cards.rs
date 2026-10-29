use crate::images::{self, ImportSettings};
use crate::models::{
    es, CardDetail, CardSummary, GroupInfo, ImageInfo, ListFilter, Lora, MoveCardsInput, NewCardInput, NewGroupInput,
    RenameGroupInput, TagCount, UpdateCardInput,
};
use crate::store;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::path::Path;

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn clean_tags(tags: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for t in tags {
        let t = t.trim().trim_start_matches('#').to_string();
        if t.is_empty() || t.len() > 48 {
            continue;
        }
        let key = t.to_lowercase();
        if seen.insert(key) {
            out.push(t);
        }
    }
    out
}

fn clean_loras(loras: &[Lora]) -> Vec<Lora> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for l in loras {
        let name = l.name.trim().to_string();
        let value = l.value.trim().to_string();
        if name.is_empty() || name.len() > 64 || value.len() > 32 {
            continue;
        }
        let key = name.to_lowercase();
        if seen.insert(key) {
            out.push(Lora { name, value });
        }
        if out.len() >= 24 {
            break;
        }
    }
    out
}

fn loras_json(loras: &[Lora]) -> String {
    serde_json::to_string(&clean_loras(loras)).unwrap_or_else(|_| "[]".to_string())
}

fn parse_loras(s: &str) -> Vec<Lora> {
    serde_json::from_str(s).unwrap_or_default()
}

/// Trims/clamps every metadata row; de-duplicates by key.
fn clean_meta(meta: &[crate::models::MetaItem]) -> Vec<crate::models::MetaItem> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for m in meta {
        let k = m.k.trim().to_string();
        let v = m.v.trim().to_string();
        if k.is_empty() || k.len() > 48 || v.is_empty() || v.len() > 400 {
            continue;
        }
        if seen.insert(k.to_lowercase()) {
            out.push(crate::models::MetaItem { k, v });
        }
        if out.len() >= 24 {
            break;
        }
    }
    out
}

fn meta_json(meta: &[crate::models::MetaItem]) -> String {
    serde_json::to_string(&clean_meta(meta)).unwrap_or_else(|_| "[]".to_string())
}

fn parse_meta(s: &str) -> Vec<crate::models::MetaItem> {
    serde_json::from_str(s).unwrap_or_default()
}

fn tag_id(conn: &Connection, name: &str) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO tags(name) VALUES(?1) ON CONFLICT(name) DO NOTHING",
        params![name],
    )
    .map_err(es)?;
    conn.query_row("SELECT id FROM tags WHERE name = ?1", params![name], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(es)
}

fn link_tags(conn: &Connection, card_id: &str, tags: &[String]) -> Result<(), String> {
    for t in tags {
        let id = tag_id(conn, t)?;
        conn.execute(
            "INSERT OR IGNORE INTO card_tags(card_id, tag_id) VALUES(?1, ?2)",
            params![card_id, id],
        )
        .map_err(es)?;
    }
    Ok(())
}

fn drop_orphan_tags(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM card_tags)",
        [],
    )
    .map_err(es)?;
    Ok(())
}

fn abs(dir: &Path, rel_path: &str) -> String {
    dir.join(rel_path).to_string_lossy().into_owned()
}

fn image_info_from_row(dir: &Path, r: &rusqlite::Row) -> rusqlite::Result<ImageInfo> {
    Ok(ImageInfo {
        id: r.get(0)?,
        file: abs(dir, &r.get::<_, String>(1)?),
        thumb: abs(dir, &r.get::<_, String>(2)?),
        original: r.get::<_, Option<String>>(3)?.map(|p| abs(dir, &p)),
        width: r.get(4)?,
        height: r.get(5)?,
        bytes: r.get(6)?,
    })
}

fn tags_for_cards(conn: &Connection, ids: &[String]) -> Result<HashMap<String, Vec<String>>, String> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    let idset: HashSet<&String> = ids.iter().collect();
    let mut stmt = conn
        .prepare(
            "SELECT ct.card_id, t.name FROM card_tags ct
             JOIN tags t ON t.id = ct.tag_id ORDER BY t.name",
        )
        .map_err(es)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(es)?;
    for row in rows {
        let (card_id, name) = row.map_err(es)?;
        if idset.contains(&card_id) {
            map.entry(card_id).or_default().push(name);
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
            "(LOWER(c.prompt) LIKE ? ESCAPE '\\' OR LOWER(c.note) LIKE ? ESCAPE '\\' OR LOWER(c.loras) LIKE ? ESCAPE '\\' OR EXISTS (
                SELECT 1 FROM card_tags ct2 JOIN tags t2 ON t2.id = ct2.tag_id
                WHERE ct2.card_id = c.id AND LOWER(t2.name) LIKE ? ESCAPE '\\'
            ))".to_string(),
        );
        vals.push(Value::Text(pat.clone()));
        vals.push(Value::Text(pat.clone()));
        vals.push(Value::Text(pat.clone()));
        vals.push(Value::Text(pat));
    }

    let tags = clean_tags(&filter.tags);
    if !tags.is_empty() {
        let placeholders = vec!["?"; tags.len()].join(",");
        clauses.push(format!(
            "c.id IN (SELECT ct.card_id FROM card_tags ct JOIN tags t ON t.id = ct.tag_id WHERE t.name COLLATE NOCASE IN ({placeholders}))"
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

pub fn list_cards_inner(dir: &Path, filter: &ListFilter) -> Result<Vec<CardSummary>, String> {
    let conn = store::open(dir)?;
    store::init_schema(&conn)?;

    let (tail, vals) = build_filter_sql(filter);
    // Columns: 0..=6 card, 7 image_count, 8..=14 cover image, 15 loras, 16 group.
    let sql = format!(
        "SELECT c.id, c.prompt, c.note, c.rating, c.created_at, c.updated_at, c.cover_image_id,
                (SELECT COUNT(*) FROM card_images ci WHERE ci.card_id = c.id) AS image_count,
                cv.id, cv.file, cv.thumb, cv.original, cv.width, cv.height, cv.bytes,
                c.loras, c.group_id
         FROM cards c
         LEFT JOIN card_images cv ON cv.card_id = c.id
           AND cv.id = COALESCE(c.cover_image_id,
                 (SELECT x.id FROM card_images x WHERE x.card_id = c.id ORDER BY x.sort, x.id LIMIT 1))
         {tail}"
    );

    let mut stmt = conn.prepare(&sql).map_err(es)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(vals.iter()), |r| {
            let cover_id: Option<String> = r.get(6)?;
            let file: Option<String> = r.get(9)?;
            let cover = if cover_id.is_some() && file.is_some() {
                Some(ImageInfo {
                    id: r.get(8)?,
                    file: abs(dir, &file.unwrap()),
                    thumb: abs(dir, &r.get::<_, String>(10)?),
                    original: r.get::<_, Option<String>>(11)?.map(|p| abs(dir, &p)),
                    width: r.get(12)?,
                    height: r.get(13)?,
                    bytes: r.get(14)?,
                })
            } else {
                None
            };
            let loras_raw: String = r.get(15)?;
            Ok((
                CardSummary {
                    id: r.get(0)?,
                    prompt: r.get(1)?,
                    note: r.get(2)?,
                    rating: r.get(3)?,
                    created_at: r.get(4)?,
                    updated_at: r.get(5)?,
                    tags: Vec::new(),
                    image_count: r.get(7)?,
                    cover,
                    group_id: r.get::<_, Option<String>>(16)?.unwrap_or_default(),
                },
                r.get::<_, String>(0)?,
                parse_loras(&loras_raw),
            ))
        })
        .map_err(es)?;

    let mut out: Vec<CardSummary> = Vec::new();
    let mut ids: Vec<String> = Vec::new();
    for row in rows {
        let (card, id, _loras) = row.map_err(es)?;
        out.push(card);
        ids.push(id);
    }
    // The for-loop above consumed `rows`.
    drop(stmt);
    let tag_map = tags_for_cards(&conn, &ids)?;
    for (i, id) in ids.iter().enumerate() {
        out[i].tags = tag_map.get(id).cloned().unwrap_or_default();
    }
    // cards with a NULL group (e.g. legacy rows) fall back to the default group
    let mut fallback: Option<String> = None;
    for s in &mut out {
        if s.group_id.is_empty() {
            if fallback.is_none() {
                fallback = Some(store::default_group_id(&conn)?);
            }
            s.group_id = fallback.clone().unwrap_or_default();
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- detail

pub fn get_card_inner(dir: &Path, id: &str) -> Result<CardDetail, String> {
    let conn = store::open(dir)?;

    let mut card = conn
        .query_row(
            "SELECT id, prompt, negative_prompt, note, rating, created_at, updated_at, loras, group_id, author, checkpoint, meta_json FROM cards WHERE id = ?1",
            params![id],
            |r| {
                let loras_raw: String = r.get(7)?;
                let meta_raw: String = r.get(11)?;
                Ok(CardDetail {
                    id: r.get(0)?,
                    prompt: r.get(1)?,
                    negative_prompt: r.get(2)?,
                    note: r.get(3)?,
                    rating: r.get(4)?,
                    created_at: r.get(5)?,
                    updated_at: r.get(6)?,
                    loras: parse_loras(&loras_raw),
                    group_id: r.get::<_, Option<String>>(8)?.unwrap_or_default(),
                    author: r.get(9)?,
                    checkpoint: r.get(10)?,
                    meta: parse_meta(&meta_raw),
                    tags: Vec::new(),
                    images: Vec::new(),
                })
            },
        )
        .map_err(|e| format!("card not found: {e}"))?;
    if card.group_id.is_empty() {
        card.group_id = store::default_group_id(&conn)?;
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT id, file, thumb, original, width, height, bytes
                 FROM card_images WHERE card_id = ?1 ORDER BY sort, id",
            )
            .map_err(es)?;
        let rows = stmt
            .query_map(params![id], |r| image_info_from_row(dir, r))
            .map_err(es)?;
        for row in rows {
            card.images.push(row.map_err(es)?);
        }
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT t.name FROM card_tags ct JOIN tags t ON t.id = ct.tag_id
                 WHERE ct.card_id = ?1 ORDER BY t.name",
            )
            .map_err(es)?;
        let rows = stmt.query_map(params![id], |r| r.get::<_, String>(0)).map_err(es)?;
        for row in rows {
            card.tags.push(row.map_err(es)?);
        }
    }

    Ok(card)
}

// ---------------------------------------------------------------- create

pub fn create_card_inner(dir: &Path, input: NewCardInput) -> Result<CardDetail, String> {
    let prompt = input.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("PROMPT_REQUIRED".to_string());
    }
    let conn = store::open(dir)?;
    let settings: ImportSettings = images::import_settings(&conn);

    // Compress all staged images first; roll back created files on failure.
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
    let negative_prompt = input.negative_prompt.trim().to_string();
    let note = input.note.trim().to_string();
    let loras = loras_json(&input.loras);
    let author = input.author.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| s.to_string());
    let checkpoint = input.checkpoint.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| s.to_string());
    let meta = meta_json(&input.meta);

    let group_id = match input.group_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(g) => {
            let ok: bool = conn
                .query_row("SELECT 1 FROM groups WHERE id = ?1", params![g], |_| Ok(true))
                .optional()
                .map_err(es)?
                .unwrap_or(false);
            if ok { g.to_string() } else { store::default_group_id(&conn)? }
        }
        None => store::default_group_id(&conn)?,
    };

    conn.execute(
        "INSERT INTO cards(id, prompt, negative_prompt, note, rating, created_at, updated_at, loras, group_id, author, checkpoint, meta_json)
         VALUES(?1,?2,?3,?4,?5,?6,?6,?7,?8,?9,?10,?11)",
        params![id, prompt, negative_prompt, note, rating, ts, loras, group_id, author, checkpoint, meta],
    )
    .map_err(es)?;

    for (i, pr) in processed.iter().enumerate() {
        let img_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO card_images(id, card_id, file, thumb, original, width, height, bytes, sort)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![img_id, id, pr.file, pr.thumb, pr.original, pr.width, pr.height, pr.bytes, i as i64],
        )
        .map_err(es)?;
        if i == 0 {
            conn.execute("UPDATE cards SET cover_image_id = ?1 WHERE id = ?2", params![img_id, id])
                .map_err(es)?;
        }
    }

    link_tags(&conn, &id, &tags)?;
    drop_orphan_tags(&conn)?;

    for p in &input.images {
        let _ = std::fs::remove_file(p);
    }

    get_card_inner(dir, &id)
}

// ---------------------------------------------------------------- update

pub fn update_card_inner(dir: &Path, input: UpdateCardInput) -> Result<(), String> {
    let prompt = input.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("PROMPT_REQUIRED".to_string());
    }
    let conn = store::open(dir)?;
    let rating = input.rating.clamp(0, 5);
    let tags = clean_tags(&input.tags);
    let note = input.note.trim().to_string();
    let loras = loras_json(&input.loras);
    let author = input.author.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| s.to_string());
    let checkpoint = input.checkpoint.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| s.to_string());
    let meta = meta_json(&input.meta);
    let negative_prompt = input.negative_prompt.trim().to_string();

    conn.execute(
        "UPDATE cards SET prompt = ?1, negative_prompt = ?2, note = ?3, rating = ?4, loras = ?5, author = ?6, checkpoint = ?7, meta_json = ?8, updated_at = ?9 WHERE id = ?10",
        params![prompt, negative_prompt, note, rating, loras, author, checkpoint, meta, now(), input.id],
    )
    .map_err(es)?;

    conn.execute("DELETE FROM card_tags WHERE card_id = ?1", params![input.id]).map_err(es)?;
    link_tags(&conn, &input.id, &tags)?;
    drop_orphan_tags(&conn)?;
    Ok(())
}

pub fn delete_card_inner(dir: &Path, id: &str) -> Result<(), String> {
    let conn = store::open(dir)?;

    let mut files: Vec<String> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT file, thumb, original FROM card_images WHERE card_id = ?1")
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

    conn.execute("DELETE FROM cards WHERE id = ?1", params![id]).map_err(es)?;
    drop_orphan_tags(&conn)?;

    for f in files {
        let _ = std::fs::remove_file(dir.join(f));
    }
    Ok(())
}

// ---------------------------------------------------------------- images

pub fn add_card_image_inner(dir: &Path, card: &str, path: &str) -> Result<ImageInfo, String> {
    let conn = store::open(dir)?;
    let settings = images::import_settings(&conn);
    let pr = images::process_into(Path::new(path), dir, &settings)?;
    let _ = std::fs::remove_file(path);

    let next: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort) + 1, 0) FROM card_images WHERE card_id = ?1",
            params![card],
            |r| r.get(0),
        )
        .map_err(es)?;
    let img_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO card_images(id, card_id, file, thumb, original, width, height, bytes, sort)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![img_id, card, pr.file, pr.thumb, pr.original, pr.width, pr.height, pr.bytes, next],
    )
    .map_err(es)?;

    conn.execute(
        "UPDATE cards SET cover_image_id = ?1 WHERE id = ?2 AND cover_image_id IS NULL",
        params![img_id, card],
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

pub fn delete_card_image_inner(dir: &Path, id: &str) -> Result<(), String> {
    let conn = store::open(dir)?;
    let row = conn
        .query_row(
            "SELECT file, thumb, original FROM card_images WHERE id = ?1",
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

    conn.execute("DELETE FROM card_images WHERE id = ?1", params![id]).map_err(es)?;
    conn.execute("UPDATE cards SET cover_image_id = NULL WHERE cover_image_id = ?1", params![id])
        .map_err(es)?;

    let _ = std::fs::remove_file(dir.join(&row.0));
    let _ = std::fs::remove_file(dir.join(&row.1));
    if let Some(o) = row.2 {
        let _ = std::fs::remove_file(dir.join(o));
    }
    Ok(())
}

pub fn set_cover_inner(dir: &Path, id: &str) -> Result<(), String> {
    let conn = store::open(dir)?;
    let card: String = conn
        .query_row("SELECT card_id FROM card_images WHERE id = ?1", params![id], |r| r.get(0))
        .map_err(es)?;
    conn.execute("UPDATE cards SET cover_image_id = ?1 WHERE id = ?2", params![id, card])
        .map_err(es)?;
    Ok(())
}

// ---------------------------------------------------------------- groups

pub fn list_groups_inner(dir: &Path) -> Result<Vec<GroupInfo>, String> {
    let conn = store::open(dir)?;
    store::default_group_id(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT g.id, g.name, g.is_default, COUNT(c.id)
             FROM groups g
             LEFT JOIN cards c ON c.group_id = g.id
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

pub fn create_group_inner(dir: &Path, input: NewGroupInput) -> Result<GroupInfo, String> {
    let name = clean_group_name(&input.name)?;
    let conn = store::open(dir)?;
    let sort: i64 = conn
        .query_row("SELECT COALESCE(MAX(sort) + 1, 1) FROM groups", [], |r| r.get(0))
        .map_err(es)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO groups(id, name, is_default, sort, created_at) VALUES(?1, ?2, 0, ?3, ?4)",
        params![id, name, sort, now()],
    )
    .map_err(es)?;
    Ok(GroupInfo {
        id,
        name,
        is_default: false,
        count: 0,
    })
}

pub fn rename_group_inner(dir: &Path, input: RenameGroupInput) -> Result<(), String> {
    let name = clean_group_name(&input.name)?;
    let conn = store::open(dir)?;
    let n = conn
        .execute("UPDATE groups SET name = ?1 WHERE id = ?2", params![name, input.id])
        .map_err(es)?;
    if n == 0 {
        return Err("group not found".to_string());
    }
    Ok(())
}

pub fn delete_group_inner(dir: &Path, id: &str) -> Result<(), String> {
    let conn = store::open(dir)?;
    let group: (i64, String) = conn
        .query_row("SELECT is_default, name FROM groups WHERE id = ?1", params![id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get(1)?))
        })
        .optional()
        .map_err(es)?
        .ok_or_else(|| "group not found".to_string())?;
    if group.0 != 0 {
        return Err("GROUP_DEFAULT".to_string());
    }

    let default_id = store::default_group_id(&conn)?;
    conn.execute("UPDATE cards SET group_id = ?1 WHERE group_id = ?2", params![default_id, id])
        .map_err(es)?;
    conn.execute("DELETE FROM groups WHERE id = ?1", params![id]).map_err(es)?;
    Ok(())
}

pub fn move_cards_inner(dir: &Path, input: MoveCardsInput) -> Result<(), String> {
    if input.ids.is_empty() {
        return Ok(());
    }
    let conn = store::open(dir)?;
    let ok: bool = conn
        .query_row("SELECT 1 FROM groups WHERE id = ?1", params![input.group_id], |_| Ok(true))
        .optional()
        .map_err(es)?
        .unwrap_or(false);
    if !ok {
        return Err("group not found".to_string());
    }

    let placeholders = vec!["?"; input.ids.len()].join(",");
    let sql = format!("UPDATE cards SET group_id = ?1, updated_at = ?2 WHERE id IN ({placeholders})");
    let mut vals: Vec<rusqlite::types::Value> =
        vec![rusqlite::types::Value::Text(input.group_id.clone()), rusqlite::types::Value::Text(now())];
    for id in &input.ids {
        vals.push(rusqlite::types::Value::Text(id.clone()));
    }
    conn.execute(&sql, rusqlite::params_from_iter(vals.iter()))
        .map_err(es)?;
    Ok(())
}

// ---------------------------------------------------------------- tags

pub fn list_tags_inner(dir: &Path) -> Result<Vec<TagCount>, String> {
    let conn = store::open(dir)?;
    let mut stmt = conn
        .prepare(
            "SELECT t.name, COUNT(ct.card_id) FROM tags t
             LEFT JOIN card_tags ct ON ct.tag_id = t.id
             GROUP BY t.id ORDER BY COUNT(ct.card_id) DESC, t.name ASC",
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

// ---------------------------------------------------------------- commands (thin wrappers)

#[tauri::command]
pub fn list_cards(state: tauri::State<'_, crate::AppState>, filter: ListFilter) -> Result<Vec<CardSummary>, String> {
    list_cards_inner(&state.dir, &filter)
}

#[tauri::command]
pub fn get_card(state: tauri::State<'_, crate::AppState>, id: String) -> Result<CardDetail, String> {
    get_card_inner(&state.dir, &id)
}

#[tauri::command]
pub fn create_card(state: tauri::State<'_, crate::AppState>, input: NewCardInput) -> Result<CardDetail, String> {
    create_card_inner(&state.dir, input)
}

#[tauri::command]
pub fn update_card(state: tauri::State<'_, crate::AppState>, input: UpdateCardInput) -> Result<(), String> {
    update_card_inner(&state.dir, input)
}

#[tauri::command]
pub fn delete_card(state: tauri::State<'_, crate::AppState>, id: String) -> Result<(), String> {
    delete_card_inner(&state.dir, &id)
}

#[tauri::command]
pub fn add_card_image(state: tauri::State<'_, crate::AppState>, card: String, path: String) -> Result<ImageInfo, String> {
    add_card_image_inner(&state.dir, &card, &path)
}

#[tauri::command]
pub fn delete_card_image(state: tauri::State<'_, crate::AppState>, id: String) -> Result<(), String> {
    delete_card_image_inner(&state.dir, &id)
}

#[tauri::command]
pub fn set_cover(state: tauri::State<'_, crate::AppState>, id: String) -> Result<(), String> {
    set_cover_inner(&state.dir, &id)
}

#[tauri::command]
pub fn list_tags(state: tauri::State<'_, crate::AppState>) -> Result<Vec<TagCount>, String> {
    list_tags_inner(&state.dir)
}

#[tauri::command]
pub fn list_groups(state: tauri::State<'_, crate::AppState>) -> Result<Vec<GroupInfo>, String> {
    list_groups_inner(&state.dir)
}

#[tauri::command]
pub fn create_group(state: tauri::State<'_, crate::AppState>, input: NewGroupInput) -> Result<GroupInfo, String> {
    create_group_inner(&state.dir, input)
}

#[tauri::command]
pub fn rename_group(state: tauri::State<'_, crate::AppState>, input: RenameGroupInput) -> Result<(), String> {
    rename_group_inner(&state.dir, input)
}

#[tauri::command]
pub fn delete_group(state: tauri::State<'_, crate::AppState>, id: String) -> Result<(), String> {
    delete_group_inner(&state.dir, &id)
}

#[tauri::command]
pub fn move_cards(state: tauri::State<'_, crate::AppState>, input: MoveCardsInput) -> Result<(), String> {
    move_cards_inner(&state.dir, input)
}
