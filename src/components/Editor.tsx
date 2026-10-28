import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardPaste, FolderOpen, ImagePlus, Loader2, X, Star, AlertCircle } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { modKey } from "../lib/platform";
import { api, assetUrl } from "../lib/api";
import type { AppSettings, CardDetail, LoraItem, StagedImage } from "../lib/types";
import { Stars } from "./Stars";
import { useToast } from "./Toasts";
import { LoraEditor, applyLoraDraft, type LoraDraft } from "./LoraEditor";

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"];

interface EditorProps {
  card: CardDetail | null;
  staged: StagedImage[];
  onStaged: (next: StagedImage[]) => void;
  settings: AppSettings | null;
  groupId: string;
  onClose: () => void;
  onSaved: (detail: CardDetail) => void;
}

export function Editor({ card, staged, onStaged, settings, groupId, onClose, onSaved }: EditorProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [prompt, setPrompt] = useState(card?.prompt ?? "");
  const [note, setNote] = useState(card?.note ?? "");
  const [tags, setTags] = useState<string[]>(card?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [rating, setRating] = useState(card?.rating ?? 0);
  const [loras, setLoras] = useState<LoraItem[]>(card?.loras ?? []);
  const [loraDraft, setLoraDraft] = useState<LoraDraft | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);

  // keep latest staged in a ref for stable callbacks
  const stagedRef = useRef(staged);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  useEffect(() => {
    window.setTimeout(() => promptRef.current?.focus(), 60);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        // Esc inside the LoRA draft cancels the edit instead of the whole dialog
        if (loraDraftRef.current) {
          setLoraDraft(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const addTemp = useCallback(
    async (res: { temp_path: string; preview: string } | null) => {
      if (!res) return false;
      onStaged([...stagedRef.current, { path: res.temp_path, preview: res.preview }]);
      stagedRef.current = [...stagedRef.current, { path: res.temp_path, preview: res.preview }];
      return true;
    },
    [onStaged]
  );

  const pasteFromClipboard = useCallback(async () => {
    setImporting((n) => n + 1);
    try {
      const res = await api.pasteImageFromClipboard();
      if (!res) {
        toast(t("toast.imageCopied"), "info");
        return;
      }
      await addTemp(res);
    } catch {
      toast(t("toast.error"), "error");
    } finally {
      setImporting((n) => n - 1);
    }
  }, [addTemp, t, toast]);

  const chooseFiles = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        multiple: true,
        title: t("editor.choose"),
        filters: [{ name: "Images", extensions: IMAGE_EXTS }]
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      setImporting((n) => n + paths.length);
      try {
        for (const p of paths) {
          try {
            const preview = await api.previewImage(p);
            onStaged([...stagedRef.current, { path: p, preview }]);
            stagedRef.current = [...stagedRef.current, { path: p, preview }];
          } catch {
            toast(t("toast.error"), "error");
          }
        }
      } finally {
        setImporting((n) => n - paths.length);
      }
    } catch {
      toast(t("toast.error"), "error");
    }
  }, [onStaged, t, toast]);

  // DOM paste: image files come as blobs (copied files), screenshots handled natively
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length > 0) {
        e.preventDefault();
        busyRef.current = true;
        setImporting((n) => n + files.length);
        try {
          for (const f of files) {
            const bytes = new Uint8Array(await f.arrayBuffer());
            const res = await api.saveTempImage(bytes);
            if (res) {
              onStaged([...stagedRef.current, { path: res.temp_path, preview: res.preview }]);
              stagedRef.current = [...stagedRef.current, { path: res.temp_path, preview: res.preview }];
            }
          }
        } catch {
          toast(t("toast.error"), "error");
        } finally {
          setImporting((n) => n - files.length);
          busyRef.current = false;
        }
        return;
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text && !busyRef.current) {
        e.preventDefault();
        pasteFromClipboard();
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onStaged, pasteFromClipboard, t, toast]);

  const addTag = useCallback(() => {
    const v = tagDraft.trim().replace(/^#/, "");
    if (!v) return;
    if (v.length > 32) {
      toast(t("toast.error"), "error");
      return;
    }
    if (!tags.some((x) => x.toLowerCase() === v.toLowerCase()) && tags.length < 12) {
      setTags([...tags, v]);
    }
    setTagDraft("");
  }, [tagDraft, tags, t, toast]);

  // keep the draft readable from the Escape handler below
  const loraDraftRef = useRef(loraDraft);
  useEffect(() => {
    loraDraftRef.current = loraDraft;
  }, [loraDraft]);

  const save = useCallback(async () => {
    if (!prompt.trim()) {
      setError(t("editor.error.prompt"));
      promptRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const finalLoras = applyLoraDraft(loras, loraDraft);
      if (card) {
        await api.updateCard({ id: card.id, prompt: prompt.trim(), note, rating, tags, loras: finalLoras });
        for (const id of removed) {
          await api.deleteCardImage(id);
        }
        for (const img of staged) {
          await api.addCardImage(card.id, img.path);
        }
        const fresh = await api.getCard(card.id);
        onSaved(fresh);
      } else {
        const created = await api.createCard({
          prompt: prompt.trim(),
          note,
          rating,
          tags,
          loras: finalLoras,
          group_id: groupId,
          images: staged.map((s) => s.path)
        });
        onSaved(created);
      }
    } catch (e) {
      const msg = String(e);
      toast(msg.includes("PROMPT_REQUIRED") ? t("toast.promptRequired") : t("toast.error"), "error");
      setSaving(false);
    }
  }, [card, groupId, loras, loraDraft, note, onSaved, prompt, rating, removed, staged, t, tags, toast]);

  const existing = (card?.images ?? []).filter((i) => !removed.includes(i.id));
  const hasImages = existing.length > 0 || staged.length > 0;
  const formatLabel = settings?.format === "webp" ? "WebP" : "JPEG";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div className="anim-fade absolute inset-0 bg-zinc-950/35" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        style={{ width: "min(760px, 94vw)" }}
        className="anim-panel relative flex max-h-[88vh] flex-col overflow-hidden rounded-panel bg-card shadow-panel"
      >
        <div className="flex items-center justify-between px-8 pt-6 pb-2">
          <h2 className="t-display text-[20px] text-ink">{card ? t("editor.edit.title") : t("editor.new.title")}</h2>
          <button type="button" className="btn-icon press -mr-2 cursor-pointer" aria-label={t("action.close")} onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-8 pt-3 pb-2">
          <section>
            <label className="t-section block" htmlFor="editor-prompt">
              {t("editor.prompt")}
            </label>
            <textarea
              id="editor-prompt"
              ref={promptRef}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (error) setError(null);
              }}
              placeholder={t("editor.prompt.placeholder")}
              spellCheck={false}
              rows={5}
              className="field mt-2 resize-none select-text"
              style={{ minHeight: 110 }}
            />
            {error && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-destructive">
                <AlertCircle size={12.5} />
                {error}
              </p>
            )}
          </section>

          <section>
            <div className="flex items-baseline justify-between">
              <span className="t-section">{t("editor.images")}</span>
              {settings && (
                <span className="text-[11px] text-faint">
                  {t("editor.compressHint", {
                    side: settings.max_side,
                    format: formatLabel,
                    quality: settings.quality
                  })}
                </span>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap items-start gap-2.5">
              {existing.map((img, i) => (
                <div key={img.id} className="group relative h-[96px] w-[96px] overflow-hidden rounded-tile border border-hairline bg-parchment">
                  <img src={assetUrl(img.thumb)} alt="" draggable={false} className="no-drag h-full w-full object-cover" />
                  {i === 0 && (
                    <span className="absolute top-1 left-1 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9.5px] font-medium text-white backdrop-blur-sm">
                      <Star size={8.5} className="fill-current" />
                      {t("editor.cover")}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={t("editor.removeImage")}
                    onClick={() => setRemoved([...removed, img.id])}
                    className="absolute top-1 right-1 flex h-5.5 w-5.5 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}

              {staged.map((img, i) => (
                <div
                  key={img.path}
                  className="group relative h-[96px] w-[96px] overflow-hidden rounded-tile border-2 border-ink/70 bg-parchment"
                >
                  <img src={img.preview} alt="" draggable={false} className="no-drag h-full w-full object-cover" />
                  {!card && i === 0 && (
                    <span className="absolute top-1 left-1 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9.5px] font-medium text-white backdrop-blur-sm">
                      <Star size={8.5} className="fill-current" />
                      {t("editor.cover")}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={t("editor.removeImage")}
                    onClick={() => {
                      void api.discardTemp(img.path).catch(() => undefined);
                      onStaged(staged.filter((s) => s.path !== img.path));
                    }}
                    className="absolute top-1 right-1 flex h-5.5 w-5.5 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={chooseFiles}
                className="flex h-[96px] w-[96px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-tile border-2 border-dashed border-zinc-300 text-faint transition-colors hover:border-zinc-400 hover:text-muted"
              >
                {importing > 0 ? <Loader2 size={19} className="spin" /> : <ImagePlus size={19} strokeWidth={1.6} />}
                <span className="px-1.5 text-center text-[10px] leading-tight">
                  {importing > 0 ? t("editor.importing") : t("editor.add")}
                </span>
              </button>
            </div>

            {!hasImages && <p className="mt-2 text-[12px] text-faint">{t("editor.dropHint")}</p>}

            <div className="mt-2.5 flex gap-2">
              <button type="button" className="btn-ghost press cursor-pointer" onClick={pasteFromClipboard}>
                <ClipboardPaste size={14.5} />
                {t("editor.paste")}
                <kbd className="kbd ml-0.5">{modKey}V</kbd>
              </button>
              <button type="button" className="btn-ghost press cursor-pointer" onClick={chooseFiles}>
                <FolderOpen size={14.5} />
                {t("editor.choose")}
              </button>
            </div>
          </section>

          <LoraEditor loras={loras} onChange={setLoras} draft={loraDraft} onDraft={setLoraDraft} t={t} />

          <section className="grid grid-cols-2 gap-5">
            <div>
              <label className="t-section block" htmlFor="editor-note">
                {t("editor.note")}
              </label>
              <textarea
                id="editor-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("editor.note.placeholder")}
                rows={2}
                className="field mt-2 resize-none select-text"
              />
            </div>
            <div>
              <span className="t-section block">{t("editor.rating")}</span>
              <div className="mt-3.5">
                <Stars value={rating} size={16} onChange={setRating} />
              </div>
            </div>
          </section>

          <section>
            <label className="t-section block" htmlFor="editor-tag-input">
              {t("editor.tags")}
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-hairline bg-card px-2.5 py-2 transition-colors focus-within:border-zinc-400 focus-within:shadow-[0_0_0_3px_rgb(24_24_27/0.06)]">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-full bg-parchment py-0.5 pr-1.5 pl-2.5 text-[12px] text-body"
                >
                  {tag}
                  <button
                    type="button"
                    aria-label={`${t("action.delete")}: ${tag}`}
                    onClick={() => setTags(tags.filter((x) => x !== tag))}
                    className="cursor-pointer rounded-full text-faint transition-colors hover:text-ink"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                id="editor-tag-input"
                type="text"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  } else if (e.key === "Backspace" && tagDraft === "" && tags.length > 0) {
                    setTags(tags.slice(0, -1));
                  }
                }}
                onBlur={addTag}
                placeholder={tags.length === 0 ? t("editor.tags.placeholder") : ""}
                spellCheck={false}
                className="min-w-[110px] flex-1 border-0 bg-transparent py-1 text-[13px] outline-none placeholder:text-faint"
              />
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line-soft px-8 py-4">
          <p className="min-w-0 truncate text-[11.5px] text-faint">{t("editor.dropHint")}</p>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="btn-ghost press cursor-pointer" onClick={onClose}>
              {t("action.cancel")}
            </button>
            <button type="button" className="btn-primary press cursor-pointer" onClick={save} disabled={saving}>
              {saving && <Loader2 size={14} className="spin" />}
              {t("action.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
