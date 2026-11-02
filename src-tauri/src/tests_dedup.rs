use crate::cards::create_card_inner;
use crate::dedup::{civitai_key, find_inner, text_fingerprint};
use crate::models::DuplicateCheckInput;
use crate::store;
use std::path::Path;

fn lib_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("promptshelf-dedup-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("images")).expect("dir");
    dir
}

fn card_prompt(dir: &Path, prompt: &str, source_key: Option<String>) -> String {
    let detail = create_card_inner(
        dir,
        crate::models::NewCardInput {
            prompt: prompt.into(),
            negative_prompt: String::new(),
            note: String::new(),
            rating: 0,
            tags: vec![],
            images: vec![],
            loras: vec![],
            group_id: None,
            author: None,
            checkpoint: None,
            meta: vec![],
            source_key,
        },
    )
    .expect("create");
    detail.id
}

#[test]
fn fingerprint_is_normalized() {
    let base = "masterpiece, best quality  <lora:Detail:1.0>";
    assert_eq!(
        text_fingerprint(base),
        text_fingerprint("  MASTERPIECE,\n    best quality  <lora:Detail:1.0>  ")
    );
    // decomposed vs composed accents normalize to the same hash
    assert_eq!(text_fingerprint("café"), text_fingerprint("cafe\u{301}"));
    // empty and whitespace-only collapse to the same fingerprint
    assert_eq!(text_fingerprint(""), text_fingerprint("   \n\t "));
}

#[test]
fn finds_duplicates_by_text_hash() {
    let dir = lib_dir("thread");
    card_prompt(&dir, "a cat in space", None);
    card_prompt(&dir, "a completely different prompt", None);

    let hits = find_inner(
        &dir,
        &DuplicateCheckInput { prompt: Some("A  CAT\nin SPACE".into()), source_key: None },
    )
    .expect("check");
    assert_eq!(hits.len(), 1);

    let misses = find_inner(
        &dir,
        &DuplicateCheckInput { prompt: Some("another thing entirely".into()), source_key: None },
    )
    .expect("check");
    assert!(misses.is_empty());

    // empty prompt opts out of the text layer
    let empty = find_inner(
        &dir,
        &DuplicateCheckInput { prompt: Some("   ".into()), source_key: None },
    )
    .expect("check");
    assert!(empty.is_empty());
}

#[test]
fn finds_duplicates_by_source_key_even_when_text_changes() {
    let dir = lib_dir("source");
    card_prompt(&dir, "original prompt text", Some(civitai_key("images", "146266112")));

    // same link, retyped prompt with some edited words — a false negative for
    // the text layer, but the origin key layer still catches it
    let hits = find_inner(
        &dir,
        &DuplicateCheckInput {
            prompt: Some("good=thing".into()),
            source_key: Some(civitai_key("images", "146266112"))
        },
    )
    .expect("check");
    assert_eq!(hits.len(), 1);

    // a different image id does not hit
    let none = find_inner(
        &dir,
        &DuplicateCheckInput { prompt: None, source_key: Some(civitai_key("posts", "31782254")) },
    )
    .expect("check");
    assert!(none.is_empty());
}

#[test]
fn backfill_sets_text_hash_and_source_key_from_meta() {
    let dir = lib_dir("backfill");
    let conn = store::open(&dir).unwrap();

    // a "pre-dedup" library: plain cards and a CivitAI import with meta rows
    let ts = "2026-01-01T00:00:00Z".to_string();
    conn.execute(
        "INSERT INTO cards(id, prompt, created_at, updated_at, meta_json) VALUES(?1,?2,?3,?3,'[]')",
        rusqlite::params!["11111111-1111-1111-1111-111111111111", "Space Cat Masterpiece", ts],
    )
    .unwrap();
    let meta = serde_json::json!([
        {"k": "id", "v": "146266112"},
        {"k": "Seed", "v": "42"}
    ]);
    conn.execute(
        "INSERT INTO cards(id, prompt, created_at, updated_at, meta_json) VALUES(?1,?2,?3,?3,?4)",
        rusqlite::params![
            "22222222-2222-2222-2222-222222222222",
            "Space Cat Masterpiece",
            ts,
            serde_json::to_string(&meta).unwrap()
        ],
    )
    .unwrap();

    // rewind the backfill flag and let the schema init replay the migration
    conn.execute("DELETE FROM settings WHERE key = 'dup_backfill_v1'", []).unwrap();
    store::init_schema(&conn).unwrap();

    let source: Option<String> = conn
        .query_row(
            "SELECT source_key FROM cards WHERE id = '22222222-2222-2222-2222-222222222222'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(source.as_deref(), Some("civitai:images:146266112"));

    let plain_source: Option<String> = conn
        .query_row(
            "SELECT source_key FROM cards WHERE id = '11111111-1111-1111-1111-111111111111'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(plain_source.is_none());

    for id in ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"] {
        let hash: Option<String> = conn
            .query_row("SELECT text_hash FROM cards WHERE id = ?1", rusqlite::params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(hash.as_deref(), Some(text_fingerprint("Space Cat Masterpiece").as_str()));
    }

    // a second init is a no-op — the flag is set, nothing rescans or overwrites
    store::init_schema(&conn).unwrap();
}
