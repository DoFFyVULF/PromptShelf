import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  AppSettings,
  CardDetail,
  CardSummary,
  CivitaiImport,
  GroupInfo,
  LibraryPaths,
  ListFilter,
  NewCardInput,
  PasteImageResult,
  SettingsPatch,
  TagCount,
  UpdateCardInput
} from "./types";

export const assetUrl = (path: string): string => convertFileSrc(path);

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
  previewImage: (path: string) => invoke<string>("preview_image", { path }),
  discardTemp: (path: string) => invoke<void>("discard_temp", { path }),

  exportLibrary: (path: string) => invoke<void>("export_library", { path }),
  importLibrary: (path: string) => invoke<void>("import_library", { path }),

  getLibraryPaths: () => invoke<LibraryPaths>("get_library_paths"),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  copyText: (text: string) => invoke<void>("copy_text", { text })
};
