import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Pin } from "lucide-react";
import { useI18n } from "../i18n";

interface DetailPinControlProps {
  /** Mirrors the pin state of the tile this panel was opened from. */
  pinned: boolean;
  onToggle: () => void;
}

/**
 * The same gilded seal the shelf tile carries, now inside the detail panel.
 * Toggling it recolors the whole two-tone panel, so the modal always reads as
 * the opened version of the card on the main screen.
 */
export function DetailPinControl({ pinned, onToggle }: DetailPinControlProps) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const label = pinned ? t("card.unpin") : t("card.pin");

  return (
    <div className="absolute top-4 left-5 z-10 flex items-center gap-2">
      <motion.button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-pressed={pinned}
        title={label}
        whileHover={reduceMotion ? undefined : { scale: 1.08 }}
        whileTap={reduceMotion ? undefined : { scale: 0.9 }}
        transition={{ type: "spring", stiffness: 520, damping: 24 }}
        className={`pin-chip cursor-pointer ${pinned ? "is-on" : ""}`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={pinned ? "on" : "off"}
            initial={reduceMotion ? false : { scale: 0.6, opacity: 0, rotate: -18 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.6, opacity: 0, rotate: 18 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
            className="flex items-center justify-center"
          >
            <Pin size={14} className={pinned ? "fill-current" : undefined} />
          </motion.span>
        </AnimatePresence>
      </motion.button>
      <AnimatePresence initial={false}>
        {pinned && (
          <motion.span
            key="label"
            initial={reduceMotion ? false : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] }}
            className="detail-pin-label"
          >
            <Pin size={11} className="fill-current" />
            {t("detail.pinned")}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
