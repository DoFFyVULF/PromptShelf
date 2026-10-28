<!-- TODO: add UI screenshots (grid, detail view, groups panel) -->

<div align="center">
  <sub><b><a href="README.en.md">English</a> · <a href="README.md">Русский</a></b></sub>
</div>

<div align="center">
  <img src="docs/banner.png" alt="PromptShelf — a shelf for your prompts" width="100%">

  **A local prompt library for macOS and Windows.**<br>
  Every card is a prompt plus its result images. Everything lives on your disk:
  no clouds, no accounts, no external services.

  <p>
    <img src="https://img.shields.io/badge/macOS_%C2%B7_Windows-3f3f46?style=flat-square&labelColor=18181b" alt="macOS · Windows">
    <img src="https://img.shields.io/badge/Tauri-2-3f3f46?style=flat-square&labelColor=18181b" alt="Tauri 2">
    <img src="https://img.shields.io/badge/React-18-3f3f46?style=flat-square&labelColor=18181b" alt="React 18">
    <img src="https://img.shields.io/badge/TypeScript-5-3f3f46?style=flat-square&labelColor=18181b" alt="TypeScript 5">
    <img src="https://img.shields.io/badge/Rust-1.77%2B-3f3f46?style=flat-square&labelColor=18181b" alt="Rust">
    <img src="https://img.shields.io/badge/SQLite-bundled-3f3f46?style=flat-square&labelColor=18181b" alt="SQLite">
  </p>
</div>

---

## ✨ Features

- 🗂 **Cards** — a multiline prompt, one or more images, a note, tags, a star rating, dates.
- 🖼 **Smart compression on import** — an image is downscaled to the long-side limit
  (1200 px by default) and re-encoded to JPEG or WebP at a configurable quality (75% by default).
  Originals are not kept (optionally enable "keep originals" in settings). A thumbnail is
  generated as well for the fast grid.
- 👁 **Browsing** — a thumbnail grid plus a detail view (large photo, full prompt, one-click
  copy), arrow-key navigation, click-to-zoom fullscreen. Each card has a LoRA list with quick
  editing and delete-on-hover.
- 🔍 **Search & filters** — full-text search across prompts, notes and tags; tag filter;
  sorting by date and rating.
- 📚 **Groups** — every card lives in exactly one group. The default group ("Home"/"Домашняя")
  cannot be deleted. The groups panel opens from a chip in the filter bar: create, rename,
  delete (cards of a deleted group return to the default one), switch by clicking, per-group
  card counters. The current group is highlighted in emerald — the only color accent in the UI.
- ☑️ **Multi-select** — a "select" toggle in the filter bar; clicking tiles adds or removes cards.
  A selection bar appears at the bottom: count, "Move to…", "Clear", "Done".
- 🖱 **Drag & drop cards into groups** — pick up a card and the groups panel slides out
  automatically. A shrunken copy of the card with its photo follows the cursor (with a count
  badge when multiple cards are selected); the tile on the shelf shrinks and dims. Every group
  becomes a target: a dashed emerald outline and an arrow on each row, the row under the cursor
  fills with solid emerald. Drop — the cards move over. Selected cards can also be moved with the
  "Move here" button in the panel.
- 📋 **Paste from clipboard** — ⌘V / Ctrl+V pastes a screenshot or a copied image file straight
  into a new card; prompt text pastes into the field as usual.
- 📎 **Drag & drop files** — drop images into the window and a new card opens (file intake uses
  HTML5 webview events, which lets it coexist with card dragging).
- 💾 **Import/export** — the whole library exports to a single `.promptshelf` file
  (zip: SQLite + images) for backup or moving to another machine. Import replaces the current
  library.
- 🌐 **Interface languages** — English and Russian, with a switcher in the header.

## 📦 Installation

### Build from source

```bash
npm install
npm run tauri build
```

Distribution artifacts land in `src-tauri/target/release/bundle/`:

| Platform | File                                 | Folder   |
| -------- | ------------------------------------ | -------- |
| macOS    | `PromptShelf_<version>_aarch64.dmg`  | `dmg/`   |
| macOS    | `PromptShelf.app`                    | `macos/` |
| Windows  | `PromptShelf_<version>_x64_en-US.msi`| `msi/`   |
| Windows  | `PromptShelf_<version>_x64-setup.exe`| `nsis/`  |

**macOS** — open the `.dmg` and drag PromptShelf into Applications.

The app is not signed with an Apple Developer certificate, so Gatekeeper may block the first
launch. Options:

- System Settings → Privacy & Security → "Open Anyway";
- or in Terminal: `xattr -cr /Applications/PromptShelf.app`.

**Windows** — run the `.msi` (or `-setup.exe`) and follow the installer. SmartScreen may warn
about an unknown publisher: "More info" → "Run anyway".

### Without installing (development mode)

```bash
npm run tauri dev
```

## ⌨️ Keyboard shortcuts

| Keys             | Action                                              |
| ---------------- | --------------------------------------------------- |
| ⌘/Ctrl + N       | New card                                             |
| ⌘/Ctrl + V       | Paste image from clipboard                           |
| ⌘/Ctrl + F       | Focus search                                         |
| ⌘/Ctrl + C       | Copy prompt (in detail view)                         |
| ⌘/Ctrl + ,       | Settings                                             |
| ← / →            | Previous / next card                                 |
| Esc              | Close groups panel → viewer → dialog/zoom            |

## 🗃 Storage

The library lives in the standard application data directory:

- macOS: `~/Library/Application Support/app.promptshelf.desktop/`
- Windows: `%APPDATA%\app.promptshelf.desktop\`

```
library.db            # SQLite (cards, images, tags, groups, settings)
images/<uuid>.jpg     # compressed images
images/<uuid>.t.webp  # thumbnails
images/originals/     # optional originals
```

Export: `.promptshelf` = ZIP with a snapshot of `library.db` + the `images` folder.

## 🚀 Development

Requirements: Node 20+, Rust 1.77+ (on Windows — MSVC Build Tools).

```bash
npm install
npm run tauri dev      # run in development mode
npm run build          # type check + frontend build
npm run tauri build    # build .app / .dmg / .msi / .exe
npm run icons          # regenerate the icon set from app-icon.png
```

Frontend only (no native window): `npm run dev` → http://localhost:5173

Compression pipeline tests (downscale, no-upscale, EXIF rotation, previews, etc., 10 in total):

```bash
cd src-tauri && cargo test --lib
```

The design system and UI pattern descriptions live in `design-system/promptshelf/`.

## 🛠 Stack

| Layer    | Technologies                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell    | **Tauri 2** — native window, IPC, dialogs. File drag & drop runs via HTML5 inside the webview (Tauri's native handler is off via `dragDropEnabled: false`) |
| Backend  | **Rust**: `rusqlite` (bundled SQLite), `image` + `webp` (compression, EXIF rotation), `arboard` (clipboard), `zip` (export), `kamadak-exif`           |
| Frontend | **React 18 + TypeScript + Vite + Tailwind CSS 4**, icons by Lucide, fonts Inter (UI) and Manrope (header wordmark), served locally, Cyrillic + Latin |

---

<div align="center">
  <sub>PromptShelf — keep your prompts on your own shelf 📚</sub>
</div>
