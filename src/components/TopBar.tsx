import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { MotionValue } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  updateAvailable: boolean;
  onUpdateOpen: () => void;
}

/** Word/label swaps are soft blur-crossfades; size/position changes ride on
 * `layout`, so the header glides instead of snapping when the mode flips.
 * The logo rolls only its word vertically while the slot width tweens and
 * "Shelf" rides along in flow. The width is a plain motion value and every word
 * fills the slot via a computed `scaleX = slot/word` — the same edge-to-edge
 * look `layout` projection gives in dev, but deterministic: projection measures
 * the DOM, and in release builds (fast commits, WKWebView/WebView2) it measured
 * mid-flight and produced the indent/stretch artifacts. A center-origin press
 * scale would read as the logo jumping right, so the button has no press
 * transform at all — the roll is the press feedback. */
const LABEL_TWEEN = { duration: 0.26, ease: [0.32, 0.72, 0, 1] } as const;
const LAYOUT_SPRING = { type: "spring", stiffness: 520, damping: 40, mass: 1 } as const;
const REDUCE_TWEEN = { duration: 0.12, ease: "easeOut" } as const;
/** The logo roll: one strip holding both words, slid by exactly one slot.
 * Nothing mounts or unmounts, so the words cannot "disappear" mid-toggle —
 * the cells tile the window at every frame. Kept brisk: a longer tween reads
 * as sluggish because the squish/stretch holds attention. */
const WORD_ROLL_TWEEN = { duration: 0.35, ease: [0.32, 0.72, 0, 1] } as const;

/** Every word fills the slot edge to edge while its width tweens: scaleX is
 * derived from the slot width and the word's own measured width, so no layout
 * measurement is ever needed mid-animation. */
function useFillWindow(slot: MotionValue<number>, word: string, onWidth: (word: string, px: number) => void) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const wordWidth = useMotionValue(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => {
      wordWidth.jump(el.offsetWidth);
      onWidth(word, el.offsetWidth);
    };
    report();
    document.fonts.ready.then(report);
  }, []);
  const scaleX = useTransform([slot, wordWidth], (latest) => {
    const [s, w] = latest as [number, number];
    return w ? s / w : 1;
  });
  return { ref, scaleX };
}

function SlotCell({
  word,
  slot,
  onWidth,
  className = "",
}: {
  word: string;
  slot: MotionValue<number>;
  onWidth: (word: string, px: number) => void;
  className?: string;
}) {
  const { ref, scaleX } = useFillWindow(slot, word, onWidth);
  return (
    <motion.span
      ref={ref}
      data-word={word}
      style={{ scaleX, transformOrigin: "left center" }}
      className={`block h-4 whitespace-nowrap leading-none ${className}`}
    >
      {word}
    </motion.span>
  );
}

/** The update tease: a real slot drum. Instead of swapping single words, a
 * continuous strip of Prompt/Lora/Update cells scrolls through the window —
 * neighbours are visible mid-pull — decelerating pull by pull, until the last
 * pull overshoots past the Update slot (the next Prompt peeks in from below)
 * and Update eases back down into place. */
const DRUM_CYCLE = ["Prompt", "Lora", "Update"] as const;
const DRUM_SLOT = 16; // px, one cell — matches text-[16px] leading-none
const DRUM_OVERSHOOT = 5; // px past the final slot, the near-miss peek
const DRUM_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

interface DrumStrip {
  words: string[];
  keys: number[];
  times: number[];
  eases: ([number, number, number, number] | "easeOut")[];
  total: number;
}

function buildDrum(mode: Mode): DrumStrip {
  // the strip starts at the currently shown word, so mounting the drum is
  // seamless, and always ends on the third Update
  const words: string[] = [mode === "lora" ? "Lora" : "Prompt"];
  let i = DRUM_CYCLE.indexOf(words[0] as (typeof DRUM_CYCLE)[number]) + 1;
  let updates = 0;
  for (; updates < 3; i++) {
    const w = DRUM_CYCLE[i % 3];
    if (w === "Update") updates += 1;
    words.push(w);
  }
  // the drum parks on the last Update — count the pulls before appending the
  // peek cell below it, which the strip never scrolls to
  const n = words.length - 1;
  words.push(DRUM_CYCLE[i % 3]);
  const keys: number[] = [0];
  const durs: number[] = [];
  const eases: DrumStrip["eases"] = [];
  for (let p = 0; p < n; p++) {
    if (p < n - 1) {
      // quadratic slowdown: brisk pulls first, lazier ones towards the end
      durs.push(0.26 + 0.4 * Math.pow(p / Math.max(1, n - 2), 2));
      eases.push(DRUM_EASE);
      keys.push(-(p + 1) * DRUM_SLOT);
    } else {
      // the final pull runs past the Update slot, then eases back into it
      durs.push(0.72, 0.3);
      eases.push("easeOut", DRUM_EASE);
      keys.push(-(n * DRUM_SLOT) - DRUM_OVERSHOOT, -(n * DRUM_SLOT));
    }
  }
  const total = durs.reduce((a, b) => a + b, 0);
  const times: number[] = [];
  let at = 0;
  for (const d of durs) {
    times.push(at / total);
    at += d;
  }
  times.push(1);
  return { words, keys, times, eases, total };
}

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

