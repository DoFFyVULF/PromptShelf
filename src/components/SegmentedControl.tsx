import { useEffect, useRef, type ReactNode } from "react";
import { motion, useAnimate, useReducedMotion, type TargetAndTransition } from "motion/react";

/* A segmented control where the ink pill *glides*: it travels between the
   segments on a quiet spring, stretches toward its new slot like an iOS
   toggle and snaps back, while the freshly-active content lands with its
   own entrance (a rotation for the sun/moon, a split-flap for the
   language tab, a pop for the rest). */

const KNOB_SPRING = { type: "spring", stiffness: 430, damping: 32, mass: 0.9 } as const;
/** Apple's landing curve, re-read as a cubic-bezier (matches --ease-apple). */
const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
/** Resting pose of segment content. */
const REST = { x: 0, y: 0, rotate: 0, rotateX: 0, scale: 1, opacity: 1, transformPerspective: 420 };
const DEFAULT_ENTER: TargetAndTransition = { y: 4, scale: 0.82, opacity: 0 };

export interface SegmentOption {
  value: string;
  content: ReactNode;
  /** Accessible name (aria-label / title). */
  label: string;
  /** Extra classes for the button body, e.g. width for icon-only segments. */
  className?: string;
  /** Posing table: how the content lands when its segment becomes active. */
  enter?: TargetAndTransition;
}

interface SegmentedControlProps {
  /** Unique per control — namespaces the shared layout knob. */
  id: string;
  value: string;
  options: SegmentOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}

export function SegmentedControl({ id, value, options, onChange, ariaLabel }: SegmentedControlProps) {
  const reduced = useReducedMotion();
  // The knob's squeeze scale runs on an inner node so it never fights
  // the outer node's layout projection (both own the transform).
  const [knob, squeeze] = useAnimate<HTMLSpanElement>();
  const prevIndex = useRef(-1);
  const mounted = useRef(false);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    const wasMounted = mounted.current;
    mounted.current = true;
    if (!wasMounted || reduced) {
      prevIndex.current = index;
      return;
    }
    const dist = Math.abs(index - prevIndex.current);
    prevIndex.current = index;
    if (dist === 0 || !knob.current) return;
    // Farther hops get a slightly deeper stretch, like iOS overshoot.
    void squeeze(
      knob.current,
      { scaleX: [1, 1 + 0.13 * (1 + (dist - 1) * 0.7), 1] },
      { duration: 0.45, times: [0, 0.4, 1], ease: EASE }
    );
  }, [index, reduced, squeeze, knob]);

  return (
    <div className="flex rounded-full border border-hairline bg-card p-0.5" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            aria-label={o.label}
            title={o.label}
            className={`press relative flex h-7 cursor-pointer items-center justify-center rounded-full px-3 transition-colors ${o.className ?? ""} ${
              active ? "text-on-ink" : "text-muted hover:text-ink"
            }`}
          >
            {active && (
              <motion.span
                layoutId={reduced ? undefined : `seg-knob-${id}`}
                transition={KNOB_SPRING}
                className="absolute inset-0 z-0 rounded-full bg-ink shadow-chip"
              >
                <motion.span ref={knob} className="absolute inset-0 rounded-full bg-ink" />
              </motion.span>
            )}
            <motion.span
              key={active ? "on" : "off"}
              className="relative z-10 flex items-center justify-center"
              initial={active && !reduced ? { ...DEFAULT_ENTER, ...o.enter } : false}
              animate={REST}
              transition={{ type: "spring", stiffness: 520, damping: 26 }}
            >
              {o.content}
            </motion.span>
          </button>
        );
      })}
    </div>
  );
}
