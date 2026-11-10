import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Trash2 } from "lucide-react";
import { useI18n } from "../i18n";

/** Idle width/height of the circular icon button. */
const SIZE = 36;
/** Breathing room either side of the armed label. */
const PAD_X = 13;

/**
 * Trash action for the detail footers and the floating selection bar. The
 * first click arms it: the round icon button springs open into a red
 * "Are you sure?" pill. A second click deletes; the caller disarms it again
 * after a short pause.
 *
 * The armed width is measured from the label, so the pill fits any language
 * without a hard-coded size. `tone="on-dark"` re-skins it for the ink-colored
 * selection bar, `compact` matches that bar's 32px controls.
 */
export function ConfirmDeleteButton({
  armed,
  title,
  onClick,
  tone = "surface",
  compact = false,
}: {
  armed: boolean;
  title: string;
  onClick: () => void;
  /** `on-dark` matches the floating selection bar's ink pill grammar. */
  tone?: "surface" | "on-dark";
  /** Slightly smaller hit box for the selection bar. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const label = t("action.areYouSure");
  const rulerRef = useRef<HTMLSpanElement>(null);
  const [labelWidth, setLabelWidth] = useState(0);
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    const el = rulerRef.current;
    if (!el) return;
    setLabelWidth(el.offsetWidth);
  }, [label]);

  const idleWidth = compact ? 32 : SIZE;
  const width = armed ? Math.round(labelWidth + PAD_X * 2) : idleWidth;

  return (
    <motion.button
      type="button"
      aria-label={armed ? label : title}
      title={armed ? t("action.confirmDelete") : title}
      onClick={onClick}
      initial={false}
      animate={{ width }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { type: "spring", visualDuration: 0.34, bounce: 0.14 }
      }
      whileTap={reduceMotion ? undefined : { scale: 0.96 }}
      className={`press-bg relative flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border ${
        compact ? "h-8" : "h-9"
      } ${
        armed
          ? tone === "on-dark"
            ? "border-destructive bg-destructive text-on-ink"
            : "border-destructive bg-destructive text-on-ink dark:text-ink"
          : tone === "on-dark"
            ? "border-transparent bg-on-ink/15 text-on-ink hover:bg-on-ink/25"
            : "border-hairline bg-card text-muted hover:bg-destructive-soft hover:text-destructive"
      }`}
    >
      {/* invisible ruler: sizes the armed pill to the label in any language */}
      <span
        ref={rulerRef}
        aria-hidden
        className="pointer-events-none invisible absolute text-[12.5px] font-semibold tracking-[-0.01em] whitespace-nowrap"
      >
        {label}
      </span>

      <AnimatePresence initial={false}>
        {armed ? (
          <motion.span
            key="label"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 7 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -7 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, delay: 0.04, ease: "easeOut" }}
            className="absolute text-[12.5px] font-semibold tracking-[-0.01em] whitespace-nowrap"
          >
            {label}
          </motion.span>
        ) : (
          <motion.span
            key="icon"
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.55 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.55 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, delay: 0.03, ease: "easeOut" }}
            className="absolute flex items-center justify-center"
          >
            <Trash2 size={compact ? 14 : 15} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
