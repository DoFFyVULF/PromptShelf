import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Cpu,
  ImageOff,
  Info,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  Star,
  Trash2,
  X
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { api, assetUrl } from "../lib/api";
import type { ImageInfo, LoraDetail as LoraDetailData } from "../lib/types";
import { Stars } from "./Stars";
import { useToast } from "./Toasts";
import { IMAGE_EXTS } from "./Editor";

interface LoraDetailProps {
  lora: LoraDetailData;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onChanged: (lora: LoraDetailData) => void;
  onEdit: (lora: LoraDetailData) => void;
  onDeleted: () => void;
}

export function LoraDetail({
  lora,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onChanged,
  onEdit,
  onDeleted
}: LoraDetailProps) {
  const { t, formatDate } = useI18n();
  const { toast } = useToast();
  const [mainIdx, setMainIdx] = useState(0);
  const [copiedTriggers, setCopiedTriggers] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [armImage, setArmImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [adding, setAdding] = useState(0);

  useEffect(() => {
    setMainIdx(0);
    setCopiedTriggers(false);
    setConfirmDelete(false);
    setArmImage(null);
    setZoom(false);
  }, [lora.id]);

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        try {
          await api.copyText(text);
          return true;
        } catch {
          toast(t("toast.error"), "error");
          return false;
        }
      }
    },
    [t, toast]
  );

  const copyTrigger = useCallback(
    async (word: string) => {
      if (await copyText(word)) toast(t("toast.copied"));
    },
    [copyText, t, toast]
  );

  const copyAllTriggers = useCallback(async () => {
    if (!lora.trigger_words.length) return;
    if (await copyText(lora.trigger_words.join(", "))) {
      setCopiedTriggers(true);
      toast(t("lora.triggerCopied"));
      window.setTimeout(() => setCopiedTriggers(false), 1600);
    }
  }, [copyText, lora.trigger_words, t, toast]);

  const rate = useCallback(
    async (v: number) => {
      try {
        await api.updateLora({
          id: lora.id,
          name: lora.name,
          base_model: lora.base_model,
          usage_tips: lora.usage_tips,
          trigger_words: lora.trigger_words,
          description: lora.description,
          primary_tag: lora.primary_tag,
          note: lora.note ?? "",
          rating: v,
          tags: lora.tags
        });
        onChanged({ ...lora, rating: v });
      } catch {
        toast(t("toast.error"), "error");
      }
    },
    [lora, onChanged, t, toast]
  );

  const refresh = useCallback(async () => {
    const fresh = await api.getLora(lora.id);
    onChanged(fresh);
  }, [lora.id, onChanged]);

  const deleteImage = useCallback(
    async (img: ImageInfo) => {
      try {
        await api.deleteLoraImage(img.id);
        await refresh();
        setArmImage(null);
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
            await api.addLoraImage(lora.id, p);
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
  }, [lora.id, refresh, t, toast]);

  const removeLora = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 3200);
      return;
    }
    try {
      await api.deleteLora(lora.id);
      toast(t("toast.deleted"));
      onDeleted();
    } catch {
      toast(t("toast.error"), "error");
    }
  }, [confirmDelete, lora.id, onDeleted, t, toast]);

  const main = lora.images[Math.min(mainIdx, lora.images.length - 1)];

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
                <span className="text-[13px]">{t("lora.detail.noImages")}</span>
              </div>
            )}
            {lora.images.length > 1 && (
              <span className="absolute top-4 right-5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white">
                {t("detail.imageOf", { i: mainIdx + 1, n: lora.images.length })}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-6 pt-1 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {lora.images.map((img, i) => (
              <div
                key={img.id}
                className={`group relative h-14 w-20 shrink-0 overflow-hidden rounded-[9px] border-2 transition-colors ${
                  i === mainIdx ? "border-ink" : "border-transparent hover:border-line-hover"
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
                    armImage === img.id ? "bg-destructive text-on-ink" : "bg-black/50 text-white opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {armImage === img.id ? <Check size={11} /> : <X size={11} />}
                </button>
                {lora.images.length > 1 && (
                  <button
                    type="button"
                    aria-label={t("editor.makeCover")}
                    title={t("editor.makeCover")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void api.setLoraCover(img.id).then(() => refresh()).catch(() => toast(t("toast.error"), "error"));
                    }}
                    className={`absolute bottom-0.5 left-0.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full backdrop-blur transition-opacity ${
                      mainIdx === i ? "bg-ink/85 text-on-ink" : "bg-black/50 text-white opacity-0 group-hover:opacity-100"
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
              className="press flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border-2 border-dashed border-line-hover text-faint transition-colors hover:border-line-active hover:text-muted disabled:cursor-default disabled:opacity-50"
            >
              {adding > 0 ? <Loader2 size={15} className="spin" /> : <Plus size={15} strokeWidth={1.8} />}
            </button>
          </div>
        </div>

        {/* Right: info */}
        <div className="flex min-h-0 min-w-0 flex-col border-l border-hairline">
          <div className="flex items-start justify-between gap-3 px-7 pt-6 pb-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="t-display text-[21px] leading-tight text-ink" title={lora.name}>
                  {lora.name}
                </h2>
                {lora.primary_tag && (
                  <span className="rounded-md bg-action px-1.5 py-[3px] text-[10px] font-bold tracking-wide text-white uppercase shadow-chip">
                    {lora.primary_tag}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <Stars value={lora.rating} size={16} onChange={rate} />
                <span className="text-[11.5px] text-faint">{formatDate(lora.created_at)}</span>
              </div>
            </div>
            <button type="button" className="btn-icon press -mr-2 shrink-0 cursor-pointer" aria-label={t("action.close")} onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-7 pb-2">
            {/* facts row */}
            {(lora.published_at || lora.base_model) && (
              <section className="flex flex-wrap gap-x-5 gap-y-1.5">
                {lora.published_at && (
                  <span className="flex cursor-default items-center gap-1.5 text-[12.5px] text-muted" title={t("lora.published")}>
                    <Calendar size={12.5} className="shrink-0 text-faint" />
                    {t("lora.published")}: {formatDate(lora.published_at)}
                  </span>
                )}
                {lora.base_model && (
                  <span className="flex cursor-default items-center gap-1.5 text-[12.5px] text-muted" title={t("lora.baseModel")}>
                    <Cpu size={12.5} className="shrink-0 text-faint" />
                    <span className="max-w-[240px] truncate">{lora.base_model}</span>
                  </span>
                )}
              </section>
            )}

            {(lora.usage_tips.length ?? 0) > 0 && (
              <section>
                <p className="text-[10.5px] font-semibold tracking-[0.07em] text-faint uppercase select-none">{t("lora.usageTips")}</p>
                <div className="mt-2 rounded-xl bg-parchment px-4 py-3 text-[12.5px] text-body select-text">
                  {lora.usage_tips.map((tip) => (
                    <p key={tip}>{tip}</p>
                  ))}
                </div>
              </section>
            )}

            {lora.trigger_words.length > 0 && (
              <section className="group/triggers relative">
                <div className="flex items-center justify-between">
                  <p className="text-[10.5px] font-semibold tracking-[0.07em] text-faint uppercase select-none">{t("lora.triggerWords")}</p>
                  <button
                    type="button"
                    aria-label={t("lora.copyTriggers")}
                    title={t("lora.copyTriggers")}
                    onClick={copyAllTriggers}
                    className="press -mr-1 flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md text-faint opacity-0 transition-opacity duration-150 group-hover/triggers:opacity-100 hover:bg-parchment hover:text-ink"
                  >
                    {copiedTriggers ? <Check size={12.5} /> : <Copy size={12.5} />}
                  </button>
                </div>
                {/* violet chips with a copy icon, like the CivitAI page */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {lora.trigger_words.map((word) => (
                    <button
                      key={word}
                      type="button"
                      onClick={() => copyTrigger(word)}
                      title={t("action.copy")}
                      className="press flex cursor-pointer items-center gap-1.5 rounded-full bg-violet py-1 pl-3 pr-2 text-[12px] font-medium text-white transition-colors hover:bg-violet-hover"
                    >
                      <span className="max-w-[220px] truncate">{word}</span>
                      <Copy size={10.5} className="opacity-60" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {lora.description && (
              <section>
                <p className="text-[10.5px] font-semibold tracking-[0.07em] text-faint uppercase select-none">{t("lora.description")}</p>
                <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-line text-muted select-text">{lora.description}</p>
              </section>
            )}

            {lora.note && (
              <section>
                <p className="text-[10.5px] font-semibold tracking-[0.07em] text-faint uppercase select-none">{t("lora.note")}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-muted select-text">{lora.note}</p>
              </section>
            )}

            {lora.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {lora.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-hairline bg-card px-2.5 py-0.5 text-[11.5px] text-muted">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {!lora.trigger_words.length && !lora.description && !lora.usage_tips.length && !lora.tags.length && (
              <div className="flex items-center gap-2 rounded-xl bg-parchment px-4 py-3 text-[12.5px] text-faint">
                <Info size={13.5} />
                {t("lora.emptyTriggers")}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-line-soft px-7 py-4">
            <button
              type="button"
              className="btn-primary press min-w-0 flex-1 cursor-pointer"
              onClick={copyAllTriggers}
              disabled={lora.trigger_words.length === 0}
            >
              {copiedTriggers ? <Check size={15} /> : <Copy size={14.5} />}
              <span className="truncate">{copiedTriggers ? t("lora.triggerCopied") : t("lora.copyTriggers")}</span>
            </button>
            <button type="button" className="btn-ghost press cursor-pointer" onClick={() => onEdit(lora)}>
              <Pencil size={14.5} />
              <span className="hidden xl:inline">{t("action.edit")}</span>
            </button>
            <button
              type="button"
              aria-label={t("lora.deleteTitle")}
              title={confirmDelete ? t("action.confirmDelete") : t("lora.deleteTitle")}
              onClick={removeLora}
              className={`press flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border transition-colors ${
                confirmDelete
                  ? "border-destructive/30 bg-destructive text-on-ink"
                  : "border-hairline bg-card text-muted hover:bg-destructive-soft hover:text-destructive"
              }`}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </div>

      {zoom && main && (
        <div className="anim-fade fixed inset-0 z-[110] flex cursor-zoom-out items-center justify-center bg-black/92 p-10" onClick={() => setZoom(false)}>
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