export function TopBar({ mode, onToggleMode, query, onQuery, sort, onSort, onNew, onImportCivitai, onSettings, updateAvailable, onUpdateOpen }: TopBarProps) {
  const { t } = useI18n();
  const reduce = useReducedMotion() ?? false;
  const layout = reduce ? false : true;

  // The drum is mounted for the whole life of the badge: it spins once when
  // the update appears and stays parked on the final Update slot; dismissing
  // it unmounts, so it replays when the badge returns.
  const drum = useMemo(() => (updateAvailable && !reduce ? buildDrum(mode) : null), [updateAvailable, reduce, mode]);

  // While an update is pending the wordmark slot shows "Update" and clicking
  // the logo opens the update dialog.
  const label = updateAvailable ? "Update" : mode === "prompt" ? "Prompt" : "Lora";
  // Index of the active word in the resting strip (the drum has its own strip).
  const roll = updateAvailable ? 2 : mode === "lora" ? 1 : 0;

  // The slot width tweens between word widths; "Shelf" sits in flow right
  // after it, so it glides instead of jumping. Words report their measured
  // width once (and again after webfonts settle).
  const slot = useMotionValue(0);
  const widths = useRef<Record<string, number>>({});
  const windowRef = useRef<HTMLSpanElement | null>(null);
  const slotted = useRef(false);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let on = true;
    document.fonts.ready.then(() => {
      if (on) setFontsReady(true);
    });
    return () => {
      on = false;
    };
  }, []);
  useLayoutEffect(() => {
    // Cells report their widths from their own layout effects; measuring the
    // active cell directly is the safety net for the first commit in a
    // production build, where a missed report must never leave the window at
    // width 0 (which would hide the whole word).
    const measured =
      widths.current[label] ??
      windowRef.current?.querySelector<HTMLElement>(`[data-word="${label}"]`)?.offsetWidth;
    if (!measured) return;
    if (!slotted.current || reduce) {
      slotted.current = true;
      slot.jump(measured);
    } else {
      animate(slot, measured, WORD_ROLL_TWEEN);
    }
  }, [label, reduce, fontsReady]);
  const onWidth = (word: string, px: number) => {
    widths.current[word] = px;
  };

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-canvas/85 px-4 backdrop-blur-xl">
      <div className="pr-1">
        <button
          type="button"
          onClick={updateAvailable ? onUpdateOpen : onToggleMode}
          aria-label={updateAvailable ? t("settings.updates.badge") : t("app.mode.toggle")}
          title={updateAvailable ? t("settings.updates.badge") : t("app.mode.toggle")}
          className="group flex cursor-pointer items-baseline rounded-md outline-offset-4"
        >
          <span className="wordmark flex items-baseline text-[16px] leading-none text-ink">
            {/* clip-path, not overflow-hidden: keeps the inline-block baseline.
                The window is exactly one line tall and clipped flush: any
                vertical slack would leave the neighbouring word's descenders
                (the "p" of Prompt) peeking through as dots at the edge. */}
            <motion.span
              ref={windowRef}
              style={{ width: slot, clipPath: "inset(0)" }}
              className="relative inline-block h-4 text-left"
            >
              {/* invisible line box: gives the inline-block its baseline */}
              <span aria-hidden className="invisible">
                &nbsp;
              </span>
              <span className="absolute top-0 left-0 flex flex-col items-start">
                {drum ? (
                  <motion.span
                    aria-hidden
                    className="flex flex-col items-start"
                    initial={false}
                    animate={{ y: drum.keys }}
                    transition={{ duration: drum.total, times: drum.times, ease: drum.eases }}
                  >
                    {drum.words.map((w, i) => (
                      <SlotCell
                        key={i}
                        word={w}
                        slot={slot}
                        onWidth={onWidth}
                        className={w === "Update" ? "text-action" : ""}
                      />
                    ))}
                  </motion.span>
                ) : (
                  <motion.span
                    aria-hidden
                    className="flex flex-col items-start"
                    initial={false}
                    animate={{ y: -roll * DRUM_SLOT }}
                    transition={reduce ? REDUCE_TWEEN : WORD_ROLL_TWEEN}
                  >
                    <SlotCell word="Prompt" slot={slot} onWidth={onWidth} className="wordmark-word" />
                    <SlotCell word="Lora" slot={slot} onWidth={onWidth} className="wordmark-word text-action" />
                    <SlotCell word="Update" slot={slot} onWidth={onWidth} className="wordmark-word text-action" />
                  </motion.span>
                )}
              </span>
            </motion.span>
            {/* brand wordmark tail — deliberately not localized */}
            <span className="inline-block text-faint">Shelf</span>
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
          className="h-9 w-full rounded-full border border-hairline bg-card pr-10 pl-9.5 text-[13.5px] transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] placeholder:text-faint hover:border-line-hover focus:border-line-active focus:shadow-focus focus:outline-none"
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
