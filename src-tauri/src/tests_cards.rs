use crate::cards::{
    create_card_inner, delete_card_image_inner, delete_card_inner, get_card_inner, list_cards_inner,
    list_tags_inner, set_card_pinned_inner, update_card_inner
};
use crate::images::process_into;
use crate::images::ImportSettings;
use crate::models::{ListFilter, Lora, NewCardInput, UpdateCardInput};
use image::ImageReader;

fn tmp_dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("promptshelf-cards-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(d.join("images")).unwrap();
    std::fs::create_dir_all(d.join("images").join("originals")).unwrap();
    d
}

fn make_test_png(path: &std::path::Path, w: u32, h: u32) {
    let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(w, h, |x, y| {
        image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8])
    }));
    img.save_with_format(path, image::ImageFormat::Png).unwrap();
}

fn no_filter() -> ListFilter {
    ListFilter {
        q: None,
        tags: vec![],
        match_all_tags: false,
        min_rating: 0,
        sort: Some("newest".to_string()),
        group_id: None,
    }
}

#[test]
fn test_any_and_all_tag_filters_on_both_shelves() {
    for lora in [false, true] {
        let dir = tmp_dir(if lora { "lora-tag-match" } else { "card-tag-match" });
        let conn = crate::store::open(&dir).unwrap();
        crate::store::init_schema(&conn).unwrap();
        let (table, tag_table, links, id_column, text_column) = if lora {
            ("loras", "lora_tags", "lora_card_tags", "lora_id", "name")
        } else {
            ("cards", "tags", "card_tags", "card_id", "prompt")
        };
        conn.execute_batch(&format!(
            "INSERT INTO {tag_table} (id, name) VALUES (1, 'portrait'), (2, 'film'), (3, 'extra');"
        )).unwrap();
        for (id, tag_ids, group, rating) in [
            ("a", vec![1], "g1", 3),
            ("b", vec![2], "g1", 3),
            ("both", vec![1, 2], "g1", 4),
            ("extra", vec![1, 2, 3], "g2", 5),
            ("none", vec![], "g1", 0),
        ] {
            conn.execute(
                &format!("INSERT INTO {table} (id, {text_column}, created_at, updated_at, group_id, rating, source_key) VALUES (?, 'sample', '2026-11-10', '2026-11-10', ?, ?, '')"),
                rusqlite::params![id, group, rating],
            ).unwrap();
            for tag_id in tag_ids {
                conn.execute(
                    &format!("INSERT INTO {links} ({id_column}, tag_id) VALUES (?, ?)"),
                    rusqlite::params![id, tag_id],
                ).unwrap();
            }
        }
        drop(conn);

        let list_ids = |filter: &ListFilter| {
            let mut ids: Vec<String> = if lora {
                crate::loras::list_loras_inner(&dir, filter).unwrap().into_iter().map(|c| c.id).collect()
            } else {
                list_cards_inner(&dir, filter).unwrap().into_iter().map(|c| c.id).collect()
            };
            ids.sort();
            ids
        };
        for (tags, any, all) in [
            (vec!["portrait", "film"], vec!["a", "b", "both", "extra"], vec!["both", "extra"]),
            (vec!["portrait"], vec!["a", "both", "extra"], vec!["a", "both", "extra"]),
            (vec![], vec!["a", "b", "both", "extra", "none"], vec!["a", "b", "both", "extra", "none"]),
            (vec![" portrait ", "#PORTRAIT", "film"], vec!["a", "b", "both", "extra"], vec!["both", "extra"]),
            (vec!["portrait", "missing' OR 1=1 --"], vec!["a", "both", "extra"], vec![]),
        ] {
            for (match_all_tags, expected) in [(false, any), (true, all)] {
                let filter = ListFilter {
                    tags: tags.iter().map(|s| s.to_string()).collect(),
                    match_all_tags,
                    ..no_filter()
                };
                assert_eq!(list_ids(&filter), expected, "lora={lora}, all={match_all_tags}, tags={tags:?}");
            }
        }
        let filter = ListFilter {
            q: Some("sample".into()),
            tags: vec!["portrait".into(), "film".into()],
            match_all_tags: true,
            min_rating: 4,
            group_id: Some("g1".into()),
            ..no_filter()
        };
        assert_eq!(list_ids(&filter), vec!["both"]);
        std::fs::remove_dir_all(&dir).ok();
    }
}

