import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Trash2 } from "lucide-react";
import { useI18n } from "../i18n";

/** Idle width/height of the circular icon button. */
const SIZE = 36;
/** Breathing room either side of the armed label. */
const PAD_X = 13;

/**
 * Trash action for the detail footers. The first click arms it: the round
 * icon button springs open into a red "Are you sure?" pill. A second click
 * deletes; the caller disarms it again after a short pause.
 *
 * The armed width is measured from the label, so the pill fits any language
 * without a hard-coded size.
 */
export function ConfirmDeleteButton({
  armed,
  title,
  onClick,
}: {
  armed: boolean;
  title: string;
  onClick: () => void;
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

  const width = armed ? Math.round(labelWidth + PAD_X * 2) : SIZE;

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
      className={`press-bg relative flex h-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border ${
        armed
          ? "border-destructive bg-destructive text-on-ink dark:text-ink"
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
            <Trash2 size={15} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
