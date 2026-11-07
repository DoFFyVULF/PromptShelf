use crate::store;
use crate::util::{inspect_library_dir, move_library_blocking, read_manifest_dir};
use rusqlite::Connection;

fn tmp_dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("promptshelf-util-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(d.join("images")).unwrap();
    d
}

#[test]
fn adopts_an_existing_library_in_place() {
    let current = tmp_dir("adopt-current");
    store::open(&current).unwrap();

    let target = tmp_dir("adopt-target");
    {
        let conn = store::open(&target).unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings(key, value) VALUES('theme', 'dark')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cards (id, created_at, updated_at) VALUES ('c1', '2024-01-01', '2024-01-01')",
            [],
        )
        .unwrap();
    }
    std::fs::write(target.join("images").join("keep.png"), b"keep").unwrap();

    let info = inspect_library_dir(target.to_string_lossy().into_owned());
    assert!(info.library);
    assert_eq!(info.cards, 1);
    assert_eq!(info.loras, 0);

    let default_dir = tmp_dir("adopt-default");
    let mode = move_library_blocking(&current, &default_dir, target.to_str().unwrap()).unwrap();

    assert_eq!(mode, "adopted");
    assert_eq!(read_manifest_dir(&default_dir).unwrap(), target);
    // the user's db and files were not replaced by the current (empty) library
    assert!(target.join("images").join("keep.png").exists());
    let conn = Connection::open(target.join("library.db")).unwrap();
    let theme: String = conn
        .query_row("SELECT value FROM settings WHERE key = 'theme'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(theme, "dark");
    let cards: i64 = conn
        .query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cards, 1);
}

#[test]
fn copies_the_current_library_into_an_empty_folder() {
    let current = tmp_dir("copy-current");
    store::open(&current).unwrap();
    std::fs::write(current.join("images").join("cat.png"), b"cat").unwrap();

    let target = tmp_dir("copy-target");
    let info = inspect_library_dir(target.to_string_lossy().into_owned());
    assert!(!info.library);
    let default_dir = tmp_dir("copy-default");
    let mode = move_library_blocking(&current, &default_dir, target.to_str().unwrap()).unwrap();

    assert_eq!(mode, "copied");
    assert_eq!(read_manifest_dir(&default_dir).unwrap(), target);
    assert!(target.join("library.db").exists());
    assert_eq!(
        std::fs::read(target.join("images").join("cat.png")).unwrap(),
        b"cat"
    );
}

#[test]
fn refuses_to_overwrite_a_foreign_library_db() {
    let current = tmp_dir("invalid-current");
    store::open(&current).unwrap();

    let target = tmp_dir("invalid-target");
    std::fs::write(target.join("library.db"), b"not a database").unwrap();
    let default_dir = tmp_dir("invalid-default");

    let err = move_library_blocking(&current, &default_dir, target.to_str().unwrap()).unwrap_err();
    assert_eq!(err, "LIBRARY_INVALID");
    assert_eq!(
        std::fs::read(target.join("library.db")).unwrap(),
        b"not a database"
    );
    assert!(read_manifest_dir(&default_dir).is_none());
}
