use crate::images::{preview_data_url, process_into, ImportSettings};
use image::ImageReader;

fn tmp_dir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("promptshelf-test-{name}-{}", uuid::Uuid::new_v4()));
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

#[test]
fn test_downscale_jpeg() {
    let dir = tmp_dir("jpeg");
    let src = dir.join("in.png");
    make_test_png(&src, 2000, 1000);

    let settings = ImportSettings {
        max_side: 1200,
        quality: 75,
        format: "jpeg".to_string(),
        originals: false,
        thumbs: true,
    };
    let out = process_into(&src, &dir, &settings).unwrap();

    assert_eq!((out.width, out.height), (1200, 600));
    assert!(out.file.ends_with(".jpg"));
    assert!(out.thumb.ends_with(".t.webp"));
    let full = std::fs::read(dir.join(&out.file)).unwrap();
    let thumb = std::fs::read(dir.join(&out.thumb)).unwrap();
    assert!(full.len() < 900_000, "jpeg too big: {}", full.len());
    assert!(thumb.len() > 0);
    // decoded dims match
    let decoded = ImageReader::open(dir.join(&out.file)).unwrap().decode().unwrap();
    assert_eq!((decoded.width(), decoded.height()), (1200, 600));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_downscale_webp_and_no_upscale() {
    let dir = tmp_dir("webp");
    let src = dir.join("in.png");
    make_test_png(&src, 800, 600);

    let settings = ImportSettings {
        max_side: 1200,
        quality: 80,
        format: "webp".to_string(),
        originals: true,
        thumbs: true,
    };
    let out = process_into(&src, &dir, &settings).unwrap();

    // small source must not be upscaled
    assert_eq!((out.width, out.height), (800, 600));
    assert!(out.file.ends_with(".webp"));
    assert!(out.original.is_some());
    let orig_path = dir.join(out.original.unwrap());
    assert!(orig_path.exists());
    let full = std::fs::read(dir.join(&out.file)).unwrap();
    assert!(full.len() < 400_000, "webp too big: {}", full.len());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_exif_orientation_rotates() {
    // Build a JPEG with EXIF orientation 6 (rotate 90 CW required).
    let dir = tmp_dir("exif");
    let src = dir.join("rot.jpg");
    // 2x3 image (portrait); with orientation 6 the true content is 3x2 landscape.
    let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(2, 3, |x, y| {
        image::Rgb([255 * x as u8, 90 * y as u8, 40])
    }));
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img.to_rgb8())
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .unwrap();

    // Build a minimal EXIF segment with orientation = 6
    let mut exif_data: Vec<u8> = vec![
        0x4D, 0x4D, 0x00, 0x2A, // "MM", 42 (big-endian TIFF)
        0x00, 0x00, 0x00, 0x08, // offset to first IFD
        0x00, 0x01, // 1 entry
        0x01, 0x12, // tag: Orientation (0x0112)
        0x00, 0x03, // type: SHORT
        0x00, 0x00, 0x00, 0x01, // count: 1
        0x00, 0x06, 0x00, 0x00, // value: 6
        0x00, 0x00, 0x00, 0x00, // next IFD: none
    ];
    let jpeg = buf.into_inner();
    let mut out_file: Vec<u8> = vec![0xFF, 0xD8];
    let mut seg = vec![0xFF, 0xE1, 0x00, 0x00, b'E', b'x', b'i', b'f', 0x00, 0x00];
    let seg_len = exif_data.len() as u16 + 8;
    seg[2] = (seg_len >> 8) as u8;
    seg[3] = (seg_len & 0xFF) as u8;
    seg.append(&mut exif_data);
    out_file.extend_from_slice(&seg);
    out_file.extend_from_slice(&jpeg[2..]);
    std::fs::write(&src, &out_file).unwrap();

    let settings = ImportSettings {
        max_side: 1200,
        quality: 75,
        format: "jpeg".to_string(),
        originals: false,
        thumbs: true,
    };
    let out = process_into(&src, &dir, &settings).unwrap();
    // After applying orientation 6 (rotate 90 CW) the 2x3 portrait becomes 3x2 landscape.
    assert_eq!((out.width, out.height), (3, 2), "orientation was not applied");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_preview_data_url() {
    let dir = tmp_dir("preview");
    let src = dir.join("in.png");
    make_test_png(&src, 3000, 1500);
    let url = preview_data_url(&src).unwrap();
    assert!(url.starts_with("data:image/jpeg;base64,"));
    assert!(url.len() < 300_000, "preview too large");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn test_no_thumb_option_reuses_compressed_file() {
    let dir = tmp_dir("nothumb");
    let src = dir.join("in.png");
    make_test_png(&src, 2000, 1000);

    let settings = ImportSettings {
        max_side: 1200,
        quality: 75,
        format: "jpeg".to_string(),
        originals: false,
        thumbs: false,
    };
    let out = process_into(&src, &dir, &settings).unwrap();

    // preview == the compressed image itself: no extra file on disk
    assert_eq!(out.thumb, out.file);
    let files: Vec<_> = std::fs::read_dir(dir.join("images"))
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .collect();
    assert_eq!(files.len(), 1, "exactly one file must be stored");
    assert!(dir.join(&out.file).exists());
    std::fs::remove_dir_all(&dir).ok();
}
