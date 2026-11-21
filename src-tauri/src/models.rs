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
    pub variant_count: usize,
    pub cover: Option<ImageInfo>,
    pub group_id: String,
    /// Pinned cards sort before everything else on every sort order.
    pub pinned: bool,
    /// Workflow presence for the cover seal; absent for manual cards.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow: Option<CardWorkflow>,
}

/// The little the shelf needs to know about a card's ComfyUI graph: the
/// constitution of the seal. The full summary stays in the detail panel.
#[derive(Serialize)]
pub struct CardWorkflow {
    pub node_count: usize,
    /// The JSON is archived on disk — the stored path is re-checked per list,
    /// so a deleted file reads as "not saved" and can be downloaded again.
    pub saved: bool,
}

#[derive(Serialize)]
pub struct CardDetail {
    pub id: String,
    pub prompt: String,
    /// Extra prompt variants stored as an ordered list; `prompt` stays the main one.
    pub variants: Vec<String>,
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
    /// CivitAI page link behind `source_key` ("civitai:images:<id>" /
    /// "civitai:posts:<id>" → the page); "" for manual cards — the detail
    /// panel then hides the link.
    pub source_url: String,
    /// Compact ComfyUI graph summary from the import; the full graph is not
    /// stored and is fetched only when the user downloads the JSON.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow: Option<WorkflowInfo>,
}

