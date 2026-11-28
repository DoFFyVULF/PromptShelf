import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ChevronDown,
  GitBranch,
  Layers,
  Star,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n, type DictKey } from "../i18n";
import type { Mode, Sort } from "../lib/types";

const EASE = [0.32, 0.72, 0, 1] as const;
/** One width for the trigger and the panel, so the menu opens exactly over the
 *  control. It is set by the widest row — the longest order label
 *  (ru: "Больше вариантов") plus its leading glyph — and leaves the trigger's
 *  centred label even air on both sides. */
const CONTROL_W = 200;
const GAP = 7;
const EDGE = 8;

interface SortChoice {
  value: Sort;
  label: DictKey;
  hint: DictKey;
  icon: LucideIcon;
}

const CORE: SortChoice[] = [
  { value: "newest", label: "sort.newest", hint: "sort.newest.hint", icon: ArrowDownWideNarrow },
  { value: "oldest", label: "sort.oldest", hint: "sort.oldest.hint", icon: ArrowUpNarrowWide },
  { value: "rating", label: "sort.rating", hint: "sort.rating.hint", icon: Star },
];

/** Shelf-specific modes that the other shelf cannot express. Most variants
 *  orders the prompt shelf; with workflow narrows it to cards carrying a
 *  ComfyUI graph; most versions orders the lora shelf. */
const DEPTH: Record<Mode, SortChoice[]> = {
  prompt: [
    {
      value: "variants",
      label: "sort.variants",
      hint: "sort.variants.hint",
      icon: Layers,
    },
    {
      value: "workflow",
      label: "sort.workflow",
      hint: "sort.workflow.hint",
      icon: Workflow,
    },
  ],
  lora: [
    {
      value: "versions",
      label: "sort.versions",
      hint: "sort.versions.hint",
      icon: GitBranch,
    },
  ],
};

interface SortMenuProps {
  mode: Mode;
  sort: Sort;
  onSort: (sort: Sort) => void;
}

/**
 * The shelf order control. A native <select> would drop the platform menu into
 * a carefully quiet header, so this is a small anchored field with a compact
 * panel instead: the trigger keeps the header pill grammar — one stable width,
 * the order glyph and chevron on the edges, the label centred between them —
 * and the panel, exactly as wide as the trigger, lists every order as a
 * single-line row. Shelf-specific modes only appear on the shelf that can
 * honour them: prompt variants and workflow on the prompt shelf, lora versions
 * on the lora shelf.
 *
 * The panel is portalled to <body> because the header's backdrop blur makes it
 * a containing block — a fixed child would be positioned against the 56px bar.
 * Keyboard: ↑/↓ move, Home/End jump, Enter/Space pick, Esc/Tab close.
 */
