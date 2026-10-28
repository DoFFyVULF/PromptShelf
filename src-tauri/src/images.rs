use crate::models::{es, PasteImageResult};
use base64::Engine;
use image::{DynamicImage, GenericImageView, ImageReader};
use rusqlite::Connection;
use std::io::Cursor;
use std::path::Path;

pub struct ImportSettings {
    pub max_side: u32,
    pub quality: u8,
    pub format: String,
    pub originals: bool,
    /// false → reuse the compressed image as its own preview (no `.t.webp` file).
    pub thumbs: bool,
}

pub fn import_settings(conn: &Connection) -> ImportSettings {
    let s = crate::store::read_settings(conn).unwrap_or_else(|_| crate::models::app_settings_default());
    ImportSettings {
        max_side: s.max_side,
        quality: s.quality,
        format: s.format,
        originals: s.originals,
        thumbs: s.thumbs,
    }
}

pub struct Processed {
    pub file: String,
    pub thumb: String,
    pub original: Option<String>,
    pub width: u32,
    pub height: u32,
    pub bytes: u32,
}

// ---------------------------------------------------------------- decode

fn exif_orientation(path: &Path) -> u32 {
    let Ok(file) = std::fs::File::open(path) else {
        return 1;
    };
    let mut buf = std::io::BufReader::new(file);
    let Ok(exif) = exif::Reader::new().read_from_container(&mut buf) else {
        return 1;
    };
    let Some(field) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) else {
        return 1;
    };
    field.value.get_uint(0).unwrap_or(1)
}

