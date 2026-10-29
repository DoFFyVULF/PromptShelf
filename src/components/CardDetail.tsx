import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Pencil,
  Plus,
  Trash2,
  X,
  ImageOff,
  Maximize2,
  Star,
  Loader2,
  User,
  Cpu
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { api, assetUrl } from "../lib/api";
import { modKey } from "../lib/platform";
import type { CardDetail as CardDetailType, ImageInfo, LoraItem } from "../lib/types";
import { Stars } from "./Stars";
import { useToast } from "./Toasts";
import { LoraEditor, applyLoraDraft, type LoraDraft } from "./LoraEditor";
import { IMAGE_EXTS } from "./Editor";

interface CardDetailProps {
  card: CardDetailType;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onChanged: (card: CardDetailType) => void;
  onDeleted: () => void;
}

export function CardDetail({ card, hasPrev, hasNext, onPrev, onNext, onClose, onChanged, onDeleted }: CardDetailProps) {
  const { t, formatDate } = useI18n();
  const { toast } = useToast();
  const [mainIdx, setMainIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [armImage, setArmImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);

  // ---------------------------------------------------------------- edit mode
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(0);
  const [prompt, setPrompt] = useState(card.prompt);
  const [note, setNote] = useState(card.note ?? "");
  const [rating, setRating] = useState(card.rating);
  const [tags, setTags] = useState<string[]>(card.tags);
  const [tagDraft, setTagDraft] = useState("");
  const [author, setAuthor] = useState(card.author ?? "");
  const [checkpoint, setCheckpoint] = useState(card.checkpoint ?? "");
  const [loras, setLoras] = useState<LoraItem[]>(card.loras ?? []);
  const [loraDraft, setLoraDraft] = useState<LoraDraft | null>(null);

  // keep the draft readable from the Escape handler
  const loraDraftRef = useRef<LoraDraft | null>(null);
  useEffect(() => {
    loraDraftRef.current = loraDraft;
  }, [loraDraft]);

  useEffect(() => {
    setMainIdx(0);
    setCopied(false);
    setConfirmDelete(false);
    setArmImage(null);
    setZoom(false);
    setEditing(false);
    setSaving(false);
    setPrompt(card.prompt);
    setNote(card.note ?? "");
    setRating(card.rating);
    setTags(card.tags);
    setAuthor(card.author ?? "");
    setCheckpoint(card.checkpoint ?? "");
    setLoras(card.loras ?? []);
    setLoraDraft(null);
  }, [card.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoom) {
        e.stopPropagation();
        setZoom(false);
        return;
      }
      if (editing) {
        e.stopPropagation();
        // Esc inside a LoRA draft cancels the draft first
        if (loraDraftRef.current) {
          setLoraDraft(null);
          return;
        }
        setEditing(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoom, editing]);

  const startEdit = useCallback(() => {
    setPrompt(card.prompt);
    setNote(card.note ?? "");
    setRating(card.rating);
    setTags(card.tags);
    setAuthor(card.author ?? "");
    setCheckpoint(card.checkpoint ?? "");
    setLoras(card.loras ?? []);
    setLoraDraft(null);
    setEditing(true);
  }, [card]);

  const saveEdit = useCallback(async () => {
    if (!prompt.trim()) {
      toast(t("toast.promptRequired"), "error");
      return;
    }
    setSaving(true);
    try {
      await api.updateCard({
        id: card.id,
        prompt: prompt.trim(),
        note,
        rating,
        tags,
        loras: applyLoraDraft(loras, loraDraft),
        author: author.trim() || null,
        checkpoint: checkpoint.trim() || null,
        meta: card.meta ?? []
      });
      const fresh = await api.getCard(card.id);
      onChanged(fresh);
      setEditing(false);
    } catch {
      toast(t("toast.error"), "error");
    } finally {
      setSaving(false);
    }
  }, [card, loras, loraDraft, note, onChanged, prompt, rating, t, tags, toast, author, checkpoint]);

  // ---------------------------------------------------------------- actions

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        try {
          await api.copyText(text);
        } catch {
          toast(t("toast.error"), "error");
          return false;
        }
      }
      return true;
    },
    [t, toast]
  );

  const copyPrompt = useCallback(async () => {
    if (await copyText(card.prompt)) {
      setCopied(true);
      toast(t("toast.copied"));
      window.setTimeout(() => setCopied(false), 1600);
    }
  }, [card.prompt, copyText, t, toast]);

  const copyLora = useCallback(
    async (lora: LoraItem) => {
      if (await copyText(`<lora:${lora.name}:${lora.value || "1"}>`)) {
        toast(t("toast.loraCopied"));
      }
    },
    [copyText, t, toast]
  );

  const rate = useCallback(
    async (v: number) => {
      if (editing) {
        setRating(v); // saved together with the edit
        return;
      }
      try {
        await api.updateCard({
          id: card.id,
          prompt: card.prompt,
          note: card.note ?? "",
          rating: v,
          tags: card.tags,
          loras: card.loras ?? [],
          author: card.author ?? null,
          checkpoint: card.checkpoint ?? null,
          meta: card.meta ?? []
        });
        onChanged({ ...card, rating: v });
      } catch {
        toast(t("toast.error"), "error");
      }
    },
    [card, editing, onChanged, t, toast]
  );

  const refresh = useCallback(async () => {
    const fresh = await api.getCard(card.id);
    onChanged(fresh);
    return fresh;
  }, [card.id, onChanged]);

  const deleteImage = useCallback(
    async (img: ImageInfo) => {
      try {
        await api.deleteCardImage(img.id);
        await refresh();
        setArmImage(null);
      } catch {
        toast(t("toast.error"), "error");
      }
    },
    [refresh, t, toast]
  );

  const setCover = useCallback(
    async (img: ImageInfo) => {
      try {
        await api.setCover(img.id);
        await refresh();
      } catch {
        toast(t("toast.error"), "error");
      }
    },
    [refresh, t, toast]
  );

  const addImages = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        multiple: true,
        title: t("editor.choose"),
        filters: [{ name: "Images", extensions: IMAGE_EXTS }]
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      setAdding((n) => n + paths.length);
      try {
        let failed = 0;
        for (const p of paths) {
          try {
            await api.addCardImage(card.id, p);
          } catch {
            failed += 1;
          }
        }
        if (failed > 0) toast(t("toast.error"), "error");
        await refresh();
      } finally {
        setAdding((n) => Math.max(0, n - paths.length));
      }
    } catch {
      toast(t("toast.error"), "error");
    }
  }, [card.id, refresh, t, toast]);

  const removeCard = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 3200);
      return;
    }
    try {
      await api.deleteCard(card.id);
      toast(t("toast.deleted"));
      onDeleted();
    } catch {
      toast(t("toast.error"), "error");
    }
  }, [card.id, confirmDelete, onDeleted, t, toast]);

  const addTag = useCallback(() => {
    const v = tagDraft.trim().replace(/^#/, "");
    if (!v) return;
    if (!tags.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setTags([...tags, v]);
    }
    setTagDraft("");
  }, [tagDraft, tags]);

  const main = card.images[Math.min(mainIdx, card.images.length - 1)];

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-5">
      <div className="anim-fade absolute inset-0 bg-zinc-950/40" onClick={onClose} aria-hidden />

      {hasPrev && (
        <button
          type="button"
          aria-label="Previous"
          onClick={onPrev}
          className="press absolute top-1/2 left-4 z-10 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/90 text-ink shadow-chip backdrop-blur transition hover:bg-white"
        >
          <ChevronLeft size={19} />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          aria-label="Next"
          onClick={onNext}
          className="press absolute top-1/2 right-4 z-10 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/90 text-ink shadow-chip backdrop-blur transition hover:bg-white"
        >
          <ChevronRight size={19} />
        </button>
      )}

      <div
        role="dialog"
        aria-modal="true"
        style={{ width: "min(1120px, 94vw)", height: "min(760px, 88vh)" }}
        className="anim-panel relative grid grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] overflow-hidden rounded-panel bg-card shadow-panel"
      >
        {/* Left: images */}
        <div className="flex min-h-0 min-w-0 flex-col bg-parchment">
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-8">
            {main ? (
              <button
                type="button"
                onClick={() => setZoom(true)}
                className="group relative flex h-full w-full cursor-zoom-in items-center justify-center"
                aria-label={t("detail.images")}
              >
                <img
                  src={assetUrl(main.file)}
                  alt=""
                  draggable={false}
                  className="no-drag max-h-full max-w-full rounded-tile object-contain shadow-product"
                />
                <span className="absolute right-2 bottom-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-muted opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                  <Maximize2 size={14} />
                </span>
              </button>
            ) : (
              <div className="flex flex-col items-center gap-3 text-faint">
                <ImageOff size={40} strokeWidth={1.2} />
                <span className="text-[13px]">{t("detail.noImages")}</span>
              </div>
            )}
            {card.images.length > 1 && (
              <span className="absolute top-4 right-5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white">
                {t("detail.imageOf", { i: mainIdx + 1, n: card.images.length })}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-6 pt-1 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {card.images.map((img, i) => (
              <div
                key={img.id}
                className={`group relative h-14 w-20 shrink-0 overflow-hidden rounded-[9px] border-2 transition-colors ${
                  i === mainIdx ? "border-ink" : "border-transparent hover:border-zinc-300"
                }`}
              >
                <img
                  src={assetUrl(img.thumb)}
                  alt=""
                  draggable={false}
                  onClick={() => setMainIdx(i)}
                  className="no-drag h-full w-full cursor-pointer object-cover"
                />
                <button
                  type="button"
                  aria-label={t("action.delete")}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (armImage === img.id) {
                      deleteImage(img);
                    } else {
                      setArmImage(img.id);
                      window.setTimeout(() => setArmImage((cur) => (cur === img.id ? null : cur)), 2600);
                    }
                  }}
                  className={`absolute top-0.5 right-0.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full backdrop-blur transition-all ${
                    armImage === img.id ? "bg-red-600 text-white" : "bg-black/50 text-white opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {armImage === img.id ? <Check size={11} /> : <X size={11} />}
                </button>
                {card.images.length > 1 && (
                  <button
                    type="button"
                    aria-label={t("editor.makeCover")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCover(img);
                    }}
                    className={`absolute bottom-0.5 left-0.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full backdrop-blur transition-opacity ${
                      mainIdx === i ? "bg-ink/85 text-white" : "bg-black/50 text-white opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <Star size={10} className="fill-current" />
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              aria-label={t("editor.add")}
              title={t("editor.add")}
              onClick={addImages}
              disabled={adding > 0}
              className="press flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border-2 border-dashed border-zinc-300 text-faint transition-colors hover:border-zinc-400 hover:text-muted disabled:cursor-default disabled:opacity-50"
            >
              {adding > 0 ? <Loader2 size={15} className="spin" /> : <Plus size={15} strokeWidth={1.8} />}
            </button>
          </div>
        </div>

        {/* Right: info */}
        <div className="flex min-h-0 min-w-0 flex-col border-l border-hairline">
          <div className="flex items-start justify-between gap-3 px-7 pt-6 pb-4">
            <div className="min-w-0">
              <div className="text-[11.5px] text-faint">
                {t("detail.added")} · {formatDate(card.created_at)}
              </div>
              <div className="mt-2">
                <Stars value={editing ? rating : card.rating} size={17} onChange={rate} />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className="btn-icon press -mr-2 cursor-pointer" aria-label={t("action.close")} onClick={onClose}>
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-7 pb-2">
            {editing ? (
              <>
                <section>
                  <label className="t-section block" htmlFor="detail-prompt">
                    {t("editor.prompt")}
                  </label>
                  <textarea
                    id="detail-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={t("editor.prompt.placeholder")}
                    spellCheck={false}
                    rows={6}
                    className="field mt-2 resize-none select-text"
                  />
                </section>

                <LoraEditor loras={loras} onChange={setLoras} draft={loraDraft} onDraft={setLoraDraft} t={t} />

                <section className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="t-section block" htmlFor="detail-author">
                      {t("editor.author")}
                    </label>
                    <input
                      id="detail-author"
                      type="text"
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      placeholder={t("editor.author.placeholder")}
                      spellCheck={false}
                      className="field mt-2 select-text"
                    />
                  </div>
                  <div>
                    <label className="t-section block" htmlFor="detail-checkpoint">
                      {t("editor.checkpoint")}
                    </label>
                    <input
                      id="detail-checkpoint"
                      type="text"
                      value={checkpoint}
                      onChange={(e) => setCheckpoint(e.target.value)}
                      placeholder={t("editor.checkpoint.placeholder")}
                      spellCheck={false}
                      className="field mt-2 select-text"
                    />
                  </div>
                </section>

                <section>
                  <label className="t-section block" htmlFor="detail-note">
                    {t("editor.note")}
                  </label>
                  <textarea
                    id="detail-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("editor.note.placeholder")}
                    rows={2}
                    className="field mt-2 resize-none select-text"
                  />
                </section>

                <section>
                  <label className="t-section block" htmlFor="detail-tag-input">
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
                      id="detail-tag-input"
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
              </>
            ) : (
              <>
                <section className="group/prompt relative">
                  <div className="flex items-center justify-between">
                    <p className="text-[10.5px] font-semibold tracking-[0.07em] text-faint uppercase select-none">{t("editor.prompt")}</p>
                    <button
                      type="button"
                      aria-label={t("action.copy")}
                      title={t("action.copy")}
                      onClick={copyPrompt}
                      className="press -mr-1 flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md text-faint opacity-0 transition-opacity duration-150 group-hover/prompt:opacity-100 hover:bg-zinc-100 hover:text-ink"
                    >
                      {copied ? <Check size={12.5} /> : <Copy size={12.5} />}
                    </button>
                  </div>
                  <div className="mt-2 mb-1 rounded-xl bg-parchment px-4 py-3.5 text-[13.5px] leading-[1.62] whitespace-pre-wrap text-body select-text">
                    {card.prompt}
                  </div>
                </section>

                {card.loras.length > 0 && (
                  <section>
                    <p className="text-[10.5px] font-semibold tracking-[0.07em] text-faint uppercase select-none">{t("detail.loras")}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {card.loras.map((lora) => (
                        <button
                          key={lora.name}
                          type="button"
                          onClick={() => copyLora(lora)}
                          title={`<lora:${lora.name}:${lora.value || "1"}>`}
                          className="press flex cursor-pointer items-center gap-2 rounded-full border border-hairline bg-card py-1 pl-3 pr-1.5 text-[12px] text-body transition-colors hover:border-zinc-300"
                        >
                          <span className="max-w-[190px] truncate">{lora.name}</span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] leading-tight text-zinc-500 tabular-nums">
                            {lora.value || "1"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {(card.author || card.checkpoint) && (
                  <section className="flex flex-wrap gap-x-5 gap-y-1.5">
                    {card.author && (
                      <span className="flex cursor-default items-center gap-1.5 text-[12.5px] text-muted" title={t("editor.author")}>
                        <User size={12.5} className="shrink-0 text-faint" />
                        <span className="max-w-[220px] truncate">{card.author}</span>
                      </span>
                    )}
                    {card.checkpoint && (
                      <span className="flex cursor-default items-center gap-1.5 text-[12.5px] text-muted" title={t("editor.checkpoint")}>
                        <Cpu size={12.5} className="shrink-0 text-faint" />
                        <span className="max-w-[240px] truncate">{card.checkpoint}</span>
                      </span>
                    )}
                  </section>
                )}

                {card.note && (
                  <section>
                    <p className="text-[10.5px] font-semibold tracking-[0.07em] text-faint uppercase select-none">{t("detail.note")}</p>
                    <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-muted select-text">{card.note}</p>
                  </section>
                )}

                {(card.meta?.length ?? 0) > 0 && (
                  <section>
                    <p className="text-[10.5px] font-semibold tracking-[0.07em] text-faint uppercase select-none">{t("detail.other")}</p>
                    <div className="mt-2 rounded-xl bg-parchment px-4 py-3 text-[12.5px]">
                      {card.meta.map((row) => (
                        <div key={row.k} className="flex gap-3 py-[1.5px]">
                          <span className="w-[96px] shrink-0 text-faint">{row.k}</span>
                          <span className="min-w-0 break-all text-body select-text">{row.v}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {card.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {card.tags.map((tag) => (
                      <span key={tag} className="rounded-full border border-hairline bg-card px-2.5 py-0.5 text-[11.5px] text-muted">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-line-soft px-7 py-4">
            {editing ? (
              <>
                <button type="button" className="btn-ghost press cursor-pointer" onClick={() => setEditing(false)}>
                  {t("action.cancel")}
                </button>
                <button type="button" className="btn-primary press min-w-0 flex-1 cursor-pointer" onClick={saveEdit} disabled={saving}>
                  {saving && <Loader2 size={14} className="spin" />}
                  <span className="truncate">{t("action.save")}</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn-primary press min-w-0 cursor-pointer flex-1" onClick={copyPrompt}>
                  {copied ? <Check size={15} /> : <Copy size={14.5} />}
                  <span className="truncate">{copied ? t("toast.copied") : t("action.copy")}</span>
                  <kbd className="kbd hidden border-zinc-600 bg-transparent text-zinc-400 xl:flex">{modKey}C</kbd>
                </button>
                <button type="button" className="btn-ghost press cursor-pointer" onClick={startEdit}>
                  <Pencil size={14.5} />
                  <span className="hidden xl:inline">{t("action.edit")}</span>
                </button>
                <button
                  type="button"
                  aria-label={t("detail.deleteTitle")}
                  title={confirmDelete ? t("action.confirmDelete") : t("action.delete")}
                  onClick={removeCard}
                  className={`press flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border transition-colors ${
                    confirmDelete
                      ? "border-red-200 bg-red-600 text-white"
                      : "border-hairline bg-card text-muted hover:bg-red-50 hover:text-destructive"
                  }`}
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {zoom && main && (
        <div
          className="anim-fade fixed inset-0 z-[110] flex cursor-zoom-out items-center justify-center bg-black/92 p-10"
          onClick={() => setZoom(false)}
        >
          <img src={assetUrl(main.file)} alt="" draggable={false} className="no-drag max-h-full max-w-full object-contain" />
          <button
            type="button"
            className="absolute top-5 right-5 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
            aria-label={t("action.close")}
            onClick={() => setZoom(false)}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