export function SortMenu({ mode, sort, onSort }: SortMenuProps) {
  const { t } = useI18n();
  const reduce = useReducedMotion() ?? false;
  const menuId = useId();

  const options = [...CORE, ...DEPTH[mode]];
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === sort),
  );
  const current = options[selectedIndex];

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selectedIndex);
  const [box, setBox] = useState({ left: 0, top: 0, up: false });

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // The trigger sits in the header, which never scrolls (only <main> does), so
  // the panel only has to follow a resize. It flips above when the space below
  // is tighter than the panel itself.
  const measure = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const height = panelRef.current?.offsetHeight ?? 0;
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const up = height > 0 && height > below && above > below;
    setBox({
      left: Math.max(EDGE, Math.min(r.right - CONTROL_W, window.innerWidth - CONTROL_W - EDGE)),
      top: up ? Math.max(EDGE, r.top - GAP - height) : r.bottom + GAP,
      up,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, measure]);

  // A pointer anywhere outside the trigger or the panel dismisses the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  // Focus leaving the control dismisses the menu (⌘F, a dialog, Tab…). This is
  // a document-level `focusin` rather than the panel's `onBlur`: WebKit reports
  // a null `relatedTarget` when focus moves back to the trigger, which closed
  // the menu before the click and made the same click re-open it.
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  // Esc closes even when focus sits on the trigger (a mouse-opened menu keeps
  // it there for a moment); the menu's own handler covers the focused-row case.
  // Capture + stop: the shelf's global Esc handler must not also act on it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const focused = document.activeElement;
      if (
        !panelRef.current?.contains(focused) &&
        !buttonRef.current?.contains(focused)
      ) {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
      requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // Opening moves focus onto the current order, so arrow keys and Enter work
  // immediately — no extra Tab.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[selectedIndex]?.focus({ preventScroll: true });
  }, [open, selectedIndex]);

  const openMenu = () => {
    setActive(selectedIndex);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  };

  const choose = (value: Sort) => {
    onSort(value);
    close();
  };

  const focusItem = (index: number) => {
    setActive(index);
    itemRefs.current[index]?.focus({ preventScroll: true });
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem((active + 1) % options.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem((active - 1 + options.length) % options.length);
        break;
      case "Home":
        e.preventDefault();
        focusItem(0);
        break;
      case "End":
        e.preventDefault();
        focusItem(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(options[active].value);
        break;
      case "Tab":
        e.preventDefault();
        close();
        break;
      default:
        break;
    }
  };

  const CurrentIcon = current.icon;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${t("sort.label")}: ${t(current.label)}`}
        title={t("sort.label")}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openMenu();
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open ? close() : openMenu();
          }
        }}
        className={`press flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border pr-3 pl-3.5 text-[13.5px] font-medium text-body outline-none transition-colors duration-200 ${
          open
            ? "border-line-active bg-parchment"
            : "border-hairline hover:border-line-hover"
        } focus-visible:border-line-active focus-visible:shadow-focus`}
        style={{ width: CONTROL_W }}
      >
        <CurrentIcon
          size={14}
          strokeWidth={2}
          className={open ? "text-action" : "text-faint"}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-center">{t(current.label)}</span>
        <ChevronDown
          size={13}
          aria-hidden
          className={`shrink-0 text-faint transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              id={menuId}
              role="menu"
              aria-label={t("sort.label")}
              // The menu unfurls out of its trigger like the Dock collapsing an
              // app: `scaleY` grows the panel from the right edge it shares with
              // the button that opened it.
              initial={
                reduce
                  ? { opacity: 0 }
                  : { opacity: 0, scaleY: box.up ? 0.25 : 0.55 }
              }
              animate={
                reduce
                  ? { opacity: 1 }
                  : { opacity: 1, scaleY: 1 }
              }
              exit={
                reduce
                  ? { opacity: 0 }
                  : {
                      opacity: 0,
                      scaleY: 0.35,
                      transition: { type: "tween", duration: 0.12, ease: EASE },
                    }
              }
              transition={
                reduce
                  ? { duration: 0.12, ease: EASE }
                  : { type: "spring", stiffness: 520, damping: 30, mass: 0.85 }
              }
              onKeyDown={onMenuKeyDown}
              style={{
                position: "fixed",
                left: box.left,
                top: box.top,
                width: CONTROL_W,
                maxHeight: "calc(100vh - 16px)",
                zIndex: 130,
                transformOrigin: box.up ? "bottom right" : "top right",
              }}
              className="overflow-x-hidden overflow-y-auto overscroll-contain rounded-[16px] border border-hairline bg-card/95 p-1.5 shadow-tile-hover backdrop-blur-xl"
            >
              {options.map((option, i) => {
                const selected = option.value === sort;
                const Icon = option.icon;
                return (
                  <Fragment key={option.value}>
                    {i === CORE.length && (
                      <div className="my-1.5 h-px bg-line-soft" aria-hidden />
                    )}
                    <button
                      ref={(el) => {
                        itemRefs.current[i] = el;
                      }}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      title={t(option.hint)}
                      tabIndex={i === active ? 0 : -1}
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onClick={() => choose(option.value)}
                      className={`flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 text-left outline-none transition-colors duration-150 ${
                        selected ? "bg-parchment" : "hover:bg-parchment/70"
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ${
                          selected ? "bg-action/10 text-action" : "bg-parchment text-muted"
                        }`}
                        aria-hidden
                      >
                        {selected ? (
                          // The check lives in the leading chip, mac-style: the
                          // row keeps one fixed column, the order glyph is still
                          // on the trigger, and no trailing gutter has to be
                          // reserved — so the panel can be as wide as the pill.
                          <Check size={13.5} strokeWidth={2.6} />
                        ) : (
                          <Icon size={14} strokeWidth={2} />
                        )}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] font-medium ${
                          selected ? "text-ink" : "text-body"
                        }`}
                      >
                        {t(option.label)}
                      </span>
                    </button>
                  </Fragment>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
