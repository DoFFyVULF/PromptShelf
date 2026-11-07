import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, Check, ChevronDown, CornerDownLeft, Hash, Plus, X } from "lucide-react";
import { useI18n } from "../i18n";
import type { TagCount } from "../lib/types";

/** The store drops tags over 48 bytes; the editor has always capped at 32 chars. */
const MAX_CHARS = 32;
const MAX_BYTES = 48;
const MAX_ROWS = 60;
const MENU_MAX_H = 300;
const MENU_CHROME_H = 70;
const EASE = [0.32, 0.72, 0, 1] as const;

const clean = (v: string) => v.trim().replace(/^#/, "").trim();
const byteLen = (v: string) => new TextEncoder().encode(v).length;

type Row =
  | { kind: "tag"; name: string; count: number }
  | { kind: "create"; name: string }
  | { kind: "added"; name: string };

interface TagInputProps {
  id: string;
  tags: string[];
  onChange: (next: string[]) => void;
  /** Every tag already in this shelf, with usage counts. */
  suggestions: TagCount[];
  placeholder?: string;
}

/**
 * Chip field + combobox over the tags the shelf already knows. The menu is
 * portalled to <body> and flips above the field when the dialog's scroll area
 * leaves no room below, so it is never clipped by the panel.
 */
export function TagInput({ id, tags, onChange, suggestions, placeholder }: TagInputProps) {
  const { t } = useI18n();
  const reduce = useReducedMotion();

  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [tooLong, setTooLong] = useState(false);
  const [box, setBox] = useState({ left: 0, width: 0, top: 0, bottom: 0, up: false, maxH: MENU_MAX_H });

  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = `${id}-listbox`;

  // Case variants of one tag are stored as separate rows by the backend — fold
  // them into a single suggestion, keeping the spelling that is used the most.
  const pool = useMemo(() => {
    const folded = new Map<string, TagCount>();
    for (const s of suggestions) {
      const name = clean(s.name);
      if (!name) continue;
      const key = name.toLowerCase();
      const prev = folded.get(key);
      if (!prev) folded.set(key, { name, count: s.count });
      else folded.set(key, { name: s.count > prev.count ? name : prev.name, count: prev.count + s.count });
    }
    return [...folded.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [suggestions]);

  const addedKeys = useMemo(() => new Set(tags.map((x) => x.toLowerCase())), [tags]);
  const available = useMemo(() => pool.filter((tag) => !addedKeys.has(tag.name.toLowerCase())), [pool, addedKeys]);

  const query = clean(draft).toLowerCase();
  const matches = useMemo(() => {
    if (!query) return available;
    const prefix: TagCount[] = [];
    const inner: TagCount[] = [];
    for (const tag of available) {
      const n = tag.name.toLowerCase();
      if (!n.includes(query)) continue;
      (n.startsWith(query) ? prefix : inner).push(tag);
    }
    return [...prefix, ...inner];
  }, [available, query]);

  const rows = useMemo<Row[]>(() => {
    if (query && addedKeys.has(query)) {
      return [{ kind: "added", name: tags.find((x) => x.toLowerCase() === query) ?? query }];
    }
    const out: Row[] = matches.slice(0, MAX_ROWS).map((tag) => ({ kind: "tag", name: tag.name, count: tag.count }));
    if (query && !available.some((tag) => tag.name.toLowerCase() === query)) {
      out.push({ kind: "create", name: clean(draft) });
    }
    return out;
  }, [addedKeys, available, draft, matches, query, tags]);

  const idx = rows.length > 0 ? Math.min(Math.max(active, 0), rows.length - 1) : -1;
  const visible = open && rows.length > 0;

  const commit = useCallback(
    (raw: string) => {
      const v = clean(raw);
      if (!v) {
        setDraft("");
        return;
      }
      if (v.length > MAX_CHARS || byteLen(v) > MAX_BYTES) {
        setTooLong(true);
        return;
      }
      // reuse the stored spelling so typing "Anime" doesn't fork a new tag row
      const canonical = pool.find((tag) => tag.name.toLowerCase() === v.toLowerCase())?.name ?? v;
      if (!tags.some((x) => x.toLowerCase() === canonical.toLowerCase())) onChange([...tags, canonical]);
      setDraft("");
      setTooLong(false);
      setActive(0);
    },
    [onChange, pool, tags]
  );

  const accept = useCallback(
    (row: Row) => {
      commit(row.name);
      inputRef.current?.focus();
      setOpen(true);
    },
    [commit]
  );

  const measure = useCallback(() => {
    const el = fieldRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 10;
    const above = r.top - 10;
    const up = below < 170 && above > below;
    setBox({
      left: r.left,
      width: r.width,
      top: r.bottom + 7,
      bottom: window.innerHeight - r.top + 7,
      up,
      maxH: Math.max(132, Math.min(MENU_MAX_H, up ? above : below))
    });
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    measure();
    const el = fieldRef.current;
    const ro = el ? new ResizeObserver(measure) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [visible, measure]);

  // Chrome re-fires mousemove when rows shift under a stationary cursor (after
  // Enter, or when the list scrolls to the active row). Remembering the last
  // position — in a bubble listener that runs after the row's own handler —
  // lets those echoes be ignored instead of stealing the keyboard highlight.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const track = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", track);
    return () => window.removeEventListener("mousemove", track);
  }, []);

  // Registered once, on mount: child effects run before the host dialog's own
  // capture listener, so Esc dismisses the menu instead of the whole dialog.
  const openRef = useRef(open);
  openRef.current = visible;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !openRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // keep the highlighted row inside the menu's own scroll area only
  useEffect(() => {
    if (!visible) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-row="${idx}"]`);
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [idx, visible]);

  useEffect(() => setActive(0), [query]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!visible) setOpen(true);
      else setActive((i) => (i + 1) % rows.length);
      return;
    }
    if (e.key === "ArrowUp" && visible) {
      e.preventDefault();
      setActive((i) => (i - 1 + rows.length) % rows.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (visible && idx >= 0) accept(rows[idx]);
      else commit(draft);
      return;
    }
    if (e.key === "Tab" && visible && idx >= 0 && rows[idx].kind !== "added") {
      accept(rows[idx]);
      return;
    }
    if (e.key === ",") {
      e.preventDefault();
      commit(draft);
      return;
    }
    if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : {
        initial: { opacity: 0, y: box.up ? 8 : -8, scale: 0.985 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: box.up ? 6 : -6, scale: 0.985 },
        transition: { duration: 0.28, ease: EASE }
      };

  return (
    <>
      <div
        ref={fieldRef}
        className={`relative mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border bg-card px-2.5 py-2 transition-colors focus-within:shadow-focus ${
          tooLong ? "border-destructive/60" : "border-hairline focus-within:border-line-active"
        }`}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {tags.map((tag) => (
            <motion.span
              key={tag}
              layout={reduce ? false : "position"}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.88 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.88 }}
              transition={{ duration: reduce ? 0.12 : 0.26, ease: EASE }}
              className="flex items-center gap-1 rounded-full bg-parchment py-0.5 pr-1.5 pl-2.5 text-[12px] text-body"
            >
              {tag}
              <button
                type="button"
                aria-label={`${t("action.delete")}: ${tag}`}
                onClick={() => onChange(tags.filter((x) => x !== tag))}
                className="cursor-pointer rounded-full text-faint transition-colors hover:text-ink"
              >
                <X size={11} />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>

        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={visible}
          aria-controls={menuId}
          aria-autocomplete="list"
          aria-activedescendant={visible && idx >= 0 ? `${menuId}-${idx}` : undefined}
          autoComplete="off"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setTooLong(false);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onBlur={() => {
            commit(draft);
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
          placeholder={tags.length === 0 ? placeholder : ""}
          spellCheck={false}
          maxLength={MAX_CHARS}
          className="min-w-[110px] flex-1 border-0 bg-transparent py-1 text-[13px] outline-none placeholder:text-faint"
        />

        <button
          type="button"
          tabIndex={-1}
          aria-label={t("editor.tags.browse")}
          title={t("editor.tags.browse")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (visible) setOpen(false);
            else {
              inputRef.current?.focus();
              setOpen(true);
            }
          }}
          className="flex h-5.5 w-5.5 shrink-0 cursor-pointer items-center justify-center rounded-full text-faint transition-colors hover:bg-parchment hover:text-ink"
        >
          <ChevronDown
            size={13}
            className={`transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${visible ? "rotate-180" : ""}`}
          />
        </button>

        <span className="sr-only" aria-live="polite">
          {visible ? t("editor.tags.live", { n: rows.length }) : ""}
        </span>
      </div>

      {tooLong && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-destructive">
          <AlertCircle size={12.5} />
          {t("editor.tags.tooLong")}
        </p>
      )}

      {createPortal(
        <AnimatePresence>
          {visible && (
            <motion.div
              key="tag-menu"
              id={menuId}
              role="listbox"
              aria-label={t("editor.tags.suggestions")}
              {...motionProps}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest("[data-row]")) e.preventDefault();
              }}
              style={{
                position: "fixed",
                left: box.left,
                width: box.width,
                zIndex: 130,
                transformOrigin: box.up ? "bottom left" : "top left",
                ...(box.up ? { bottom: box.bottom } : { top: box.top })
              }}
              className="overflow-hidden rounded-card border border-hairline bg-card/95 shadow-tile-hover backdrop-blur-xl"
            >
              <div className="flex items-center gap-1.5 border-b border-line-soft px-3.5 py-2 text-[10.5px] font-semibold tracking-[0.07em] text-faint uppercase">
                <Hash size={11.5} />
                <span className="truncate">
                  {query
                    ? matches.length > 0
                      ? t("editor.tags.matches", { n: matches.length })
                      : t("editor.tags.noMatches")
                    : t("editor.tags.frequent")}
                </span>
              </div>

              <div
                ref={listRef}
                className="overflow-y-auto overscroll-contain px-1.5 py-1.5"
                style={{ maxHeight: Math.max(72, box.maxH - MENU_CHROME_H) }}
              >
                {rows.map((row, i) => {
                  const on = i === idx;
                  return (
                    <div
                      key={`${row.kind}-${row.name}`}
                      id={`${menuId}-${i}`}
                      data-row={i}
                      role="option"
                      aria-selected={on}
                      aria-disabled={row.kind === "added" || undefined}
                      onMouseMove={(e) => {
                        const p = pointer.current;
                        if (!p || (p.x === e.clientX && p.y === e.clientY)) return;
                        if (row.kind !== "added") setActive(i);
                      }}
                      onClick={() => row.kind !== "added" && accept(row)}
                      className={`flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 transition-colors duration-150 ${
                        row.kind === "added"
                          ? "cursor-default text-faint"
                          : `cursor-pointer ${on ? "bg-parchment text-ink" : "text-body"}`
                      }`}
                    >
                      {row.kind === "create" ? (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-hairline text-muted">
                          <Plus size={11} />
                        </span>
                      ) : row.kind === "added" ? (
                        <Check size={13} className="shrink-0 text-faint" />
                      ) : (
                        <Hash size={13} className={`shrink-0 ${on ? "text-muted" : "text-faint"}`} />
                      )}

                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {row.kind === "create" ? (
                          t("editor.tags.create", { name: row.name })
                        ) : row.kind === "tag" ? (
                          <Highlighted name={row.name} query={query} />
                        ) : (
                          row.name
                        )}
                      </span>

                      {row.kind === "added" ? (
                        <span className="shrink-0 text-[11px]">{t("editor.tags.added")}</span>
                      ) : (
                        <>
                          {on && <CornerDownLeft size={12.5} className="shrink-0 text-faint" />}
                          {row.kind === "tag" && (
                            <span
                              title={t("editor.tags.usage", { n: row.count })}
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] tabular-nums ${
                                on ? "bg-card text-muted" : "bg-parchment text-faint"
                              }`}
                            >
                              {row.count}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 border-t border-line-soft px-3.5 py-2 text-[10.5px] text-faint">
                <span className="flex shrink-0 items-center gap-1">
                  <kbd className="kbd">↑↓</kbd>
                  {t("editor.tags.nav")}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <kbd className="kbd">⏎</kbd>
                  {t("editor.tags.accept")}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <kbd className="kbd">esc</kbd>
                  {t("editor.tags.dismiss")}
                </span>
                {matches.length > MAX_ROWS && (
                  <span className="ml-auto truncate">{t("editor.tags.more", { n: matches.length - MAX_ROWS })}</span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

/** Ink on the matched slice, body colour on the rest — no highlighter fill. */
function Highlighted({ name, query }: { name: string; query: string }) {
  if (!query) return <>{name}</>;
  const lower = name.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(query, i);
    if (at === -1) {
      if (i < name.length) parts.push(name.slice(i));
      break;
    }
    if (at > i) parts.push(name.slice(i, at));
    parts.push(
      <mark key={at} className="bg-transparent font-semibold text-ink">
        {name.slice(at, at + query.length)}
      </mark>
    );
    i = at + query.length;
  }
  return <>{parts}</>;
}