import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  AppSettings,
  CardDetail,
  CardSummary,
  CivitaiImport,
  CivitaiLoraImport,
  DuplicateHit,
  GroupInfo,
  ImageInfo,
  LibraryInspection,
  LibraryPaths,
  ListFilter,
  LoraDetail,
  LoraSummary,
  NewCardInput,
  NewLoraInput,
  PasteImageResult,
  SettingsPatch,
  TagCount,
  UpdateCardInput,
  UpdateLoraInput
} from "./types";

// The active library dir (from get_library_paths). Image paths in the DB are
// stored relative to it, while convertFileSrc needs an absolute path — the join
// below also makes a custom library location work.
let libraryDir = "";
export function setLibraryDir(dir: string) {
  libraryDir = dir.replace(/[\\/]+$/, "");
}

const isAbsolute = (p: string) => p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);

export const assetUrl = (path: string): string => {
  if (!path || isAbsolute(path)) return convertFileSrc(path);
  const sep = libraryDir.includes("\\") ? "\\" : "/";
  return convertFileSrc(libraryDir ? `${libraryDir}${sep}${path}` : path);
};

export const api = {
  listCards: (filter: ListFilter) => invoke<CardSummary[]>("list_cards", { filter }),
  getCard: (id: string) => invoke<CardDetail>("get_card", { id }),
  createCard: (input: NewCardInput) => invoke<CardDetail>("create_card", { input }),
  updateCard: (input: UpdateCardInput) => invoke<void>("update_card", { input }),
  deleteCard: (id: string) => invoke<void>("delete_card", { id }),

  addCardImage: (card: string, path: string) => invoke<void>("add_card_image", { card, path }),
  deleteCardImage: (id: string) => invoke<void>("delete_card_image", { id }),
  setCover: (id: string) => invoke<void>("set_cover", { id }),

  listTags: () => invoke<TagCount[]>("list_tags"),

  listGroups: () => invoke<GroupInfo[]>("list_groups"),
  createGroup: (name: string) => invoke<GroupInfo>("create_group", { input: { name } }),
  renameGroup: (id: string, name: string) => invoke<void>("rename_group", { input: { id, name } }),
  deleteGroup: (id: string) => invoke<void>("delete_group", { id }),
  moveCards: (ids: string[], group_id: string) => invoke<void>("move_cards", { input: { ids, group_id } }),

  getSettings: () => invoke<AppSettings>("get_settings"),
  setSettings: (patch: SettingsPatch) => invoke<AppSettings>("set_settings", { patch }),

  pasteImageFromClipboard: () => invoke<PasteImageResult | null>("paste_image_from_clipboard"),
  saveTempImage: (bytes: Uint8Array) => invoke<PasteImageResult | null>("save_temp_image", { bytes: Array.from(bytes) }),
  importDroppedFile: (name: string, base64: string) => invoke<PasteImageResult>("import_dropped_file", { input: { name, data: base64 } }),
  civitaiImport: (url: string) => invoke<CivitaiImport>("civitai_import", { url }),
  civitaiSourceKey: (url: string) => invoke<string | null>("civitai_source_key", { url }),
  checkDuplicates: (input: { prompt?: string | null; source_key?: string | null }) =>
    invoke<DuplicateHit[]>("check_duplicates", { input }),

  // LoraShelf
  listLoras: (filter: ListFilter) => invoke<LoraSummary[]>("list_loras", { filter }),
  getLora: (id: string) => invoke<LoraDetail>("get_lora", { id }),
  createLora: (input: NewLoraInput) => invoke<LoraDetail>("create_lora", { input }),
  updateLora: (input: UpdateLoraInput) => invoke<LoraDetail>("update_lora", { input }),
  deleteLora: (id: string) => invoke<void>("delete_lora", { id }),
  addLoraImage: (lora: string, path: string) => invoke<ImageInfo>("add_lora_image", { lora, path }),
  deleteLoraImage: (id: string) => invoke<void>("delete_lora_image", { id }),
  setLoraCover: (id: string) => invoke<void>("set_lora_cover", { id }),
  listLoraTags: () => invoke<TagCount[]>("list_lora_tags"),
  listLoraGroups: () => invoke<GroupInfo[]>("list_lora_groups"),
  createLoraGroup: (name: string) => invoke<GroupInfo>("create_lora_group", { input: { name } }),
  renameLoraGroup: (id: string, name: string) => invoke<void>("rename_lora_group", { input: { id, name } }),
  deleteLoraGroup: (id: string) => invoke<void>("delete_lora_group", { id }),
  moveLoras: (ids: string[], group_id: string) => invoke<void>("move_loras", { input: { ids, group_id } }),
  checkLoraDuplicates: (input: { prompt?: string | null; source_key?: string | null }) =>
    invoke<DuplicateHit[]>("check_lora_duplicates", { input }),
  civitaiLoraImport: (url: string) => invoke<CivitaiLoraImport>("civitai_lora_import", { url }),
  civitaiLoraSourceKey: (url: string) => invoke<string | null>("civitai_lora_source_key", { url }),
  previewImage: (path: string) => invoke<string>("preview_image", { path }),
  discardTemp: (path: string) => invoke<void>("discard_temp", { path }),

  exportLibrary: (path: string) => invoke<void>("export_library", { path }),
  importLibrary: (path: string) => invoke<void>("import_library", { path }),

  getLibraryPaths: () => invoke<LibraryPaths>("get_library_paths"),
  inspectLibraryDir: (path: string) => invoke<LibraryInspection>("inspect_library_dir", { path }),
  /** Resolves to "adopted" when an existing library was connected, "copied"
   * when the current library was copied into an empty folder. */
  moveLibrary: (newDir: string) => invoke<string>("move_library", { newDir }),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  copyText: (text: string) => invoke<void>("copy_text", { text })
};
