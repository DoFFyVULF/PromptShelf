import { Copy, FileSearch } from "lucide-react";
import { useI18n } from "../i18n";
import { assetUrl } from "../lib/api";
import type { DuplicateHit } from "../lib/types";
import { Dialog, DialogCloseButton } from "./Dialog";

interface DuplicateDialogProps {
  open: boolean;
  hits: DuplicateHit[];
  /** Label of the "continue anyway" action, depending on the flow. */
  proceedKey?: "dup.anyway" | "dup.proceed";
  onProceed: () => void;
  /** Without a handler the "open existing card" button stays hidden. */
  onOpen?: (id: string) => void;
  onClose: () => void;
}

export function DuplicateDialog({ open, hits, proceedKey = "dup.anyway", onProceed, onOpen, onClose }: DuplicateDialogProps) {
  const { t, formatDate } = useI18n();

  return (
    <Dialog open={open} onClose={onClose} labelledBy="dup-title" width={480}>
      <div className="flex items-center justify-between px-7 pt-6 pb-1">
        <h2 id="dup-title" className="t-display flex items-center gap-2.5 text-[18px] text-ink">
          <FileSearch size={18} strokeWidth={1.8} className="text-faint" />
          {t("dup.title")}
        </h2>
        <DialogCloseButton onClose={onClose} label={t("action.close")} />
      </div>

      <div className="space-y-3 px-7 pt-2 pb-1">
        <p className="text-[13px] leading-relaxed text-muted">{t("dup.hint")}</p>
        <ul className="max-h-[220px] space-y-1.5 overflow-y-auto pr-0.5">
          {hits.map((hit) => (
            <li
              key={hit.id}
              className={`flex items-center gap-3 rounded-xl border border-hairline bg-parchment px-3 py-2 ${
                onOpen ? "cursor-pointer transition-colors hover:border-line-hover hover:bg-card" : ""
              }`}
              {...(onOpen ? { onClick: () => onOpen(hit.id) } : {})}
            >
              {hit.thumb ? (
                <img
                  src={assetUrl(hit.thumb)}
                  alt=""
                  draggable={false}
                  className="no-drag h-11 w-11 shrink-0 rounded-lg bg-card object-cover"
                />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-card">
                  <Copy size={14} className="text-faint" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-[12.5px] leading-snug text-ink">{hit.prompt}</span>
                <span className="mt-0.5 block text-[11px] text-faint">{formatDate(hit.created_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line-soft px-7 py-4">
        <button type="button" className="btn-ghost press cursor-pointer" onClick={onClose}>
          {t("action.cancel")}
        </button>
        {onOpen && (
          <button type="button" className="btn-ghost press cursor-pointer" onClick={() => onOpen(hits[0].id)}>
            <Copy size={14.5} />
            {t("dup.open")}
          </button>
        )}
        <button type="button" className="btn-primary press cursor-pointer" onClick={onProceed}>
          {t(proceedKey)}
        </button>
      </div>
    </Dialog>
  );
}
