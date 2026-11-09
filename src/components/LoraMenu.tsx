import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy, Download, ExternalLink, Link2Off } from "lucide-react";
import { useI18n, type DictKey } from "../i18n";
import { isLoraKind, type LoraItem } from "../lib/types";

const EASE = [0.32, 0.72, 0, 1] as const;
const MENU_W = 240;

/** Human label for a non-lora CivitAI resource kind ("upscaler" → "Upscaler",
 * "textualinversion" → "Embedding"); unknown kinds fall back to the raw type. */
export function resKindLabel(kind: string, t: (k: DictKey) => string): string {
  const k = kind.toLowerCase();
  const key: DictKey | null =
    k === "upscaler"
      ? "detail.res.upscaler"
      : k === "textualinversion"
        ? "detail.res.embedding"
        : k === "workflows"
          ? "detail.res.workflow"
          : null;
  return key ? t(key) : kind;
}

interface LoraMenuState {
  lora: LoraItem;
  /** The chip button the bubble anchors to. */
  anchor: HTMLElement;
}

interface LoraMenuProps {
  /** Null → closed. */
  menu: LoraMenuState | null;
  onClose: () => void;
  onCopy: (lora: LoraItem) => void;
  onImport: (url: string) => void;
  onOpenPage: (url: string) => void;
}

/**
 * Action bubble for a lora chip in the card detail: copy the invocation tag,
 * import the model into LoraShelf, open its CivitAI page. Portalled to
 * <body> and anchored to the chip — flips above when the panel leaves no
 * room below, so it is never clipped by the dialog's scroll area.
 */
export function LoraMenu({ menu, onClose, onCopy, onImport, onOpenPage }: LoraMenuProps) {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const open = menu !== null;

  const [box, setBox] = useState({ left: 0, top: 0, bottom: 0, up: false });
  const [copied, setCopied] = useState(false);

  const measure = useCallback(() => {
    const el = menu?.anchor;
    if (!el) return;
    if (!el.isConnected) {
      onClose();
      return;
    }
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 10;
    const above = r.top - 10;
    setBox({
      left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8)),
      top: r.bottom + 7,
      bottom: window.innerHeight - r.top + 7,
      up: below < 170 && above > below
    });
  }, [menu, onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  // Registered once, on mount: capture-phase Esc dismisses the bubble before
  // the host dialog's own Esc handler can act on the same event.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !openRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const act = (fn: () => void) => {
    fn();
    onClose();
  };

  const lora = menu?.lora;
  const asLora = lora !== undefined && isLoraKind(lora.kind);

  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : {
        initial: { opacity: 0, y: box.up ? 8 : -8, scale: 0.97 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: box.up ? 6 : -6, scale: 0.97 },
        transition: { duration: 0.28, ease: EASE }
      };

  return createPortal(
    <AnimatePresence>
      {menu && (
        <motion.div
          key="lora-menu"
          role="menu"
          aria-label={menu.lora.name}
          {...motionProps}
          style={{
            position: "fixed",
            left: box.left,
            width: MENU_W,
            zIndex: 130,
            transformOrigin: box.up ? "bottom left" : "top left",
            ...(box.up ? { bottom: box.bottom } : { top: box.top })
          }}
          className="overflow-hidden rounded-card border border-hairline bg-card/95 shadow-tile-hover backdrop-blur-xl"
        >
          {/* header: the model name + its weight (or kind, for non-lora resources) */}
          <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3.5 py-2.5">
            <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">{menu.lora.name}</span>
            <span className="shrink-0 rounded-full bg-parchment px-2 py-0.5 text-[10.5px] leading-tight text-muted tabular-nums">
              {asLora ? menu.lora.value || "1" : resKindLabel(menu.lora.kind as string, t)}
            </span>
          </div>

          <div className="px-1.5 py-1.5">
            {asLora && (
              <MenuRow
                icon={copied ? <Check size={13.5} /> : <Copy size={13.5} />}
                label={t("detail.lora.copyTag")}
                onClick={() =>
                  act(() => {
                    onCopy(menu.lora);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                  })
                }
              />
            )}
            {menu.lora.url ? (
              <>
                <MenuRow
                  icon={<Download size={13.5} />}
                  label={t("detail.lora.import")}
                  onClick={() => act(() => onImport(menu.lora.url as string))}
                />
                <MenuRow
                  icon={<ExternalLink size={13.5} />}
                  label={t("detail.lora.openPage")}
                  onClick={() => act(() => onOpenPage(menu.lora.url as string))}
                />
              </>
            ) : (
              <div className="flex h-9 items-center gap-2.5 px-2.5 text-faint" role="note">
                <Link2Off size={13.5} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{t("detail.lora.noLink")}</span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function MenuRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="press flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13px] text-body transition-colors duration-150 hover:bg-parchment hover:text-ink"
    >
      <span className="shrink-0 text-faint">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
