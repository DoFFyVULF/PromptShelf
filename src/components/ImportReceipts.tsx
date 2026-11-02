import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, X } from "lucide-react";
import { useI18n } from "../i18n";

/** One auto-imported card waiting in the top-right stack. */
export interface ImportReceipt {
  id: string;
  /** JPEG data URL from the CivitAI fetch — shown before the grid reload finishes. */
  thumb: string;
  prompt: string;
}

interface ImportReceiptsProps {
  items: ImportReceipt[];
  onOpen: (id: string) => void;
  onUndo: (id: string) => void;
  onExpire: (id: string) => void;
}

/** How long a receipt lives before it slides out (paused while hovered). */
const TTL_MS = 15000;

const ENTER_SPRING = { type: "spring", stiffness: 380, damping: 32, mass: 0.9 } as const;
const EXIT_TWEEN = { duration: 0.18, ease: "easeIn" } as const;
/** The undo pill: the "Отменить" label unfurls while the button is hovered. */
const EXPAND_TWEEN = { duration: 0.22, ease: "easeOut" } as const;

function ReceiptRow({
  item,
  reduce,
  onOpen,
  onUndo,
  onExpire
}: {
  item: ImportReceipt;
  reduce: boolean;
  onOpen: (id: string) => void;
  onUndo: (id: string) => void;
  onExpire: (id: string) => void;
}) {
  const { t } = useI18n();

  // the undo pill unfurls its "Отменить" label while the button is hovered
  const [undoHover, setUndoHover] = useState(false);

  // dismiss timer with a real pause: hovering guards the remaining milliseconds
  const doneRef = useRef(false);
  const leftRef = useRef(TTL_MS);
  const startedRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const arm = useCallback(
    (ms: number) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      startedRef.current = Date.now();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (!doneRef.current) {
          doneRef.current = true;
          onExpire(item.id);
        }
      }, ms);
    },
    [item.id, onExpire]
  );

  useEffect(() => {
    arm(leftRef.current);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [arm]);

  const settle = useCallback(() => {
    doneRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const pause = useCallback(() => {
    if (timerRef.current === null || doneRef.current) return;
    leftRef.current = Math.max(0, leftRef.current - (Date.now() - startedRef.current));
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const resume = useCallback(() => {
    if (!doneRef.current) arm(leftRef.current);
  }, [arm]);

  return (
    <motion.article
      layout={reduce ? undefined : true}
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 30, y: -10, scale: 0.95 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0, transition: EXIT_TWEEN } : { opacity: 0, x: 26, scale: 0.96, transition: EXIT_TWEEN }}
      transition={reduce ? { duration: 0.2 } : ENTER_SPRING}
      onPointerEnter={pause}
      onPointerLeave={resume}
      role="button"
      tabIndex={0}
      aria-label={item.prompt}
      onClick={() => {
        settle();
        onOpen(item.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          settle();
          onOpen(item.id);
        }
      }}
      className="group pointer-events-auto relative flex w-full cursor-pointer items-center gap-3 rounded-card border border-hairline bg-card py-2.5 pr-11 pl-3 shadow-panel transition-colors duration-150 hover:border-line-hover hover:bg-parchment"
    >
      <img
        src={item.thumb}
        alt=""
        draggable={false}
        className="no-drag h-11 w-11 shrink-0 rounded-[9px] border border-hairline bg-parchment object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 size={12} strokeWidth={2.2} className="shrink-0 text-leaf-icon" />
          <span className="text-[10px] font-semibold tracking-[0.06em] text-faint uppercase select-none">
            {t("import.receipt.ok")}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-body">{item.prompt}</p>
      </div>
      <button
        type="button"
        aria-label={t("import.receipt.undo")}
        title={t("import.receipt.undo")}
        onPointerEnter={() => setUndoHover(true)}
        onPointerLeave={() => setUndoHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          settle();
          onUndo(item.id);
        }}
        className="absolute top-2 right-2 flex h-6 cursor-pointer items-center rounded-full border border-hairline bg-card px-1.5 text-faint opacity-0 shadow-chip transition-colors duration-150 hover:border-destructive/40 hover:bg-destructive-soft hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X size={13} className="shrink-0" />
        <motion.span
          initial={false}
          animate={undoHover ? { width: "auto", opacity: 1 } : { width: 0, opacity: 0 }}
          transition={reduce ? { duration: 0.01 } : EXPAND_TWEEN}
          className="overflow-hidden pl-1 text-[11px] leading-none font-semibold whitespace-nowrap"
        >
          {t("import.receipt.undo.short")}
        </motion.span>
      </button>
    </motion.article>
  );
}

/** Floating stack of auto-import confirmations, in the corner under the top bar. */
export function ImportReceipts({ items, onOpen, onUndo, onExpire }: ImportReceiptsProps) {
  const reduce = useReducedMotion() ?? false;

  return (
    <div className="pointer-events-none fixed top-16 right-4 z-[105] flex w-[300px] flex-col items-stretch gap-2">
      <AnimatePresence mode="popLayout">
        {items.map((r) => (
          <ReceiptRow key={r.id} item={r} reduce={reduce} onOpen={onOpen} onUndo={onUndo} onExpire={onExpire} />
        ))}
      </AnimatePresence>
    </div>
  );
}
