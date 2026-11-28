import type { CSSProperties } from "react";

/**
 * Appearance keys stored on a group. The exact same lists live in Rust at
 * `src-tauri/src/group_style.rs` — keep them in sync. Actual colours are CSS
 * variables (`--group-<key>`) declared in `styles.css` for both themes.
 *
 * Besides these keys a group may store its own `#rrggbb` value. It lives in
 * the same `color` column, is validated by Rust on the way in, and is rendered
 * straight as a CSS colour (the dark theme lifts it with `color-mix`).
 */
export const GROUP_COLORS = [
  "rose",
  "pink",
  "fuchsia",
  "purple",
  "violet",
  "indigo",
  "blue",
  "sky",
  "cyan",
  "teal",
  "green",
  "lime",
  "yellow",
  "amber",
  "orange",
  "red",
  "gold",
  "stone",
  "zinc",
  "slate",
] as const;

export type GroupColorKey = (typeof GROUP_COLORS)[number];

/** Labels live next to the keys so a new colour/icon is added in one place. */
export const GROUP_COLOR_LABELS: Record<GroupColorKey, { en: string; ru: string }> = {
  rose: { en: "Rose", ru: "Розовый" },
  pink: { en: "Pink", ru: "Пинковый" },
  fuchsia: { en: "Fuchsia", ru: "Пурпурный" },
  purple: { en: "Purple", ru: "Фиолетовый" },
  violet: { en: "Violet", ru: "Светло-фиолетовый" },
  indigo: { en: "Indigo", ru: "Индиго" },
  blue: { en: "Blue", ru: "Синий" },
  sky: { en: "Sky", ru: "Небесный" },
  cyan: { en: "Cyan", ru: "Голубой" },
  teal: { en: "Teal", ru: "Бирюзовый" },
  green: { en: "Green", ru: "Зелёный" },
  lime: { en: "Lime", ru: "Лаймовый" },
  yellow: { en: "Yellow", ru: "Жёлтый" },
  amber: { en: "Amber", ru: "Янтарный" },
  orange: { en: "Orange", ru: "Оранжевый" },
  red: { en: "Red", ru: "Красный" },
  gold: { en: "Gold", ru: "Золотой" },
  stone: { en: "Stone", ru: "Каменный" },
  zinc: { en: "Zinc", ru: "Цинковый" },
  slate: { en: "Slate", ru: "Серый" },
};

/** `#abc` and `#aabbcc` (with or without the hash) normalise to `#aabbcc`. */
export function normalizeHex(value: string): string | null {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1];
  return `#${(digits.length === 3
    ? digits
        .split("")
        .map((c) => c + c)
        .join("")
    : digits).toLowerCase()}`;
}

export function isCustomColor(value: string): boolean {
  return normalizeHex(value) !== null;
}

/** Unknown keys render as "unset" instead of leaking a CSS variable lookup. */
export function groupColorVar(value: string): string | undefined {
  const custom = normalizeHex(value);
  if (custom) return custom;
  return (GROUP_COLORS as readonly string[]).includes(value) ? `var(--group-${value})` : undefined;
}

/**
 * One style object for every group tint. Palette keys keep their theme-aware
 * CSS variable; a custom hex gets a lightened sibling for the dark theme so a
 * manually chosen dark colour stays legible on near-black surfaces.
 */
export function groupColorStyle(value: string): CSSProperties | undefined {
  const color = groupColorVar(value);
  if (!color) return undefined;
  const dark = isCustomColor(value)
    ? `color-mix(in oklab, ${color} 66%, white)`
    : color;
  return { "--group-tint": color, "--group-tint-dark": dark } as CSSProperties;
}

export interface Hsl {
  /** degrees, 0–359 */
  h: number;
  /** percent, 0–100 */
  s: number;
  /** percent, 0–100 */
  l: number;
}

export function hexToHsl(value: string): Hsl | null {
  const hex = normalizeHex(value);
  if (!hex) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return {
    h: Math.round((h + 360) % 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** 12 hues around the wheel, used as the top row of the custom picker. */
export const HUES = Array.from({ length: 12 }, (_, i) => i * 30);

export function hueSwatch(h: number): string {
  return hslToHex(h, 68, 52);
}

/** Five steps of the same hue, light → dark. */
export function shadeSwatches(h: number, s = 64): string[] {
  return [78, 64, 52, 40, 30].map((l) => hslToHex(h, s, l));
}
