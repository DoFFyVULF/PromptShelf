import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/** The bloom outlives its own animation a touch, so it can finish the fade. */
const GLOW_MS = 820;
/** The tile hovers off the shelf long enough to be seen, then settles. */
const LIFT_MS = 640;

/**
 * The pin beat, shared by every shelf tile.
 *
 * Pinning is an optimistic state flip in App, so a tile only has to notice the
 * false → true edge. The pulse counter remounts the bloom (a second pin replays
 * it), `glow` keeps the light mounted and `lift` holds the rise. All of it is
 * local state — no layout reads, no reflow and no refetch of the shelf.
 */
export function usePinFlash(pinned: boolean) {
  const reduced = useReducedMotion() ?? false;
  const [pulse, setPulse] = useState(0);
  const [glow, setGlow] = useState(false);
  const [lift, setLift] = useState(false);
  const wasPinned = useRef(pinned);

  useEffect(() => {
    const turnedOn = pinned && !wasPinned.current;
    wasPinned.current = pinned;
    if (!turnedOn || reduced) return;
    setPulse((n) => n + 1);
    setGlow(true);
    setLift(true);
    const glowId = window.setTimeout(() => setGlow(false), GLOW_MS);
    const liftId = window.setTimeout(() => setLift(false), LIFT_MS);
    // Unpinning mid-bloom must not leave the tile hovering; the cleanup also
    // lands the states if this run is replaced by a quicker second pin.
    return () => {
      window.clearTimeout(glowId);
      window.clearTimeout(liftId);
      setGlow(false);
      setLift(false);
    };
  }, [pinned, reduced]);

  return { pulse, glow, lift };
}

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * The gilded bloom: a gold rim, a warm halo that spills past the card and a
 * ring that widens and fades. It has to live outside the tile's overflow clip,
 * which is why the tile is wrapped in a shell. Only opacity and scale animate,
 * so the blur is painted once and then carried by the compositor.
 */
export function PinBloom({ pulse }: { pulse: number }) {
  return (
    <>
      <motion.span
        key={`bloom-${pulse}`}
        aria-hidden
        className="pin-bloom"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: [0, 1, 0.7, 0], scale: [0.92, 1.015, 1.035, 1.06] }}
        transition={{ duration: 0.78, times: [0, 0.22, 0.55, 1], ease: EASE_OUT }}
      />
      <motion.span
        key={`ripple-${pulse}`}
        aria-hidden
        className="pin-ripple"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: [0, 0.85, 0], scale: [0.94, 1.05, 1.11] }}
        transition={{ duration: 0.7, times: [0, 0.3, 1], ease: EASE_OUT }}
      />
    </>
  );
}

interface TileShellProps {
  pinned: boolean;
  children: ReactNode;
}

/**
 * One grid cell. No `layout` animation here on purpose: virtual rows move as
 * their measured heights change, and a layout projection would turn every such
 * nudge into a spring transform (visible jitter, worst in narrow windows with
 * many rows). The pin beat lives in the bloom and the lift, not in a flight.
 */
export function TileShell({ pinned, children }: TileShellProps) {
  const { pulse, glow, lift } = usePinFlash(pinned);
  return (
    <div className={`relative min-w-0 ${lift ? "z-10" : ""}`}>
      <div className={`relative h-full ${lift ? "pin-lift" : ""}`}>
        {glow && <PinBloom pulse={pulse} />}
        {children}
      </div>
    </div>
  );
}
