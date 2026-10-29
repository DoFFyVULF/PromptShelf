use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct ImageInfo {
    pub id: String,
    pub file: String,
    pub thumb: String,
    pub original: Option<String>,
    pub width: u32,
    pub height: u32,
    pub bytes: u32,
}

#[derive(Serialize)]
pub struct CardSummary {
    pub id: String,
    pub prompt: String,
    pub note: Option<String>,
    pub rating: i64,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
    pub image_count: i64,
    pub cover: Option<ImageInfo>,
    pub group_id: String,
}

#[derive(Serialize)]
pub struct CardDetail {
    pub id: String,
    pub prompt: String,
    pub negative_prompt: String,
    pub note: Option<String>,
    pub rating: i64,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
    pub loras: Vec<Lora>,
    pub group_id: String,
    pub images: Vec<ImageInfo>,
    pub author: Option<String>,
    pub checkpoint: Option<String>,
    /// Ordered "other metadata" rows (seed, steps, sampler…) from an import.
    pub meta: Vec<MetaItem>,
}

#[derive(Deserialize)]
pub struct ListFilter {
    pub q: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub min_rating: i64,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub group_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Lora {
    pub name: String,
    pub value: String,
}

/// One "other metadata" row, e.g. k = "Seed", v = "557832969775936".
/// A Vec keeps the original order (serde_json::Map sorts by key).
#[derive(Serialize, Deserialize, Clone)]
pub struct MetaItem {
    pub k: String,
    pub v: String,
}

#[derive(Deserialize)]
pub struct NewCardInput {
    pub prompt: String,
    #[serde(default)]
    pub negative_prompt: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub rating: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub loras: Vec<Lora>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub checkpoint: Option<String>,
    #[serde(default)]
    pub meta: Vec<MetaItem>,
}

#[derive(Deserialize)]
pub struct UpdateCardInput {
    pub id: String,
    pub prompt: String,
    #[serde(default)]
    pub negative_prompt: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub rating: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub loras: Vec<Lora>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub checkpoint: Option<String>,
    #[serde(default)]
    pub meta: Vec<MetaItem>,
}

#[derive(Serialize)]
pub struct GroupInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub count: i64,
}

#[derive(Deserialize)]
pub struct NewGroupInput {
    pub name: String,
}

#[derive(Deserialize)]
pub struct RenameGroupInput {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct MoveCardsInput {
    pub ids: Vec<String>,
    pub group_id: String,
}

#[derive(Serialize)]
pub struct TagCount {
    pub name: String,
    pub count: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub max_side: u32,
    pub quality: u8,
    pub format: String,
    pub originals: bool,
    /// false → skip the separate thumbnail file; the compressed image is reused as preview.
    pub thumbs: bool,
    pub lang: String,
    /// CivitAI API key for gated/region-filtered image fetches ("" → none).
    pub civitai_api_key: String,
}

#[derive(Deserialize, Default)]
pub struct SettingsPatch {
    pub max_side: Option<u32>,
    pub quality: Option<u8>,
    pub format: Option<String>,
    pub originals: Option<bool>,
    pub thumbs: Option<bool>,
    pub lang: Option<String>,
    pub civitai_api_key: Option<String>,
}

#[derive(Serialize)]
pub struct LibraryPaths {
    pub data_dir: String,
    pub db_path: String,
}

#[derive(Deserialize)]
pub struct DroppedFileInput {
    /// Original file name (only for diagnostics; format is sniffed from bytes).
    #[allow(dead_code)]
    pub name: String,
    /// File contents as base64.
    pub data: String,
}

#[derive(Serialize, Clone)]
pub struct PasteImageResult {
    pub temp_path: String,
    pub preview: String,
    pub width: u32,
    pub height: u32,
}

/// Everything Prefill imports can pre-fill in the editor, plus the staged
/// image that lands in the normal paste/drop import pipeline.
#[derive(Serialize, Clone)]
pub struct CivitaiImport {
    /// The original photo saved to a temp file (field: temp_path, preview, width, height).
    pub image: PasteImageResult,
    pub prompt: String,
    pub negative_prompt: String,
    pub author: String,
    pub checkpoint: String,
    pub loras: Vec<Lora>,
    pub tags: Vec<String>,
    pub meta: Vec<MetaItem>,
}

pub fn app_settings_default() -> AppSettings {
    AppSettings {
        max_side: 1200,
        quality: 75,
        format: "jpeg".to_string(),
        originals: false,
        thumbs: true,
        lang: "en".to_string(),
        civitai_api_key: String::new(),
    }
}

pub fn es<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