fn apply_orientation(img: DynamicImage, o: u32) -> DynamicImage {
    match o {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate270().fliph(),
        6 => img.rotate90(),
        7 => img.rotate90().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

fn decode_with_orientation(path: &Path) -> Result<DynamicImage, String> {
    let img = ImageReader::open(path)
        .map_err(es)?
        .with_guessed_format()
        .map_err(es)?
        .decode()
        .map_err(|e| format!("decode: {e}"))?;
    Ok(apply_orientation(img, exif_orientation(path)))
}

// ---------------------------------------------------------------- encode

fn flatten_white(img: &DynamicImage) -> image::RgbImage {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut out = image::RgbImage::new(w, h);
    for (x, y, p) in rgba.enumerate_pixels() {
        let a = p[3] as u32;
        let blend = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
        out.put_pixel(x, y, image::Rgb([blend(p[0]), blend(p[1]), blend(p[2])]));
    }
    out
}

fn encode_jpeg(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    let flat = flatten_white(img);
    let mut out = Cursor::new(Vec::new());
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
    enc.encode_image(&DynamicImage::ImageRgb8(flat))
        .map_err(es)?;
    Ok(out.into_inner())
}

fn encode_webp(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let enc = webp::Encoder::new(rgba.as_raw(), webp::PixelLayout::Rgba, w, h);
    let mem = enc.encode(quality as f32 / 100.0);
    Ok(mem.to_vec())
}

fn encode_thumb(img: &DynamicImage) -> Result<Vec<u8>, String> {
    let small = img.thumbnail(560, 560);
    encode_webp(&small, 82)
}

// ---------------------------------------------------------------- pipeline

fn rel(path: &Path, base: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Compress an image and place it into the library's images folder.
/// Returns paths relative to `data_dir`.
pub fn process_into(src: &Path, data_dir: &Path, s: &ImportSettings) -> Result<Processed, String> {
    let img = decode_with_orientation(src)?;
    let (w0, h0) = img.dimensions();

    let full = if w0.max(h0) > s.max_side {
        img.resize(s.max_side, s.max_side, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };
    let (w, h) = full.dimensions();

    let images_dir = data_dir.join("images");
    let id = uuid::Uuid::new_v4().to_string();
    let ext = if s.format == "webp" { "webp" } else { "jpg" };

    let full_bytes = match s.format.as_str() {
        "webp" => encode_webp(&full, s.quality)?,
        _ => encode_jpeg(&full, s.quality)?,
    };
    let full_path = images_dir.join(format!("{id}.{ext}"));
    std::fs::write(&full_path, &full_bytes).map_err(es)?;

    // Thumbnail: a small dedicated webp, or the compressed image itself when
    // the user opted out of storing a separate preview file.
    let thumb_rel = if s.thumbs {
        let thumb_bytes = encode_thumb(&full)?;
        let thumb_path = images_dir.join(format!("{id}.t.webp"));
        std::fs::write(&thumb_path, &thumb_bytes).map_err(es)?;
        rel(&thumb_path, data_dir)
    } else {
        rel(&full_path, data_dir)
    };

    let original = if s.originals {
        let src_ext = path_ext(src);
        let orig_path = images_dir.join("originals").join(format!("{id}{src_ext}"));
        std::fs::copy(src, &orig_path).map_err(es)?;
        Some(rel(&orig_path, data_dir))
    } else {
        None
    };

    Ok(Processed {
        file: rel(&full_path, data_dir),
        thumb: thumb_rel,
        original,
        width: w,
        height: h,
        bytes: full_bytes.len().min(u32::MAX as usize) as u32,
    })
}

fn path_ext(p: &Path) -> String {
    p.extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_else(|| ".png".to_string())
}

pub fn preview_data_url(path: &Path) -> Result<String, String> {
    let img = decode_with_orientation(path)?;
    let thumb = img.thumbnail(640, 640);
    let bytes = encode_jpeg(&thumb, 70)?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

pub fn save_temp_image_dyn(bytes: &[u8]) -> Result<PasteImageResult, String> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(es)?;
    let fmt = reader.format();
    let img = reader.decode().map_err(|e| format!("decode: {e}"))?;

    let ext = match fmt {
        Some(image::ImageFormat::Jpeg) => "jpg",
        Some(image::ImageFormat::Gif) => "gif",
        Some(image::ImageFormat::WebP) => "webp",
        Some(image::ImageFormat::Bmp) => "bmp",
        Some(image::ImageFormat::Tiff) => "tiff",
        _ => "png",
    };
    let tmp = std::env::temp_dir().join(format!("promptshelf-{}.{}", uuid::Uuid::new_v4(), ext));
    std::fs::write(&tmp, bytes).map_err(es)?;
    let preview = preview_data_url(&tmp)?;
    Ok(PasteImageResult {
        temp_path: tmp.to_string_lossy().into_owned(),
        preview,
        width: img.width(),
        height: img.height(),
    })
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn preview_image(state: tauri::State<'_, crate::AppState>, path: String) -> Result<String, String> {
    let _ = &state;
    preview_data_url(Path::new(&path))
}

#[tauri::command]
pub fn paste_image_from_clipboard(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<PasteImageResult>, String> {
    let _ = &state;
    let mut cb = arboard::Clipboard::new().map_err(es)?;
    let data = match cb.get_image() {
        Ok(i) => i,
        Err(arboard::Error::ContentNotAvailable) => return Ok(None),
        Err(e) => return Err(es(e)),
    };
    let rgba =
        image::RgbaImage::from_raw(data.width as u32, data.height as u32, data.bytes.into_owned())
            .ok_or("bad clipboard image")?;
    let img = DynamicImage::ImageRgba8(rgba);
    let tmp = std::env::temp_dir().join(format!("promptshelf-{}.png", uuid::Uuid::new_v4()));
    img.save_with_format(&tmp, image::ImageFormat::Png).map_err(es)?;
    let preview = preview_data_url(&tmp)?;
    Ok(Some(PasteImageResult {
        temp_path: tmp.to_string_lossy().into_owned(),
        preview,
        width: img.width(),
        height: img.height(),
    }))
}

#[tauri::command]
pub fn save_temp_image(state: tauri::State<'_, crate::AppState>, bytes: Vec<u8>) -> Result<Option<PasteImageResult>, String> {
    let _ = &state;
    if bytes.is_empty() {
        return Ok(None);
    }
    save_temp_image_dyn(&bytes).map(Some)
}

/// A file dropped onto the window arrives as bytes (the webview cannot hand
/// out file paths), so we stash them in a temp file that behaves like a
/// user-selected path for the rest of the import pipeline.
#[tauri::command]
pub fn import_dropped_file(
    state: tauri::State<'_, crate::AppState>,
    input: crate::models::DroppedFileInput,
) -> Result<PasteImageResult, String> {
    let _ = &state;
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(input.data.as_bytes())
        .map_err(|e| format!("decode: {e}"))?;
    if bytes.is_empty() {
        return Err("empty file".to_string());
    }
    save_temp_image_dyn(&bytes)
}

#[tauri::command]
pub fn discard_temp(state: tauri::State<'_, crate::AppState>, path: String) -> Result<(), String> {
    let _ = &state;
    let p = Path::new(&path);
    if p.starts_with(std::env::temp_dir()) {
        let _ = std::fs::remove_file(p);
    }
    Ok(())
}