#[derive(Deserialize)]
pub struct ListFilter {
    pub q: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub match_all_tags: bool,
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
    /// CivitAI model page captured on import (the model-versions response
    /// carries its model id); None for prompt-tag parses and manual entries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// CivitAI model type for non-lora resources ("upscaler",
    /// "textualinversion", "workflows", …); None for plain loras (and legacy
    /// entries) so they need no special casing on read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

/// One "other metadata" row, e.g. k = "Seed", v = "557832969775936".
/// A Vec keeps the original order (serde_json::Map sorts by key).
#[derive(Serialize, Deserialize, Clone)]
pub struct MetaItem {
    pub k: String,
    pub v: String,
}

/// Compact ComfyUI graph summary kept with an imported card. The full graph
/// (often >100 KB) stays on CivitAI and is fetched only when the user asks for
/// the JSON file — the DB never carries the whole workflow.
#[derive(Serialize, Deserialize, Clone)]
pub struct WorkflowInfo {
    /// Engine label, currently always "ComfyUI".
    pub engine: String,
    pub node_count: usize,
    #[serde(default)]
    pub link_count: usize,
    #[serde(default)]
    pub group_count: usize,
    /// Node class → occurrences, biggest first (notes/reroutes filtered out).
    #[serde(default)]
    pub node_types: Vec<WorkflowNode>,
    /// Source image id on CivitAI, used by the on-demand download.
    #[serde(default)]
    pub image_id: String,
    /// File-name base for the downloaded JSON.
    #[serde(default)]
    pub title: String,
    /// Absolute path of the last saved JSON, once the user downloaded it.
    /// `None` while nothing was saved (or the file was deleted).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_file: Option<String>,
}

/// One node class in the workflow summary.
#[derive(Serialize, Deserialize, Clone)]
pub struct WorkflowNode {
    pub name: String,
    pub count: usize,
}

#[derive(Deserialize)]
pub struct NewCardInput {
    pub prompt: String,
    /// Additional prompt variants (retypes of the same prompt).
    #[serde(default)]
    pub variants: Vec<String>,
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
    /// Compact ComfyUI graph summary from a CivitAI import.
    #[serde(default)]
    pub workflow: Option<WorkflowInfo>,
    /// Origin fingerprint from an import (e.g. `civitai:images:12`); used to
    /// detect a duplicate link on the next import. Set on create only.
    #[serde(default)]
    pub source_key: Option<String>,
    /// The user explicitly chose to keep an imported image whose page had no
    /// prompt, so the empty prompt is intentional (import flow only).
    #[serde(default)]
    pub allow_empty_prompt: bool,
}

#[derive(Deserialize)]
pub struct UpdateCardInput {
    pub id: String,
    pub prompt: String,
    /// Additional prompt variants; sent wholesale — the client owns the list.
    #[serde(default)]
    pub variants: Vec<String>,
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

// ---------------------------------------------------------------- lora shelf

#[derive(Serialize)]
pub struct LoraSummary {
    pub id: String,
    pub name: String,
    pub base_model: String,
    /// ISO date from the CivitAI "Published" field ("").
    pub published_at: String,
    /// CivitAI model type, e.g. "character" — the blue badge on the tile.
    pub primary_tag: Option<String>,
    pub trigger_words: Vec<String>,
    pub rating: i64,
    pub created_at: String,
    pub updated_at: String,
    /// Web link behind `source_key` ("civitai:model:<id>" → model page); "" for
    /// loras without an import origin.
    pub source_url: String,
    pub cover: Option<ImageInfo>,
    pub group_id: String,
    pub tags: Vec<String>,
    /// Pinned loras sort before everything else on every sort order.
    pub pinned: bool,
}

#[derive(Serialize)]
pub struct LoraDetail {
    pub id: String,
    pub name: String,
    pub base_model: String,
    /// ISO date from the CivitAI "Published" field ("").
    pub published_at: String,
    /// Ordered usage tips, e.g. ["Strength: 0.9"].
    pub usage_tips: Vec<String>,
    pub trigger_words: Vec<String>,
    /// Plain-text model description from the CivitAI page.
    pub description: String,
    pub primary_tag: Option<String>,
    pub note: Option<String>,
    pub rating: i64,
    pub created_at: String,
    pub updated_at: String,
    /// Web link behind `source_key` ("civitai:model:<id>" → model page); "" for
    /// loras without an import origin.
    pub source_url: String,
    pub group_id: String,
    pub tags: Vec<String>,
    pub images: Vec<ImageInfo>,
    pub cover: Option<ImageInfo>,
}

#[derive(Deserialize)]
pub struct NewLoraInput {
    pub name: String,
    #[serde(default)]
    pub base_model: String,
    #[serde(default)]
    pub published_at: String,
    #[serde(default)]
    pub usage_tips: Vec<String>,
    #[serde(default)]
    pub trigger_words: Vec<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub primary_tag: Option<String>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub rating: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Staged temp image paths (same pipeline as prompt cards).
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub group_id: Option<String>,
    /// Origin fingerprint from an import (e.g. `civitai:model:2945627`).
    #[serde(default)]
    pub source_key: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateLoraInput {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub base_model: String,
    #[serde(default)]
    pub usage_tips: Vec<String>,
    #[serde(default)]
    pub trigger_words: Vec<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub primary_tag: Option<String>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub rating: i64,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// The result of importing a CivitAI *model* (LoRA) page: everything the
/// LoraShelf import flow saves directly, plus the staged preview image.
#[derive(Serialize, Clone)]
pub struct CivitaiLoraImport {
    /// Staged preview images (first becomes the cover; empty → no previews).
    pub images: Vec<PasteImageResult>,
    pub name: String,
    pub base_model: String,
    pub published_at: String,
    pub usage_tips: Vec<String>,
    pub trigger_words: Vec<String>,
    pub description: String,
    pub primary_tag: Option<String>,
    pub tags: Vec<String>,
    #[serde(default)]
    pub source_key: Option<String>,
}

#[derive(Serialize)]
pub struct GroupInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub count: i64,
    /// Palette key from `group_style::COLORS`, empty until customised.
    #[serde(default)]
    pub color: String,
    /// Lucide icon key from `group_style::ICONS`, empty until customised.
    #[serde(default)]
    pub icon: String,
}

#[derive(Deserialize)]
pub struct NewGroupInput {
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub icon: String,
}

#[derive(Deserialize)]
pub struct RenameGroupInput {
    pub id: String,
    pub name: String,
}

/// Appearance-only edit — keeps rename a rename and makes partial updates safe.
#[derive(Deserialize)]
pub struct GroupStyleInput {
    pub id: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub icon: String,
}

/// Full ordered list of group ids — index becomes the new `sort` value.
#[derive(Deserialize)]
pub struct ReorderGroupsInput {
    pub ids: Vec<String>,
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
    /// UI appearance: "system" (follow macOS), "light" or "dark".
    pub theme: String,
    /// CivitAI API key for gated/region-filtered image fetches ("" → none).
    pub civitai_api_key: String,
    /// Preview images imported per lora model page (0 = all; 1 by default).
    pub lora_previews: u32,
    /// Check GitHub releases for a new version at startup (deferred to idle).
    pub update_auto_check: bool,
}

#[derive(Deserialize, Default)]
pub struct SettingsPatch {
    pub max_side: Option<u32>,
    pub quality: Option<u8>,
    pub format: Option<String>,
    pub originals: Option<bool>,
    pub thumbs: Option<bool>,
    pub lang: Option<String>,
    pub theme: Option<String>,
    pub civitai_api_key: Option<String>,
    pub lora_previews: Option<u32>,
    pub update_auto_check: Option<bool>,
}

/// Valid values for the persisted `theme` setting.
pub fn is_valid_theme(v: &str) -> bool {
    v == "system" || v == "light" || v == "dark"
}

#[derive(Serialize)]
pub struct LibraryPaths {
    pub data_dir: String,
    pub db_path: String,
}

/// What a user-picked folder contains, so the UI can offer "use this library"
/// instead of "copy my library here" when a `library.db` is already there.
#[derive(Serialize)]
pub struct LibraryInspection {
    pub library: bool,
    pub cards: i64,
    pub loras: i64,
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
    /// Missing when the page has no prompt: the import is parked while the
    /// user decides, and the photo is only downloaded on "save anyway".
    pub image: Option<PasteImageResult>,
    /// Remote photo URL from the page. The card preview uses it directly
    /// (nothing is downloaded) until the user chooses to keep the card.
    #[serde(default)]
    pub preview_url: Option<String>,
    /// True when CivitAI published no generation data for the image.
    #[serde(default)]
    pub no_prompt: bool,
    pub prompt: String,
    pub negative_prompt: String,
    pub author: String,
    pub checkpoint: String,
    pub loras: Vec<Lora>,
    pub tags: Vec<String>,
    pub meta: Vec<MetaItem>,
    /// Compact ComfyUI graph summary (node count/classes) when the page
    /// embeds a workflow; the graph itself stays on CivitAI.
    #[serde(default)]
    pub workflow: Option<WorkflowInfo>,
    /// Origin fingerprint derived from the pasted link (civitai source id),
    /// travels to the editor and is stored with the card on save.
    #[serde(default)]
    pub source_key: Option<String>,
}

/// Duplicate warning lookup input: check by origin key when provided,
/// otherwise by the normalized prompt text.
#[derive(Deserialize)]
pub struct DuplicateCheckInput {
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub source_key: Option<String>,
}

/// One existing card that matches a duplicate check.
#[derive(Serialize, Clone)]
pub struct DuplicateHit {
    pub id: String,
    pub created_at: String,
    pub prompt: String,
    pub thumb: Option<String>,
}

pub fn app_settings_default() -> AppSettings {
    AppSettings {
        max_side: 1200,
        quality: 75,
        format: "jpeg".to_string(),
        originals: false,
        thumbs: true,
        lang: "en".to_string(),
        theme: "system".to_string(),
        civitai_api_key: String::new(),
        lora_previews: 1,
        update_auto_check: true,
    }
}

pub fn es<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
