import { ClipboardPaste, ImagePlus, SearchX } from "lucide-react";
import { useI18n } from "../i18n";
import { modKey } from "../lib/platform";

function ShelfGlyph() {
  return (
    <svg width="88" height="72" viewBox="0 0 88 72" fill="none" aria-hidden>
      <rect x="18" y="10" width="13" height="46" rx="3.5" fill="#E4E4E7" />
      <rect x="35" y="2" width="13" height="54" rx="3.5" fill="#A1A1AA" />
      <rect x="52" y="14" width="13" height="42" rx="3.5" fill="#E4E4E7" />
      <rect x="12" y="60" width="60" height="5" rx="2.5" fill="#D4D4D8" />
    </svg>
  );
}

interface EmptyStateProps {
  hasFilters: boolean;
  onNew: () => void;
  onPaste: () => void;
  onClear: () => void;
}

export function EmptyState({ hasFilters, onNew, onPaste, onClear }: EmptyStateProps) {
  const { t } = useI18n();

  if (hasFilters) {
    return (
      <div className="anim-fade flex h-full flex-col items-center justify-center gap-4 pb-16 text-center">
        <SearchX size={44} strokeWidth={1.2} className="text-faint" />
        <div>
          <h2 className="t-display text-[20px] text-ink">{t("empty.noResults")}</h2>
          <p className="mt-1.5 text-[13.5px] text-muted">{t("empty.noResultsSub")}</p>
        </div>
        <button type="button" className="btn-ghost press cursor-pointer" onClick={onClear}>
          {t("action.clear")}
        </button>
      </div>
    );
  }

  return (
    <div className="anim-fade flex h-full flex-col items-center justify-center gap-5 pb-16 text-center">
      <ShelfGlyph />
      <div>
        <h2 className="t-display text-[24px] text-ink">{t("empty.title")}</h2>
        <p className="mx-auto mt-2 max-w-[380px] text-[14px] leading-relaxed text-muted">{t("empty.sub")}</p>
      </div>
      <div className="flex items-center gap-2.5">
        <button type="button" className="btn-primary press cursor-pointer" onClick={onNew}>
          <ImagePlus size={15.5} />
          {t("empty.cta")}
        </button>
        <button type="button" className="btn-ghost press cursor-pointer" onClick={onPaste}>
          <ClipboardPaste size={15.5} />
          {t("empty.paste")}
          <kbd className="kbd ml-1">{modKey}V</kbd>
        </button>
      </div>
      <p className="text-[12.5px] text-faint">{t("empty.dropHint")}</p>
    </div>
  );
}