#[test]
fn test_card_crud_cover_and_loras() {
    let dir = tmp_dir("crud");
    let src = dir.join("in.png");
    make_test_png(&src, 1600, 900);

    let input = NewCardInput {
        prompt: "a woman with a vintage aesthetic".to_string(),
        negative_prompt: String::new(),
        note: "v2 works better".to_string(),
        rating: 4,
        tags: vec!["portrait".to_string(), "film".to_string()],
        images: vec![src.to_string_lossy().into_owned()],
        loras: vec![Lora {
            name: "add_detail_xl".to_string(),
            value: "0.7".to_string(),
            url: None,
            kind: None,
        }],
        group_id: None,
        author: None,
        checkpoint: None,
        meta: vec![],
        source_key: None,
        variants: vec![],
        allow_empty_prompt: false,
    };

    let detail = create_card_inner(&dir, input).unwrap();
    assert_eq!(detail.images.len(), 1);
    assert_eq!(detail.tags, vec!["film", "portrait"]);
    assert_eq!(detail.loras.len(), 1);
    assert_eq!(detail.loras[0].name, "add_detail_xl");
    assert_eq!(detail.loras[0].value, "0.7");

    // REGRESSION: list_cards used to read card columns as cover image columns.
    let list = list_cards_inner(&dir, &no_filter()).unwrap();
    assert_eq!(list.len(), 1);
    let summary = &list[0];
    assert_eq!(summary.id, detail.id);
    assert_eq!(summary.image_count, 1);
    assert_eq!(summary.variant_count, 0);
    assert_eq!(summary.tags, vec!["film", "portrait"]);
    let cover = summary.cover.as_ref().expect("cover must be present");
    assert_eq!((cover.width, cover.height), (1200, 675));
    assert!(cover.file.contains("images/"), "cover.file = {}", cover.file);
    assert!(cover.thumb.ends_with(".t.webp"));

    // get_card round-trip
    let fresh = get_card_inner(&dir, &detail.id).unwrap();
    assert_eq!(fresh.prompt, "a woman with a vintage aesthetic");
    assert_eq!(fresh.images.len(), 1);
    assert_eq!(fresh.loras.len(), 1);

    // search by prompt / note / lora name / tag
    for q in ["vintage", "works better", "add_detail_xl", "film"] {
        let found = list_cards_inner(
            &dir,
            &ListFilter {
                q: Some(q.to_string()),
                tags: vec![],
                match_all_tags: false,
                min_rating: 0,
                sort: None,
        group_id: None,
            },
        )
        .unwrap();
        assert_eq!(found.len(), 1, "search by {q}");
    }

    // tag filter
    let by_tag = list_cards_inner(
        &dir,
        &ListFilter {
            q: None,
            tags: vec!["portrait".to_string()],
            match_all_tags: false,
            min_rating: 0,
            sort: None,
        group_id: None,
        },
    )
    .unwrap();
    assert_eq!(by_tag.len(), 1);

    // update with lora dedup (same name twice)
    update_card_inner(
        &dir,
        UpdateCardInput {
            id: detail.id.clone(),
            prompt: "updated prompt".to_string(),
            negative_prompt: String::new(),
            note: String::new(),
            rating: 5,
            tags: vec!["only-one".to_string()],
            loras: vec![
                Lora {
                    name: "x2".to_string(),
                    value: "1.2".to_string(),
                    url: None,
                    kind: None,
                },
                Lora {
                    name: "X2".to_string(),
                    value: "0.5".to_string(),
                    url: None,
                    kind: None,
                },
            ],
            author: Some("  SomeAuthor  ".to_string()),
            checkpoint: None,
            meta: vec![crate::models::MetaItem { k: "Seed".to_string(), v: "42".to_string() }],
            variants: vec![],
        },
    )
    .unwrap();
    let updated = get_card_inner(&dir, &detail.id).unwrap();
    assert_eq!(updated.prompt, "updated prompt");
    assert_eq!(updated.loras.len(), 1, "duplicate lora names must dedupe");
    assert_eq!(updated.loras[0].value, "1.2");
    assert_eq!(updated.tags, vec!["only-one"]);

    // orphan tag cleanup: old tags gone
    let tags = list_tags_inner(&dir).unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].name, "only-one");

    // delete image, then card
    delete_card_image_inner(&dir, &detail.images[0].id).unwrap();
    let after = get_card_inner(&dir, &detail.id).unwrap();
    assert!(after.images.is_empty());
    let list_after = list_cards_inner(&dir, &no_filter()).unwrap();
    assert!(list_after[0].cover.is_none());

    delete_card_inner(&dir, &detail.id).unwrap();
    assert!(get_card_inner(&dir, &detail.id).is_err());
    assert!(list_tags_inner(&dir).unwrap().is_empty());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_loras_column_migration_on_old_db() {
    let dir = tmp_dir("migrate");
    {
        let conn = rusqlite::Connection::open(dir.join("library.db")).unwrap();
        // v1 schema without the loras column
        conn.execute_batch(
            "CREATE TABLE cards (
                id TEXT PRIMARY KEY,
                prompt TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                rating INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                cover_image_id TEXT
            );",
        )
        .unwrap();
    }
    {
        let conn = crate::store::open(&dir).unwrap();
        crate::store::init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO cards(id, prompt, created_at, updated_at, loras)
             VALUES('x', 'p', 't', 't', '[{\"name\":\"a\",\"value\":\"1\"}]')",
            [],
        )
        .unwrap();
        let l: String = conn
            .query_row("SELECT loras FROM cards WHERE id = 'x'", [], |r| r.get(0))
            .unwrap();
        assert!(l.contains("\"a\""));
    }
    // get_card parses loras from the migrated column
    let card = get_card_inner(&dir, "x").unwrap();
    assert_eq!(card.loras.len(), 1);
    assert_eq!(card.loras[0].name, "a");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_add_image_sets_cover_and_sort() {    let dir = tmp_dir("addimg");
    let src = dir.join("in.png");
    make_test_png(&src, 900, 900);

    let detail = create_card_inner(
        &dir,
        NewCardInput {
            prompt: "p".to_string(),
            negative_prompt: String::new(),
            note: String::new(),
            rating: 0,
            tags: vec![],
            images: vec![],
            group_id: None,
            loras: vec![],
            author: None,
            checkpoint: None,
            meta: vec![],
            source_key: None,
            variants: vec![],
            allow_empty_prompt: false,
        },
    )
    .unwrap();
    assert!(detail.images.is_empty());

    let settings = ImportSettings {
        max_side: 1200,
        quality: 75,
        format: "jpeg".to_string(),
        originals: false,
        thumbs: true,
    };
    let tmp1 = dir.join("tmp-a.png");
    let tmp2 = dir.join("tmp-b.png");
    std::fs::copy(&src, &tmp1).unwrap();
    std::fs::copy(&src, &tmp2).unwrap();

    let img1 = crate::cards::add_card_image_inner(&dir, &detail.id, &tmp1.to_string_lossy()).unwrap();
    let img2 = crate::cards::add_card_image_inner(&dir, &detail.id, &tmp2.to_string_lossy()).unwrap();

    let fresh = get_card_inner(&dir, &detail.id).unwrap();
    assert_eq!(fresh.images.len(), 2);
    // cover falls back to the first image by sort
    let list = list_cards_inner(&dir, &no_filter()).unwrap();
    assert_eq!(list[0].cover.as_ref().unwrap().id, img1.id);
    assert_ne!(img1.id, img2.id);

    // process_into sanity through the same helper the commands use
    let out = process_into(&src, &dir, &settings).unwrap();
    let decoded = ImageReader::open(dir.join(&out.file)).unwrap().decode().unwrap();
    assert_eq!(decoded.width(), 900); // no upscale

    delete_card_inner(&dir, &detail.id).unwrap();
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_groups_crud_move_and_default() {
    use crate::cards::{
        create_group_inner, delete_group_inner, list_groups_inner, move_cards_inner, rename_group_inner,
        set_group_style_inner,
    };
    use crate::models::{GroupStyleInput, MoveCardsInput, NewGroupInput, RenameGroupInput};

    let dir = tmp_dir("groups");

    // default group is seeded automatically
    let groups = list_groups_inner(&dir).unwrap();
    assert_eq!(groups.len(), 1);
    assert!(groups[0].is_default);
    assert!(!groups[0].name.is_empty());
    let default_id = groups[0].id.clone();

    // a card created without an explicit group lands in the default one
    let detail = create_card_inner(
        &dir,
        NewCardInput {
            prompt: "in default".to_string(),
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
            source_key: None,
            variants: vec![],
            allow_empty_prompt: false,
        },
    )
    .unwrap();
    assert_eq!(detail.group_id, default_id);

    // create, rename, move
    let g = create_group_inner(
        &dir,
        NewGroupInput {
            name: "  Anime  ".to_string(),
            color: "violet".to_string(),
            icon: "sparkles".to_string(),
        },
    )
    .unwrap();
    assert_eq!(g.name, "Anime");
    assert_eq!(g.color, "violet");
    assert_eq!(g.icon, "sparkles");
    assert_eq!(list_groups_inner(&dir).unwrap().iter().find(|x| x.id == g.id).unwrap().icon, "sparkles");

    // appearance is a separate, partial-safe edit
    set_group_style_inner(
        &dir,
        GroupStyleInput {
            id: g.id.clone(),
            color: "rose".to_string(),
            icon: String::new(),
        },
    )
    .unwrap();
    let styled = list_groups_inner(&dir).unwrap().into_iter().find(|x| x.id == g.id).unwrap();
    assert_eq!(styled.color, "rose");
    assert_eq!(styled.icon, "");

    move_cards_inner(
        &dir,
        MoveCardsInput {
            ids: vec![detail.id.clone()],
            group_id: g.id.clone(),
        },
    )
    .unwrap();
    let moved = get_card_inner(&dir, &detail.id).unwrap();
    assert_eq!(moved.group_id, g.id);

    let groups = list_groups_inner(&dir).unwrap();
    assert_eq!(groups.len(), 2);
    let anime = groups.iter().find(|x| x.id == g.id).unwrap();
    assert_eq!(anime.count, 1);
    let home = groups.iter().find(|x| x.is_default).unwrap();
    assert_eq!(home.count, 0);

    // list filtered by group
    let by_group = list_cards_inner(
        &dir,
        &ListFilter {
            q: None,
            tags: vec![],
            match_all_tags: false,
            min_rating: 0,
            sort: None,
            group_id: Some(g.id.clone()),
        },
    )
    .unwrap();
    assert_eq!(by_group.len(), 1);
    assert_eq!(by_group[0].group_id, g.id);

    rename_group_inner(&dir, RenameGroupInput { id: g.id.clone(), name: "Style".to_string() }).unwrap();
    let groups = list_groups_inner(&dir).unwrap();
    assert_eq!(groups.iter().find(|x| x.id == g.id).unwrap().name, "Style");

    // deleting the group moves its cards back to the default one
    delete_group_inner(&dir, &g.id).unwrap();
    assert!(get_card_inner(&dir, &detail.id).is_ok());
    let back = get_card_inner(&dir, &detail.id).unwrap();
    assert_eq!(back.group_id, default_id);
    assert_eq!(list_groups_inner(&dir).unwrap().len(), 1);

    // the default group cannot be deleted
    assert!(delete_group_inner(&dir, &default_id).is_err());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_group_names_count_characters_and_moves_keep_updated_at() {
    use crate::cards::{
        create_card_inner, create_group_inner, get_card_inner, move_cards_inner,
    };
    use crate::models::{MoveCardsInput, NewCardInput, NewGroupInput};

    let dir = tmp_dir("groups-unicode-move");
    let card = create_card_inner(
        &dir,
        NewCardInput {
            prompt: "stays in place".to_string(),
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
            source_key: None,
            variants: vec![],
            allow_empty_prompt: false,
        },
    )
    .unwrap();

    // 44 characters but 88 bytes: the old byte-based check rejected it
    let name = "Очень длинное название группы для проверки";
    assert!(name.chars().count() > 24);
    assert!(name.len() > 48);
    let group = create_group_inner(&dir, NewGroupInput { name: name.to_string(), color: String::new(), icon: String::new() }).unwrap();
    assert_eq!(group.name, name);

    // moving between groups is organization, not an edit
    {
        let conn = crate::store::open(&dir).unwrap();
        conn.execute(
            "UPDATE cards SET updated_at = '2020-01-01T00:00:00+00:00' WHERE id = ?1",
            rusqlite::params![card.id],
        )
        .unwrap();
    }
    move_cards_inner(
        &dir,
        MoveCardsInput {
            ids: vec![card.id.clone()],
            group_id: group.id.clone(),
        },
    )
    .unwrap();
    let moved = get_card_inner(&dir, &card.id).unwrap();
    assert_eq!(moved.group_id, group.id);
    assert_eq!(moved.updated_at, "2020-01-01T00:00:00+00:00");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_group_names_are_unique() {
    use crate::cards::{create_group_inner, rename_group_inner};
    use crate::models::{NewGroupInput, RenameGroupInput};

    let dir = tmp_dir("groups-unique");
    let first = create_group_inner(&dir, NewGroupInput { name: "Ideas".to_string(), color: String::new(), icon: String::new() }).unwrap();
    // case-insensitive match is still a duplicate
    let err = create_group_inner(&dir, NewGroupInput { name: "  ideas  ".to_string(), color: String::new(), icon: String::new() }).err();
    assert_eq!(err.as_deref(), Some("GROUP_NAME_EXISTS"));
    // renaming into somebody else's name fails too; a no-op rename is fine
    let second = create_group_inner(&dir, NewGroupInput { name: "Archive".to_string(), color: String::new(), icon: String::new() }).unwrap();
    let err = rename_group_inner(
        &dir,
        RenameGroupInput { id: second.id.clone(), name: "IDEAS".to_string() },
    )
    .unwrap_err();
    assert_eq!(err, "GROUP_NAME_EXISTS");
    rename_group_inner(
        &dir,
        RenameGroupInput { id: first.id, name: "Ideas".to_string() },
    )
    .unwrap();

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_prompt_variants_roundtrip_and_search() {
    let dir = tmp_dir("variants");
    let detail = create_card_inner(
        &dir,
        NewCardInput {
            prompt: "main prompt".to_string(),
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
            source_key: None,
            variants: vec![
                "variant one  ".to_string(),
                String::new(), // dropped: empty
                "variant two".to_string(),
            ],
            allow_empty_prompt: false,
        },
    )
    .unwrap();
    // creation trims and drops empties, order preserved
    let card = get_card_inner(&dir, &detail.id).unwrap();
    assert_eq!(card.variants, vec!["variant one", "variant two"]);
    assert_eq!(list_cards_inner(&dir, &no_filter()).unwrap()[0].variant_count, 2);

    // search finds text inside a variant
    let found = list_cards_inner(
        &dir,
        &ListFilter {
            q: Some("variant two".to_string()),
            tags: vec![],
            match_all_tags: false,
            min_rating: 0,
            sort: None,
            group_id: None,
        },
    )
    .unwrap();
    assert_eq!(found.len(), 1);

    // edit variants wholesale; the main prompt stays untouched
    update_card_inner(
        &dir,
        UpdateCardInput {
            id: detail.id.clone(),
            prompt: "main prompt".to_string(),
            negative_prompt: String::new(),
            note: String::new(),
            rating: 0,
            tags: vec![],
            loras: vec![],
            author: None,
            checkpoint: None,
            meta: vec![],
            variants: vec!["rewritten variant".to_string()],
        },
    )
    .unwrap();
    let updated = get_card_inner(&dir, &detail.id).unwrap();
    assert_eq!(updated.prompt, "main prompt");
    assert_eq!(updated.variants, vec!["rewritten variant"]);
    assert_eq!(list_cards_inner(&dir, &no_filter()).unwrap()[0].variant_count, 1);

    // oversized variants (>8000 chars) are dropped on write
    let too_long = "x".repeat(8001);
    update_card_inner(
        &dir,
        UpdateCardInput {
            id: detail.id.clone(),
            prompt: "main prompt".to_string(),
            negative_prompt: String::new(),
            note: String::new(),
            rating: 0,
            tags: vec![],
            loras: vec![],
            author: None,
            checkpoint: None,
            meta: vec![],
            variants: vec![too_long, "kept".to_string()],
        },
    )
    .unwrap();
    let clamped = get_card_inner(&dir, &detail.id).unwrap();
    assert_eq!(clamped.variants, vec!["kept"]);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_old_db_gets_groups_and_backfill() {
    let dir = tmp_dir("groups-migrate");
    {
        let conn = rusqlite::Connection::open(dir.join("library.db")).unwrap();
        // v1 cards table without group_id, no groups table
        conn.execute_batch(
            "CREATE TABLE cards (
                id TEXT PRIMARY KEY,
                prompt TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                rating INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                cover_image_id TEXT,
                loras TEXT NOT NULL DEFAULT '[]'
            );
            INSERT INTO cards(id, prompt, created_at, updated_at) VALUES('c1', 'p', 't', 't');",
        )
        .unwrap();
    }
    // opening the library migrates: groups table, group_id column, default group, backfill
    let groups = crate::cards::list_groups_inner(&dir).unwrap();
    assert_eq!(groups.len(), 1);
    let card = get_card_inner(&dir, "c1").unwrap();
    assert_eq!(card.group_id, groups[0].id);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn promptless_imports_are_real_cards_and_stay_editable() {
    let dir = tmp_dir("no-prompt");
    let make = |allow: bool| NewCardInput {
        prompt: String::new(),
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
        source_key: None,
        variants: vec![],
        allow_empty_prompt: allow,
    };

    // the import flow must opt in explicitly
    assert!(matches!(create_card_inner(&dir, make(false)), Err(e) if e == "PROMPT_REQUIRED"));
    let card = create_card_inner(&dir, make(true)).unwrap();
    assert!(card.prompt.is_empty());

    // rating/tags/note edits no longer need a prompt that was never there
    update_card_inner(
        &dir,
        UpdateCardInput {
            id: card.id.clone(),
            prompt: String::new(),
            variants: vec![],
            negative_prompt: String::new(),
            note: "reference shot".to_string(),
            rating: 5,
            tags: vec!["reference".to_string()],
            loras: vec![],
            author: None,
            checkpoint: None,
            meta: vec![],
        },
    )
    .unwrap();
    let fresh = get_card_inner(&dir, &card.id).unwrap();
    assert_eq!(fresh.rating, 5);
    assert_eq!(fresh.note.as_deref(), Some("reference shot"));

    // a card that has a prompt still can't be saved with it cleared
    let prompted = create_card_inner(
        &dir,
        NewCardInput {
            prompt: "a real prompt".to_string(),
            ..make(true)
        },
    )
    .unwrap();
    assert!(matches!(
        update_card_inner(
            &dir,
            UpdateCardInput {
                id: prompted.id.clone(),
                prompt: String::new(),
                variants: vec![],
                negative_prompt: String::new(),
                note: String::new(),
                rating: 0,
                tags: vec![],
                loras: vec![],
                author: None,
                checkpoint: None,
                meta: vec![],
            },
        ),
        Err(e) if e == "PROMPT_REQUIRED"
    ));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_pinned_rows_sort_first_on_both_shelves() {
    let dir = tmp_dir("pinned-sort");
    let conn = crate::store::open(&dir).unwrap();
    crate::store::init_schema(&conn).unwrap();
    conn.execute_batch(
        "INSERT INTO cards (id, prompt, created_at, updated_at, group_id) VALUES
            ('c-old', 'old', '2026-01-01', '2026-01-01', 'g'),
            ('c-new', 'new', '2026-02-01', '2026-02-01', 'g'),
            ('c-mid', 'mid', '2026-01-15', '2026-01-15', 'g');
         INSERT INTO loras (id, name, created_at, updated_at, group_id) VALUES
            ('l-old', 'old', '2026-01-01', '2026-01-01', 'g'),
            ('l-new', 'new', '2026-02-01', '2026-02-01', 'g'),
            ('l-mid', 'mid', '2026-01-15', '2026-01-15', 'g');",
    )
    .unwrap();
    drop(conn);

    let ids = |sort: &str| -> (Vec<String>, Vec<String>) {
        let mut filter = no_filter();
        filter.sort = Some(sort.to_string());
        let cards = list_cards_inner(&dir, &filter)
            .unwrap()
            .into_iter()
            .map(|c| c.id)
            .collect();
        let loras = crate::loras::list_loras_inner(&dir, &filter)
            .unwrap()
            .into_iter()
            .map(|l| l.id)
            .collect();
        (cards, loras)
    };

    // unpinned rows follow the shelf order
    assert_eq!(ids("newest").0, vec!["c-new", "c-mid", "c-old"]);
    assert_eq!(ids("oldest").0, vec!["c-old", "c-mid", "c-new"]);

    set_card_pinned_inner(&dir, "c-old", true).unwrap();
    crate::loras::set_lora_pinned_inner(&dir, "l-old", true).unwrap();

    // pinned wins over every sort order, on both shelves
    for sort in ["newest", "oldest", "rating"] {
        let (cards, loras) = ids(sort);
        assert_eq!(cards.first().map(String::as_str), Some("c-old"), "cards/{sort}");
        assert_eq!(loras.first().map(String::as_str), Some("l-old"), "loras/{sort}");
    }

    let mut filter = no_filter();
    filter.sort = None;
    assert!(list_cards_inner(&dir, &filter).unwrap()[0].pinned);
    assert!(crate::loras::list_loras_inner(&dir, &filter).unwrap()[0].pinned);

    // unpinning restores the natural order
    set_card_pinned_inner(&dir, "c-old", false).unwrap();
    crate::loras::set_lora_pinned_inner(&dir, "l-old", false).unwrap();
    assert_eq!(ids("newest").0, vec!["c-new", "c-mid", "c-old"]);
    assert_eq!(ids("newest").1, vec!["l-new", "l-mid", "l-old"]);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_pinned_column_migrates_old_libraries() {
    let dir = tmp_dir("pinned-migrate");
    {
        // a pre-pin library: both tables exist, neither knows the column
        let conn = rusqlite::Connection::open(dir.join("library.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE cards (
                id TEXT PRIMARY KEY, prompt TEXT NOT NULL DEFAULT '',
                negative_prompt TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
                rating INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL, cover_image_id TEXT,
                loras TEXT NOT NULL DEFAULT '[]', variants_json TEXT NOT NULL DEFAULT '[]',
                group_id TEXT, author TEXT, checkpoint TEXT,
                meta_json TEXT NOT NULL DEFAULT '[]', source_key TEXT, text_hash TEXT
             );
             CREATE TABLE loras (
                id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
                base_model TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL DEFAULT '',
                usage_tips TEXT NOT NULL DEFAULT '[]',
                trigger_words TEXT NOT NULL DEFAULT '[]',
                description TEXT NOT NULL DEFAULT '', primary_tag TEXT,
                note TEXT NOT NULL DEFAULT '', rating INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, group_id TEXT,
                cover_image_id TEXT, source_key TEXT, text_hash TEXT
             );",
        )
        .unwrap();
    }

    // open() runs the migration
    let conn = crate::store::open(&dir).unwrap();
    conn.execute(
        "INSERT INTO cards (id, created_at, updated_at) VALUES ('c', 't', 't')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO loras (id, created_at, updated_at) VALUES ('l', 't', 't')",
        [],
    )
    .unwrap();
    let card_pinned: i64 = conn
        .query_row("SELECT pinned FROM cards WHERE id = 'c'", [], |r| r.get(0))
        .unwrap();
    let lora_pinned: i64 = conn
        .query_row("SELECT pinned FROM loras WHERE id = 'l'", [], |r| r.get(0))
        .unwrap();
    assert_eq!((card_pinned, lora_pinned), (0, 0));
    std::fs::remove_dir_all(&dir).ok();
}
