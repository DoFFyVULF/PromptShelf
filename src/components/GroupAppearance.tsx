import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Palette, Pipette, RotateCcw, Search, X } from "lucide-react";
import { useI18n } from "../i18n";
import {
  GROUP_COLORS,
  GROUP_COLOR_LABELS,
  HUES,
  groupColorStyle,
  groupColorVar,
  hexToHsl,
  hueSwatch,
  isCustomColor,
  normalizeHex,
  shadeSwatches,
  type GroupColorKey,
} from "../lib/groupStyle";
import { ICON_CATEGORIES, groupIconMeta } from "../lib/groupIcons";

interface GroupAppearanceProps {
  color: string;
  icon: string;
  /** Both values are persisted together, so one click is one API call. */
  onPick: (next: { color: string; icon: string }) => void;
  onClose: () => void;
}

/** Inline editor revealed by the palette button on a group row. */
export function GroupAppearance({ color, icon, onPick, onClose }: GroupAppearanceProps) {
  const { t, lang } = useI18n();
  const reduced = useReducedMotion();
  const [query, setQuery] = useState("");

  const custom = isCustomColor(color) ? normalizeHex(color)! : null;
  const [customOpen, setCustomOpen] = useState(Boolean(custom));
  const [hexDraft, setHexDraft] = useState(custom ?? "");
  const [hexError, setHexError] = useState(false);
  const [hue, setHue] = useState(() => hexToHsl(custom ?? "")?.h ?? 210);
  const [saturation, setSaturation] = useState(
    () => Math.max(48, Math.min(84, hexToHsl(custom ?? "")?.s ?? 64)),
  );

  // The same editor is reused for every row: when the shelf reloads a saved
  // colour, adopt its hue/shade instead of showing the previous group's draft.
  useEffect(() => {
    const next = isCustomColor(color) ? normalizeHex(color)! : null;
    setHexDraft(next ?? "");
    setHexError(false);
    const hsl = next ? hexToHsl(next) : null;
    if (hsl) {
      setHue(hsl.h);
      if (hsl.s > 8) setSaturation(Math.max(48, Math.min(84, hsl.s)));
    }
  }, [color]);

  const shades = useMemo(() => shadeSwatches(hue, saturation), [hue, saturation]);
  const preview = custom ?? hueSwatch(hue);

  const commitHex = (value: string) => {
    const normalized = normalizeHex(value);
    if (!normalized) {
      setHexError(true);
      return;
    }
    setHexError(false);
    setHexDraft(normalized);
    onPick({ color: normalized, icon });
  };

  const q = query.trim().toLowerCase();
  const sections = ICON_CATEGORIES.map((category) => ({
    ...category,
    keys: Object.keys(category.icons).filter((key) => {
      if (!q) return true;
      const meta = groupIconMeta(key);
      return (
        key.includes(q) ||
        (meta?.en.toLowerCase().includes(q) ?? false) ||
        (meta?.ru.toLowerCase().includes(q) ?? false)
      );
    }),
  })).filter((category) => category.keys.length > 0);

  return (
    <div
      className="mx-2 mb-2 rounded-[10px] border border-line-soft bg-parchment/70 p-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="t-section text-[10px] font-semibold tracking-[0.07em] text-faint uppercase select-none">
          {t("groups.style")}
        </span>
        <button
          type="button"
          className="btn-icon press -mr-1 cursor-pointer"
          aria-label={t("groups.style.done")}
          title={t("groups.style.done")}
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted">{t("groups.style.color")}</span>
        <button
          type="button"
          onClick={() => onPick({ color: "", icon })}
          disabled={!color}
          title={t("groups.style.reset")}
          aria-label={t("groups.style.reset")}
          className="press flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10.5px] text-muted transition-colors hover:bg-card hover:text-ink disabled:pointer-events-none disabled:opacity-30"
        >
          <RotateCcw size={10} />
          {t("groups.style.reset")}
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {GROUP_COLORS.map((key: GroupColorKey) => {
          const active = color === key;
          const label = GROUP_COLOR_LABELS[key][lang];
          return (
            <button
              key={key}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={active}
              onClick={() => onPick({ color: key, icon })}
              style={{ backgroundColor: groupColorVar(key) }}
              className={`h-6 w-6 cursor-pointer rounded-full border-2 transition-[transform,border-color] duration-150 hover:scale-110 ${
                active ? "scale-110 border-ink" : "border-transparent"
              }`}
            />
          );
        })}
      </div>

      {/* Custom colour: pick a hue, then one of its shades — or type/paste any
          HEX value. Every swatch commits through the same onPick as the preset
          palette, so a choice is still one persisted API call. */}
      <div className="mt-2.5 border-t border-line-soft pt-1.5">
        <button
          type="button"
          onClick={() => setCustomOpen((open) => !open)}
          aria-expanded={customOpen}
          className="press flex w-full cursor-pointer items-center justify-between rounded-md px-0.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-ink"
        >
          <span className="flex items-center gap-1.5">
            <Palette size={12} />
            {t("groups.style.custom")}
            {custom && (
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full ring-1 ring-hairline"
                style={{ backgroundColor: custom }}
              />
            )}
          </span>
          <ChevronDown
            size={12}
            className={`shrink-0 transition-transform duration-150 ${customOpen ? "rotate-180" : ""}`}
          />
        </button>
        <AnimatePresence initial={false}>
          {customOpen && (
            <motion.div
              initial={reduced ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={
                reduced
                  ? { duration: 0 }
                  : { duration: 0.2, ease: [0.32, 0.72, 0, 1] }
              }
              className="overflow-hidden"
            >
              <div className="pt-1">
                <p className="mb-1 text-[9.5px] font-semibold tracking-[0.06em] text-faint uppercase select-none">
                  {t("groups.style.hue")}
                </p>
                <div className="grid grid-cols-12 gap-1">
                  {HUES.map((h) => (
                    <button
                      key={h}
                      type="button"
                      title={`${t("groups.style.hue")} ${h}°`}
                      aria-label={`${t("groups.style.hue")} ${h}°`}
                      aria-pressed={hue === h}
                      onClick={() => setHue(h)}
                      style={{ backgroundColor: hueSwatch(h) }}
                      className={`h-5 w-full cursor-pointer rounded-full transition-[transform,box-shadow] duration-150 hover:scale-110 ${
                        hue === h
                          ? "ring-2 ring-leaf-icon ring-offset-1 ring-offset-parchment"
                          : ""
                      }`}
                    />
                  ))}
                </div>
                <p className="mt-2 mb-1 text-[9.5px] font-semibold tracking-[0.06em] text-faint uppercase select-none">
                  {t("groups.style.shade")}
                </p>
                <div className="grid grid-cols-5 gap-1.5">
                  {shades.map((hex, index) => (
                    <button
                      key={hex}
                      type="button"
                      title={`${t("groups.style.shade")} ${index + 1}`}
                      aria-label={`${t("groups.style.shade")} ${index + 1}`}
                      aria-pressed={custom === hex}
                      onClick={() => {
                        setHexDraft(hex);
                        setHexError(false);
                        onPick({ color: hex, icon });
                      }}
                      style={{ backgroundColor: hex }}
                      className={`h-7 w-full cursor-pointer rounded-md border-2 transition-[transform,border-color] duration-150 hover:scale-105 ${
                        custom === hex ? "border-leaf-icon" : "border-transparent"
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <label
                    className={`flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border bg-card px-2 focus-within:shadow-focus ${
                      hexError ? "border-destructive" : "border-hairline"
                    }`}
                  >
                    <span className="text-[10.5px] text-faint" aria-hidden>#</span>
                    <input
                      type="text"
                      value={hexDraft.replace(/^#/, "")}
                      onChange={(e) => {
                        setHexDraft(e.target.value);
                        setHexError(false);
                      }}
                      onBlur={(e) => commitHex(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitHex(hexDraft);
                          e.currentTarget.blur();
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          setHexDraft(custom ?? "");
                          setHexError(false);
                          e.currentTarget.blur();
                        }
                      }}
                      placeholder="4F46E5"
                      aria-label={t("groups.style.hex")}
                      spellCheck={false}
                      maxLength={7}
                      className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-ink outline-none placeholder:text-faint"
                    />
                  </label>
                  <label
                    title={t("groups.style.pickAny")}
                    className="relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-hairline bg-card text-muted transition-colors hover:text-ink"
                  >
                    <input
                      type="color"
                      value={preview}
                      onChange={(e) => commitHex(e.target.value)}
                      aria-label={t("groups.style.pickAny")}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                    <Pipette size={12} aria-hidden />
                  </label>
                </div>
                {hexError && (
                  <p className="mt-1 text-[10.5px] text-destructive">{t("groups.style.hexHint")}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted">{t("groups.style.icon")}</span>
        <button
          type="button"
          onClick={() => onPick({ color, icon: "" })}
          disabled={!icon}
          title={t("groups.style.reset")}
          aria-label={t("groups.style.reset")}
          className="press flex h-5 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10.5px] text-muted transition-colors hover:bg-card hover:text-ink disabled:pointer-events-none disabled:opacity-30"
        >
          <RotateCcw size={10} />
          {t("groups.style.reset")}
        </button>
      </div>
      <label className="mt-1.5 flex h-7 items-center gap-1.5 rounded-md border border-hairline bg-card px-2 focus-within:shadow-focus">
        <Search size={11.5} className="shrink-0 text-faint" aria-hidden />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("groups.style.searchIcons")}
          aria-label={t("groups.style.searchIcons")}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-faint"
        />
      </label>
      {sections.length ? (
        <div className="mt-1.5 max-h-[204px] space-y-2 overflow-y-auto pr-1">
          {sections.map((category) => (
            <div key={category.key}>
              <p className="mb-1 text-[9.5px] font-semibold tracking-[0.06em] text-faint uppercase select-none">
                {category[lang]}
              </p>
              <div className="grid grid-cols-6 gap-1">
                {category.keys.map((key) => {
                  const meta = groupIconMeta(key);
                  if (!meta) return null;
                  const Icon = meta.icon;
                  const active = icon === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      title={meta[lang]}
                      aria-label={meta[lang]}
                      aria-pressed={active}
                      onClick={() => onPick({ color, icon: key })}
                      className={`${active && color ? "group-tint" : ""} flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 ${
                        active ? "bg-leaf-soft text-leaf" : "text-muted hover:bg-card hover:text-ink"
                      }`}
                      style={active && color ? groupColorStyle(color) : undefined}
                    >
                      <Icon size={13} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-center text-[11px] text-faint">{t("groups.style.noIcons")}</p>
      )}
    </div>
  );
}
