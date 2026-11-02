import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { ArrowUp } from "lucide-react";
import { useI18n } from "../i18n";

// the app-wide Apple curve (styles.css --ease-apple)
const EASE_APPLE: [number, number, number, number] = [0.32, 0.72, 0, 1];

interface ScrollTopButtonProps {
  containerRef: RefObject<HTMLElement | null>;
}

export function ScrollTopButton({ containerRef }: ScrollTopButtonProps) {
  const { t } = useI18n();
  const prefersReduced = useReducedMotion();
  const [visible, setVisible] = useState(false);

  const { scrollY, scrollYProgress } = useScroll({ container: containerRef });

  // appears once the user is over ~half a viewport deep in the grid; also
  // checked once on mount in case state was restored mid-scroll
  const deepEnough = useCallback(() => {
    const el = containerRef.current;
    return (containerRef.current?.scrollTop ?? 0) > Math.max(320, (el?.clientHeight ?? 0) * 0.55);
  }, [containerRef]);

  useEffect(() => {
    setVisible(deepEnough());
  }, [deepEnough]);

  useMotionValueEvent(scrollY, "change", () => setVisible(deepEnough()));

  const toTop = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" });
  }, [containerRef, prefersReduced]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          initial={{ opacity: 0, scale: 0.3, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.5, y: 16, transition: { duration: 0.18, ease: EASE_APPLE } }}
          whileHover={{ y: -3, transition: { type: "spring", stiffness: 400, damping: 25 } }}
          whileFocus={{ y: -3, transition: { type: "spring", stiffness: 400, damping: 25 } }}
          whileTap={{ scale: 0.9, transition: { type: "spring", stiffness: 500, damping: 30 } }}
          transition={{
            type: "spring",
            stiffness: 340,
            damping: 17,
            opacity: { duration: 0.28, ease: "easeOut" }
          }}
          onClick={toTop}
          aria-label={t("nav.scrollTop")}
          title={t("nav.scrollTop")}
          className="fab fixed right-5 bottom-5 z-[70] flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-ink text-on-ink shadow-panel transition-colors duration-150 hover:bg-ink-hover"
        >
          <svg viewBox="0 0 52 52" className="pointer-events-none absolute -inset-1 -rotate-90" aria-hidden>
            <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
            <motion.circle
              cx="26"
              cy="26"
              r="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              style={{ pathLength: scrollYProgress }}
            />
          </svg>
          <ArrowUp size={16} strokeWidth={2.3} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
