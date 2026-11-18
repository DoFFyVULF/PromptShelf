import { ArrowUpRight, Layers2, Ungroup } from "lucide-react";
import { useI18n, type DictKey } from "../i18n";
import { assetUrl } from "../lib/api";
import type { LoraFamily } from "../lib/loraFamilies";
import { Dialog, DialogCloseButton } from "./Dialog";

interface LoraFamilyDialogProps {
  family: LoraFamily;
  onClose: () => void;
  onSplit: (id: string) => void;
  onOpenLora: (id: string) => void;
}

/** The group's contents: every variant stays individually reachable, and the
 * group can be dissolved from here just as it can from the tile's corner. */
export function LoraFamilyDialog({
  family,
  onClose,
  onSplit,
  onOpenLora,
}: LoraFamilyDialogProps) {
  const { t, lang } = useI18n();
  const n = family.members.length;
  const hintKey: DictKey =
    family.reason === "version"
      ? "family.dialog.versionHint"
      : "family.dialog.modelHint";

  const countKey: DictKey =
    lang === "ru"
      ? n % 10 === 1 && n % 100 !== 11
        ? "family.variants.one"
        : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
          ? "family.variants.few"
          : "family.variants.many"
      : n === 1
        ? "family.variants.one"
        : "family.variants.other";

  return (
    <Dialog open onClose={onClose} width={640} labelledBy="lora-family-title">
      <div className="flex items-start justify-between gap-4 px-7 pt-7 pb-5">
        <div className="min-w-0">
          <p className="t-section mb-1.5 flex items-center gap-1.5">
            <Layers2 size={12} /> LoraShelf
          </p>
          <h2 id="lora-family-title" className="t-title truncate">
            {family.name}
          </h2>
          <p className="mt-1.5 text-[12.5px] text-muted">
            {t(hintKey)} · {t(countKey, { n })}
          </p>
        </div>
        <DialogCloseButton onClose={onClose} label={t("action.close")} />
      </div>

      <div className="grid grid-cols-2 gap-3 overflow-y-auto px-7 pb-6 sm:grid-cols-3">
        {family.members.map((lora) => (
          <button
            key={lora.id}
            type="button"
            onClick={() => onOpenLora(lora.id)}
            className="press group overflow-hidden rounded-card border border-hairline bg-card text-left transition-colors hover:border-line-hover hover:shadow-tile-hover"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-parchment">
              {lora.cover ? (
                <img
                  src={assetUrl(lora.cover.thumb)}
                  alt=""
                  draggable={false}
                  loading="lazy"
                  className="no-drag h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-faint">
                  <Layers2 size={26} strokeWidth={1.3} />
                </div>
              )}
              <span className="absolute right-1.5 bottom-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                <ArrowUpRight size={13} />
              </span>
            </div>
            <div className="p-2.5">
              <p className="line-clamp-2 text-[12.5px] leading-[1.35] font-semibold text-ink">
                {lora.name}
              </p>
              <p className="mt-1 truncate text-[11px] text-faint">
                {lora.base_model || "—"}
              </p>
            </div>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line-soft bg-canvas px-7 py-4">
        <span className="text-[11.5px] text-muted">{t("family.dialog.hint")}</span>
        <button
          type="button"
          onClick={() => onSplit(family.id)}
          className="btn-danger-ghost press flex shrink-0 cursor-pointer items-center gap-1.5"
        >
          <Ungroup size={14} />
          {t("family.split")}
        </button>
      </div>
    </Dialog>
  );
}
