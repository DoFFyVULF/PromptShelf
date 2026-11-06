import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Search, Plus, Settings2, ChevronDown, CloudDownload } from "lucide-react";
import { useI18n } from "../i18n";
import { modKey } from "../lib/platform";
import type { Mode, Sort } from "../lib/types";

interface TopBarProps {
  mode: Mode;
  onToggleMode: () => void;
  query: string;
  onQuery: (q: string) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
  onNew: () => void;
  onImportCivitai: () => void;
  onSettings: () => void;
}

/** The logo word swap: the active word springs in from below the clip edge,
 * knocking the old one out the top — a tight Apple-style single bounce. */
const WORD_SPRING = { type: "spring", stiffness: 460, damping: 24, mass: 0.85 } as const;
const REDUCE_TWEEN = { duration: 0.16, ease: "easeOut" } as const;

export function TopBar({ mode, onToggleMode, query, onQuery, sort, onSort, onNew, onImportCivitai, onSettings }: TopBarProps) {
  const { t } = useI18n();
  const reduce = useReducedMotion() ?? false;

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-canvas/85 px-4 backdrop-blur-xl">
      <div className="pr-1">
        <button
          type="button"
          onClick={onToggleMode}
          aria-label={t("app.mode.toggle")}
          title={t("app.mode.toggle")}
          className="press group flex cursor-pointer items-baseline rounded-md outline-offset-4"
        >
          <span className="wordmark flex items-baseline text-[16px] leading-none text-ink">
            {/* clip-path, not overflow-hidden: an inline-block with overflow keeps
                its baseline only this way, so "Shelf" stays aligned with the word */}
            <motion.span
              layout={reduce ? false : true}
              style={{ clipPath: "inset(-30% 0 0 0)" }}
              className="relative inline-block"
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={mode}
                  initial={reduce ? { opacity: 0 } : { y: "118%", opacity: 0.25 }}
                  animate={reduce ? { opacity: 1 } : { y: "0%", opacity: 1 }}
                  exit={reduce ? { opacity: 0 } : { y: "-118%", opacity: 0.25, transition: WORD_SPRING }}
                  transition={reduce ? REDUCE_TWEEN : WORD_SPRING}
                  className={`inline-block whitespace-nowrap transition-colors group-hover:text-action ${mode === "lora" ? "text-action" : ""}`}
                >
                  {mode === "prompt" ? t("app.modePrompt") : t("app.modeLora")}
                </motion.span>
              </AnimatePresence>
            </motion.span>
            <span className="text-faint">Shelf</span>
          </span>
        </button>
      </div>

      <div className="group relative ml-2 w-[300px] max-w-[34vw]">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
        <input
          id="global-search"
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={mode === "prompt" ? t("search.placeholder") : t("search.placeholderLora")}
          spellCheck={false}
          className="h-9 w-full rounded-full border border-hairline bg-card pr-10 pl-9.5 text-[13.5px] transition-colors placeholder:text-faint hover:border-line-hover focus:border-line-active focus:outline-none"
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
          className="h-9 cursor-pointer appearance-none rounded-full border border-hairline bg-card pr-8 pl-3.5 text-[13px] font-medium text-body transition-colors hover:border-line-hover"
        >
          <option value="newest">{t("sort.newest")}</option>
          <option value="oldest">{t("sort.oldest")}</option>
          <option value="rating">{t("sort.rating")}</option>
        </select>
        <ChevronDown size={13} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-faint" />
      </div>

      <button type="button" className="btn-icon press cursor-pointer" aria-label={t("nav.settings")} onClick={onSettings}>
        <Settings2 size={17} />
      </button>

      <button
        type="button"
        className="btn-ghost press cursor-pointer whitespace-nowrap"
        aria-label={mode === "prompt" ? t("import.civitai") : t("import.lora")}
        title={mode === "prompt" ? t("import.civitai") : t("import.lora")}
        onClick={onImportCivitai}
      >
        <CloudDownload size={15.5} strokeWidth={2} />
        <span className="hidden lg:inline">{mode === "prompt" ? t("import.civitai") : t("import.lora")}</span>
      </button>

      <button type="button" className="btn-primary press cursor-pointer" onClick={onNew}>
        <Plus size={16} strokeWidth={2.2} />
        <span className="hidden lg:inline">{mode === "prompt" ? t("action.new") : t("action.newLora")}</span>
      </button>
    </header>
  );
}
