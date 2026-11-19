/**
 * Appearance keys stored on a group. The exact same lists live in Rust at
 * `src-tauri/src/group_style.rs` — keep them in sync. Actual colours are CSS
 * variables (`--group-<key>`) declared in `styles.css` for both themes.
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

/** Unknown keys render as "unset" instead of leaking a CSS variable lookup. */
export function groupColorVar(key: string): string | undefined {
  return (GROUP_COLORS as readonly string[]).includes(key) ? `var(--group-${key})` : undefined;
}
