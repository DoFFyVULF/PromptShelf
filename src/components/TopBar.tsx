import { Search, Plus, Settings2, ChevronDown, CloudDownload } from "lucide-react";
import { useI18n } from "../i18n";
import { modKey } from "../lib/platform";
import type { Sort } from "../lib/types";

interface TopBarProps {
  query: string;
  onQuery: (q: string) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
  lang: "en" | "ru";
  onLang: (l: "en" | "ru") => void;
  onNew: () => void;
  onImportCivitai: () => void;
  onSettings: () => void;
}

export function TopBar({ query, onQuery, sort, onSort, lang, onLang, onNew, onImportCivitai, onSettings }: TopBarProps) {
  const { t } = useI18n();

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-canvas/85 px-4 backdrop-blur-xl">
      <div className="pr-1">
        <span className="wordmark text-[16px] leading-none text-ink">
          Prompt<span className="text-faint">Shelf</span>
        </span>
      </div>

      <div className="group relative ml-2 w-[300px] max-w-[34vw]">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
        <input
          id="global-search"
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          spellCheck={false}
          className="h-9 w-full rounded-full border border-hairline bg-card pr-10 pl-9.5 text-[13.5px] transition-colors placeholder:text-faint hover:border-zinc-300 focus:border-zinc-400 focus:outline-none"
        />
        {!query && (
          <kbd className="kbd pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 group-focus-within:hidden sm:flex">
            {modKey}{t("search.shortcut")}
          </kbd>
        )}
      </div>

      <div className="flex-1" />

      <div className="relative">
        <select
          aria-label={t("sort.label")}
          value={sort}
          onChange={(e) => onSort(e.target.value as Sort)}
          className="h-9 cursor-pointer appearance-none rounded-full border border-hairline bg-card pr-8 pl-3.5 text-[13px] font-medium text-body transition-colors hover:border-zinc-300"
        >
          <option value="newest">{t("sort.newest")}</option>
          <option value="oldest">{t("sort.oldest")}</option>
          <option value="rating">{t("sort.rating")}</option>
        </select>
        <ChevronDown size={13} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-faint" />
      </div>

      <div className="flex h-9 items-center rounded-full border border-hairline bg-card p-0.5" role="group" aria-label={t("nav.language")}>
        {(["en", "ru"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onLang(l)}
            aria-pressed={lang === l}
            className={`press h-8 cursor-pointer rounded-full px-2.5 text-[11.5px] font-semibold tracking-wide transition-colors ${
              lang === l ? "bg-ink text-white" : "text-muted hover:text-ink"
            }`}
          >
            {l === "en" ? "EN" : "РУ"}
          </button>
        ))}
      </div>

      <button type="button" className="btn-icon press cursor-pointer" aria-label={t("nav.settings")} onClick={onSettings}>
        <Settings2 size={17} />
      </button>

      <div className="new-pop relative">
        <button type="button" className="btn-primary press cursor-pointer" onClick={onNew}>
          <Plus size={16} strokeWidth={2.2} />
          <span className="hidden lg:inline">{t("action.new")}</span>
        </button>
        {/* Hover bridge: the pt-2 padding keeps the cursor connected over the gap */}
        <div className="absolute right-0 top-full z-50 pt-2">
          <button
            type="button"
            className="civitai-pop btn-primary press cursor-pointer whitespace-nowrap shadow-panel"
            onClick={onImportCivitai}
          >
            <CloudDownload size={15.5} strokeWidth={2} />
            <span className="hidden lg:inline">{t("import.civitai")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
