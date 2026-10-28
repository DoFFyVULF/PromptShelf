use crate::cards::{
    create_card_inner, delete_card_image_inner, delete_card_inner, get_card_inner, list_cards_inner,
    list_tags_inner, update_card_inner
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
        min_rating: 0,
        sort: Some("newest".to_string()),
        group_id: None,
    }
}

#[test]
fn test_card_crud_cover_and_loras() {
    let dir = tmp_dir("crud");
    let src = dir.join("in.png");
    make_test_png(&src, 1600, 900);

    let input = NewCardInput {
        prompt: "a woman with a vintage aesthetic".to_string(),
        note: "v2 works better".to_string(),
        rating: 4,
        tags: vec!["portrait".to_string(), "film".to_string()],
        images: vec![src.to_string_lossy().into_owned()],
        loras: vec![Lora {
            name: "add_detail_xl".to_string(),
            value: "0.7".to_string(),
        }],
        group_id: None,
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
            note: String::new(),
            rating: 5,
            tags: vec!["only-one".to_string()],
            loras: vec![
                Lora {
                    name: "x2".to_string(),
                    value: "1.2".to_string(),
                },
                Lora {
                    name: "X2".to_string(),
                    value: "0.5".to_string(),
                },
            ],
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
            note: String::new(),
            rating: 0,
            tags: vec![],
            images: vec![],
            group_id: None,
            loras: vec![],
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
    };
    use crate::models::{MoveCardsInput, NewGroupInput, RenameGroupInput};

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
            note: String::new(),
            rating: 0,
            tags: vec![],
            images: vec![],
            loras: vec![],
            group_id: None,
        },
    )
    .unwrap();
    assert_eq!(detail.group_id, default_id);

    // create, rename, move
    let g = create_group_inner(&dir, NewGroupInput { name: "  Anime  ".to_string() }).unwrap();
    assert_eq!(g.name, "Anime");

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
