import { motion, useReducedMotion } from "motion/react";
import { useI18n } from "../i18n";

/** Boot loader: three miniature prompt cards (cover + text lines) spring in
 * one after another — a small preview of the grid the user is waiting for —
 * each keeping its own gentle bob so the row feels alive. The middle card
 * sits slightly raised, like the grid's hovered tile. */
const CARDS = [
  { delay: 0.1, raise: false },
  { delay: 0.24, raise: true },
  { delay: 0.38, raise: false }
];

export function BootLoader() {
  const { t } = useI18n();
  const reduced = useReducedMotion();

  return (
    <div role="status" aria-live="polite" className="anim-fade flex h-full flex-col items-center justify-center gap-5 pb-16">
      <div className="flex items-end gap-1.5" aria-hidden>
        {CARDS.map((c, i) => (
          <motion.div
            key={i}
            className={c.raise ? "relative -top-[6px]" : undefined}
            initial={reduced ? false : { opacity: 0, y: 24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 17, delay: c.delay }}
          >
            <motion.div
              className="w-[46px] rounded-[9px] border border-hairline bg-card p-1.5 shadow-chip"
              animate={reduced ? undefined : { y: [0, -3, 0] }}
              transition={{ duration: 2.8, ease: "easeInOut", repeat: Infinity, delay: 1 + i * 0.24 }}
            >
              <div className={`h-[30px] rounded-[5px] bg-parchment ${i === 1 ? "border border-line-soft" : ""}`} />
              <div className="mt-1.5 space-y-[3px] px-0.5">
                <div className="h-[3px] w-4/5 rounded-full bg-line-hover" />
                <div className="h-[3px] w-3/5 rounded-full bg-line-hover opacity-60" />
              </div>
            </motion.div>
          </motion.div>
        ))}
      </div>

      <div className="flex items-center gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-[5px] w-[5px] rounded-full bg-faint"
            animate={reduced ? { opacity: 0.35 } : { opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
            transition={{ duration: 1.15, ease: "easeInOut", repeat: Infinity, delay: 0.55 + i * 0.17 }}
          />
        ))}
      </div>

      <motion.p
        initial={reduced ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
        className="text-[13px] text-muted"
      >
        {t("state.loading")}
      </motion.p>
    </div>
  );
}
