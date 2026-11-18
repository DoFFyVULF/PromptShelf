import { motion, useReducedMotion } from "motion/react";
import { Cpu, Eye, ImagePlus, Loader2, ScanText, X } from "lucide-react";
import { useI18n } from "../i18n";
import { Dialog } from "./Dialog";

interface MissingPromptDialogProps {
  open: boolean;
  /** Remote photo from CivitAI — shown as a soft preview, never imported. */
  previewUrl: string | null;
  author?: string;
  checkpoint?: string;
  saving?: boolean;
  onSave: () => void;
  onCancel: () => void;
}

/** A CivitAI page without generation data: the photo is worth keeping, the
 * prompt is not there. The dialog leads with the photo itself — slightly
 * softened so it reads as a site preview rather than an imported image — and
 * asks for one clear decision. */
export function MissingPromptDialog({
  open,
  previewUrl,
  author,
  checkpoint,
  saving = false,
  onSave,
  onCancel,
}: MissingPromptDialogProps) {
  const { t } = useI18n();
  const reduce = useReducedMotion() ?? false;
  const close = () => {
    if (!saving) onCancel();
  };

  return (
    <Dialog open={open} onClose={close} labelledBy="noprompt-title" width={468}>
      <div className="relative aspect-[16/10] overflow-hidden bg-parchment">
        {previewUrl && (
          <motion.img
            src={previewUrl}
            alt=""
            draggable={false}
            initial={reduce ? false : { opacity: 0, scale: 1.07 }}
            animate={{ opacity: 1, scale: 1.02 }}
            transition={{ duration: reduce ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="no-drag h-full w-full object-cover blur-[1.5px] brightness-[0.8] saturate-[1.04]"
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-black/30"
        />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-4">
          <span className="pointer-events-none inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/30 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md select-none">
            <Eye size={12} strokeWidth={2} />
            {t("import.noPrompt.preview")}
          </span>
          <button
            type="button"
            aria-label={t("action.close")}
            title={t("action.close")}
            onClick={close}
            disabled={saving}
            className="press flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/25 text-white/90 backdrop-blur-md transition-colors hover:bg-black/40 disabled:cursor-default disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-md select-none">
            <ScanText size={13} strokeWidth={2} />
            {t("import.noPrompt.badge")}
          </span>
          {author && (
            <span className="truncate text-[11.5px] text-white/75 select-none">@{author}</span>
          )}
        </div>
      </div>

      <div className="px-7 pt-5 pb-1.5">
        <h2 id="noprompt-title" className="t-display text-[19px] text-ink">
          {t("import.noPrompt.title")}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t("import.noPrompt.hint")}</p>

        {checkpoint && (
          <p className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full border border-hairline bg-parchment px-2.5 py-1 text-[11.5px] text-muted">
            <Cpu size={12} strokeWidth={1.8} className="shrink-0 text-faint" />
            <span className="truncate">{checkpoint}</span>
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-line-soft px-7 py-4">
        <button
          type="button"
          className="btn-ghost press cursor-pointer disabled:cursor-default disabled:opacity-50"
          onClick={close}
          disabled={saving}
        >
          {t("action.cancel")}
        </button>
        <button
          type="button"
          className="btn-primary press min-w-[132px] cursor-pointer justify-center"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? (
            <Loader2 size={14.5} className="spin" />
          ) : (
            <ImagePlus size={14.5} strokeWidth={2} />
          )}
          {saving ? t("import.noPrompt.saving") : t("import.noPrompt.save")}
        </button>
      </div>
    </Dialog>
  );
}
