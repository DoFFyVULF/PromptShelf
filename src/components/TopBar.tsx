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

/** Word/label swaps are soft blur-crossfades; size/position changes ride on
 * `layout`, so the header glides instead of snapping when the mode flips.
 * Layout-animated buttons use `press-bg` + whileTap: a CSS transform
 * transition would fight Motion's per-frame transform writes. */
const LABEL_TWEEN = { duration: 0.26, ease: [0.32, 0.72, 0, 1] } as const;
const LAYOUT_SPRING = { type: "spring", stiffness: 520, damping: 40, mass: 1 } as const;
const REDUCE_TWEEN = { duration: 0.12, ease: "easeOut" } as const;
/** The logo roll: slow, matched easing on enter AND exit so the two words
 * move as one conveyor — the new word visibly pushes the old one out.
 * Travel is 150%: far enough that a word fully clears the ±10% clip window
 * (108% would leave its tail inside the window, popping out of existence). */
const WORD_ROLL_TWEEN = { duration: 0.52, ease: [0.32, 0.72, 0, 1] } as const;

const WORD_ROLL_VARIANTS = {
  enter: (dir: Mode) => ({ y: dir === "lora" ? "150%" : "-150%" }),
  center: { y: "0%" },
  exit: (dir: Mode) => ({ y: dir === "lora" ? "-150%" : "150%" }),
};

function SwappableLabel({ show, text, reduce, className = "" }: { show: boolean; text: string; reduce: boolean; className?: string }) {
  return (
    <motion.span layout={reduce ? false : true} className={`relative inline-block ${show ? "" : "hidden"} ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        {show && (
          <motion.span
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 5 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -5 }}
            transition={reduce ? REDUCE_TWEEN : LABEL_TWEEN}
            className="inline-block whitespace-nowrap"
          >
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.span>
  );
}

export function TopBar({ mode, onToggleMode, query, onQuery, sort, onSort, onNew, onImportCivitai, onSettings }: TopBarProps) {
  const { t } = useI18n();
  const reduce = useReducedMotion() ?? false;
  const layout = reduce ? false : true;

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
            {/* clip-path, not overflow-hidden: keeps the inline-block baseline.
                The window hugs the word box (±10% slack for glyph overflow), so
                both roll directions slice words out at the edges instead of
                leaving them stranded outside. */}
            <motion.span
              layout={layout}
              style={{ clipPath: "inset(-10% 0 -10% 0)" }}
              className="relative inline-block"
            >
              <AnimatePresence mode="popLayout" initial={false} custom={mode}>
                <motion.span
                  key={mode}
                  custom={mode}
                  variants={WORD_ROLL_VARIANTS}
                  initial={reduce ? { opacity: 0 } : "enter"}
                  animate={reduce ? { opacity: 1 } : "center"}
                  exit={reduce ? { opacity: 0 } : "exit"}
                  transition={reduce ? REDUCE_TWEEN : WORD_ROLL_TWEEN}
                  className={`wordmark-word inline-block whitespace-nowrap ${mode === "lora" ? "text-action" : ""}`}
                >
                  {/* brand wordmark — deliberately not localized, like "Shelf" */}
                  {mode === "prompt" ? "Prompt" : "Lora"}
                </motion.span>
              </AnimatePresence>
            </motion.span>
            <motion.span layout={layout} className="inline-block text-faint">
              Shelf
            </motion.span>
          </span>
        </button>
      </div>

      <motion.div layout={layout} transition={LAYOUT_SPRING} className="group relative ml-2 w-[300px] max-w-[34vw]">
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
      </motion.div>

      <div className="flex-1" />

      <motion.div layout={layout} transition={LAYOUT_SPRING} className="relative">
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
      </motion.div>

      <motion.button
        type="button"
        layout={layout}
        transition={LAYOUT_SPRING}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        className="btn-icon press-bg cursor-pointer"
        aria-label={t("nav.settings")}
        onClick={onSettings}
      >
        <Settings2 size={17} />
      </motion.button>

      <motion.button
        type="button"
        layout={layout}
        transition={LAYOUT_SPRING}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        className="btn-ghost press-bg cursor-pointer"
        aria-label={mode === "prompt" ? t("import.civitai") : t("import.lora")}
        title={mode === "prompt" ? t("import.civitai") : t("import.lora")}
        onClick={onImportCivitai}
      >
        <CloudDownload size={15.5} strokeWidth={2} />
        <SwappableLabel show className="hidden lg:inline-block" reduce={reduce} text={mode === "prompt" ? t("import.civitai") : t("import.lora")} />
      </motion.button>

      <motion.button
        type="button"
        layout={layout}
        transition={LAYOUT_SPRING}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        className="btn-primary press-bg cursor-pointer"
        onClick={onNew}
      >
        <Plus size={16} strokeWidth={2.2} />
        <SwappableLabel show className="hidden lg:inline-block" reduce={reduce} text={mode === "prompt" ? t("action.new") : t("action.newLora")} />
      </motion.button>
    </header>
  );
}
