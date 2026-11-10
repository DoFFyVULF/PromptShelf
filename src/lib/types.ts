export type Lang = "en" | "ru";
export type Theme = "system" | "light" | "dark";
export type Sort = "newest" | "oldest" | "rating";
/** Which shelf is on screen: the logo toggles these. */
export type Mode = "prompt" | "lora";

export interface ImageInfo {
  id: string;
  file: string;
  thumb: string;
  original: string | null;
  width: number;
  height: number;
  bytes: number;
}

export interface CardSummary {
  id: string;
  prompt: string;
  note: string | null;
  rating: number;
  created_at: string;
  updated_at: string;
  tags: string[];
  image_count: number;
  variant_count: number;
  cover: ImageInfo | null;
  group_id: string;
}

export interface CardDetail {
  id: string;
  prompt: string;
  /** Additional prompt variants (retypes of the same prompt); `prompt` stays the main one. */
  variants: string[];
  negative_prompt: string;
  note: string | null;
  rating: number;
  created_at: string;
  updated_at: string;
  tags: string[];
  loras: LoraItem[];
  group_id: string;
  images: ImageInfo[];
  author: string | null;
  checkpoint: string | null;
  meta: MetaItem[];
  /** CivitAI page link behind the import origin ("" → manual card). */
  source_url: string;
}

export interface MetaItem {
  k: string;
  v: string;
}

export interface LoraItem {
  name: string;
  value: string;
  /** CivitAI model page captured on import; null for manual entries. */
  url?: string | null;
  /** CivitAI model type for non-lora resources ("upscaler",
   * "textualinversion", "workflows", …); absent for plain loras. */
  kind?: string;
}

/** Kinds that behave as loras (invocation tag, weight); anything else is an
 * "other resource" — upscalers, embeddings, workflows. */
export function isLoraKind(kind: string | undefined | null): boolean {
  return !kind || ["lora", "lycoris", "locon"].includes(kind.toLowerCase());
}

export interface GroupInfo {
  id: string;
  name: string;
  is_default: boolean;
  count: number;
}

export interface ListFilter {
  q: string | null;
  tags: string[];
  min_rating: number;
  sort: Sort;
  group_id: string | null;
}

export interface NewCardInput {
  prompt: string;
  variants: string[];
  negative_prompt: string;
  note: string;
  rating: number;
  tags: string[];
  images: string[];
  loras: LoraItem[];
  group_id: string;
  author: string | null;
  checkpoint: string | null;
  meta: MetaItem[];
  /** Origin fingerprint for an imported card (dup detection). */
  source_key?: string | null;
}

export interface UpdateCardInput {
  id: string;
  prompt: string;
  /** Sent wholesale — page edits (add/remove/rewrite) ship the full list. */
  variants: string[];
  negative_prompt: string;
  note: string;
  rating: number;
  tags: string[];
  loras: LoraItem[];
  author: string | null;
  checkpoint: string | null;
  meta: MetaItem[];
}

export interface TagCount {
  name: string;
  count: number;
}

export interface AppSettings {
  max_side: number;
  quality: number;
  format: "jpeg" | "webp";
  originals: boolean;
  thumbs: boolean;
  lang: Lang;
  theme: Theme;
  civitai_api_key: string | null;
  /** Preview images imported per lora model page (0 = all available). */
  lora_previews: number;
  /** Check GitHub releases for a new version at startup. */
  update_auto_check: boolean;
}

export interface SettingsPatch {
  max_side?: number;
  quality?: number;
  format?: "jpeg" | "webp";
  originals?: boolean;
  thumbs?: boolean;
  lang?: Lang;
  theme?: Theme;
  civitai_api_key?: string | null;
  lora_previews?: number;
  update_auto_check?: boolean;
}

export interface LibraryPaths {
  data_dir: string;
  db_path: string;
}

/** Contents of a folder picked as the library location. */
export interface LibraryInspection {
  library: boolean;
  cards: number;
  loras: number;
}

export interface PasteImageResult {
  temp_path: string;
  preview: string;
  width: number;
  height: number;
}

export interface CivitaiImport {
  image: PasteImageResult;
  prompt: string;
  negative_prompt: string;
  author: string;
  checkpoint: string;
  loras: LoraItem[];
  tags: string[];
  meta: MetaItem[];
  /** Origin fingerprint from the pasted CivitAI link (dup detection). */
  source_key?: string | null;
}

// ---------------------------------------------------------------- lora shelf

export type LoraUsageTip = string;

export interface LoraSummary {
  id: string;
  name: string;
  base_model: string;
  /** ISO date from the CivitAI "Published" field. */
  published_at: string;
  /** CivitAI model type/category, e.g. "character" — the blue badge. */
  primary_tag: string | null;
  trigger_words: string[];
  rating: number;
  created_at: string;
  updated_at: string;
  /** CivitAI model page link behind the import origin ("" → manual lora). */
  source_url: string;
  cover: ImageInfo | null;
  group_id: string;
  tags: string[];
}

export interface LoraDetail {
  id: string;
  name: string;
  base_model: string;
  published_at: string;
  usage_tips: LoraUsageTip[];
  trigger_words: string[];
  description: string;
  primary_tag: string | null;
  note: string | null;
  rating: number;
  created_at: string;
  updated_at: string;
  /** CivitAI model page link behind the import origin ("" → manual lora). */
  source_url: string;
  group_id: string;
  tags: string[];
  images: ImageInfo[];
  cover: ImageInfo | null;
}

export interface NewLoraInput {
  name: string;
  base_model?: string;
  published_at?: string;
  usage_tips?: string[];
  trigger_words?: string[];
  description?: string;
  primary_tag?: string | null;
  note?: string;
  rating?: number;
  tags: string[];
  images?: string[];
  group_id?: string | null;
  /** Origin fingerprint for an imported lora (dup detection). */
  source_key?: string | null;
}

export interface UpdateLoraInput {
  id: string;
  name: string;
  base_model?: string;
  usage_tips?: string[];
  trigger_words?: string[];
  description?: string;
  primary_tag?: string | null;
  note?: string;
  rating?: number;
  tags: string[];
}

export interface CivitaiLoraImport {
  /** Staged preview images (first becomes the cover; may be empty). */
  images: PasteImageResult[];
  name: string;
  base_model: string;
  published_at: string;
  usage_tips: string[];
  trigger_words: string[];
  description: string;
  primary_tag: string | null;
  tags: string[];
  source_key?: string | null;
}

/** Existing card that matched a duplicate check for the dialog UI. */
export interface DuplicateHit {
  id: string;
  created_at: string;
  prompt: string;
  thumb: string | null;
}

export interface StagedImage {
  path: string;
  preview: string;
}

export interface ExistingImage {
  id: string;
  file: string;
  thumb: string;
  original: string | null;
  width: number;
  height: number;
  bytes: number;
}
