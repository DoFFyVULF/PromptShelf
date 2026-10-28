export type Lang = "en" | "ru";
export type Sort = "newest" | "oldest" | "rating";

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
  cover: ImageInfo | null;
  group_id: string;
}

export interface CardDetail {
  id: string;
  prompt: string;
  note: string | null;
  rating: number;
  created_at: string;
  updated_at: string;
  tags: string[];
  loras: LoraItem[];
  group_id: string;
  images: ImageInfo[];
}

export interface LoraItem {
  name: string;
  value: string;
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
  note: string;
  rating: number;
  tags: string[];
  images: string[];
  loras: LoraItem[];
  group_id: string;
}

export interface UpdateCardInput {
  id: string;
  prompt: string;
  note: string;
  rating: number;
  tags: string[];
  loras: LoraItem[];
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
}

export interface SettingsPatch {
  max_side?: number;
  quality?: number;
  format?: "jpeg" | "webp";
  originals?: boolean;
  thumbs?: boolean;
  lang?: Lang;
}

export interface LibraryPaths {
  data_dir: string;
  db_path: string;
}

export interface PasteImageResult {
  temp_path: string;
  preview: string;
  width: number;
  height: number;
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
