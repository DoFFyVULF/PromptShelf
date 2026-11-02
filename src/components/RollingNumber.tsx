import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";

/* A spring-driven counter: the digits roll to their new value instead of
   snapping, so dragging the quality slider (or switching JPEG/WEBP)
   feels like a dial being turned. */

export function RollingNumber({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const source = useMotionValue(value);
  const spring = useSpring(source, { stiffness: 312, damping: 30, mass: 0.8 });
  const text = useTransform(spring, (v) => `${Math.round(v)}${suffix}`);

  useEffect(() => {
    source.set(value);
  }, [value, source]);

  return <motion.span className="inline-block tabular-nums">{text}</motion.span>;
}
