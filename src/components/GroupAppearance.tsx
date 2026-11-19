import { useState } from "react";
import { RotateCcw, Search, X } from "lucide-react";
import { useI18n } from "../i18n";
import { GROUP_COLORS, GROUP_COLOR_LABELS, groupColorVar, type GroupColorKey } from "../lib/groupStyle";
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
  const [query, setQuery] = useState("");

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
                      style={active && color ? { color: groupColorVar(color) } : undefined}
                      className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 ${
                        active ? "bg-leaf-soft text-leaf" : "text-muted hover:bg-card hover:text-ink"
                      }`}
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
