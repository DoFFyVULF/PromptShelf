import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeftRight, Check, Hash, Search, Tag, X } from "lucide-react";
import { useI18n } from "../i18n";
import type { TagCount } from "../lib/types";

interface TagsDialogProps {
  open: boolean;
  onClose: () => void;
  tags: TagCount[];
  selected: string[];
  matchAll: boolean;
  onMatchAllChange: (matchAll: boolean) => void;
  onToggle: (tag: string) => void;
  onClear: () => void;
}

const EASE = [0.32, 0.72, 0, 1] as const;

export function TagsDialog(props: TagsDialogProps) {
  return <AnimatePresence>{props.open && <TagsPanel key="tags" {...props} />}</AnimatePresence>;
}

function TagsPanel({ onClose, tags, selected, matchAll, onMatchAllChange, onToggle, onClear }: TagsDialogProps) {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedNames = useMemo(() => new Set(selected), [selected]);
  const search = query.trim().toLocaleLowerCase();
  const filteredTags = useMemo(
    () => tags.filter((tag) => tag.name.toLocaleLowerCase().includes(search)),
    [tags, search],
  );

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    inputRef.current?.focus();
    return () => {
      dialog.close();
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [search]);

  const clearSearch = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <dialog
      ref={dialogRef}
      className="tags-modal"
      aria-labelledby="tags-title"
      aria-describedby="tags-description"
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <motion.div
        className="absolute inset-0 bg-zinc-950/35"
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduce ? 0.12 : 0.3 }}
        onClick={onClose}
      />
      <motion.div
        className="tags-panel"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.975 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }}
        transition={{ duration: reduce ? 0.12 : 0.45, ease: EASE }}
      >
        <header className="tags-header">
          <div className="tags-emblem" aria-hidden="true"><Tag size={21} strokeWidth={1.6} /></div>
          <div className="min-w-0 flex-1">
            <h2 id="tags-title" className="t-display text-[24px] leading-tight tracking-[-0.035em]">{t("tags.title")}</h2>
            <p id="tags-description" className="mt-1.5 text-[13px] leading-relaxed text-muted">{t("tags.description")}</p>
          </div>
          <button type="button" className="tags-close press" aria-label={t("action.close")} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="tags-search">
          <Search size={17} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            aria-label={t("tags.search")}
            placeholder={t("tags.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button type="button" className="tags-search-clear press" onClick={clearSearch} aria-label={t("tags.clearSearch")}>
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="tags-selection">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-semibold text-body">{t("tags.selected", { n: selected.length })}</span>
            <button
              type="button"
              className="tags-reset press"
              disabled={selected.length === 0}
              onClick={() => {
                onClear();
                inputRef.current?.focus();
              }}
            >{t("action.clear")}</button>
          </div>
          <div className="tags-selected-chips">
            {selected.length === 0 && <p className="py-2 text-[12px] leading-5 text-muted">{t("tags.selectionHint")}</p>}
            <AnimatePresence initial={false} mode="popLayout">
              {selected.map((name) => (
                <motion.button
                  key={name}
                  type="button"
                  layout={reduce ? false : "position"}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
                  transition={{ duration: reduce ? 0.12 : 0.32, ease: EASE }}
                  whileTap={reduce ? undefined : { scale: 0.96 }}
                  className="tags-selected-chip press-bg"
                  aria-label={t("tags.remove", { name })}
                  onClick={() => {
                    onToggle(name);
                    inputRef.current?.focus();
                  }}
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
                  <X size={12} className="shrink-0 opacity-70" aria-hidden="true" />
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="tags-list-heading">
          <h3>{search ? t("tags.matches") : t("tags.browse")}</h3>
          <span className="tabular-nums text-muted" aria-live="polite" aria-atomic="true">
            {t("tags.available", { n: filteredTags.length })}
          </span>
        </div>
        <div ref={listRef} className="tags-list">
          {filteredTags.length > 0 ? (
            <ul className="tags-grid" aria-label={t("tags.browse")}>
              {filteredTags.map((tag) => {
                const active = selectedNames.has(tag.name);
                return (
                  <li key={tag.name}>
                    <motion.button
                      type="button"
                      onClick={() => onToggle(tag.name)}
                      aria-pressed={active}
                      className={`tags-row press-bg ${active ? "is-selected" : ""}`}
                      whileTap={reduce ? undefined : { scale: 0.98 }}
                      transition={{ duration: 0.2, ease: EASE }}
                    >
                      <Hash size={15} className="shrink-0 text-muted" aria-hidden="true" />
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{tag.name}</span>
                      <span className="tags-usage" title={t("editor.tags.usage", { n: tag.count })}>{tag.count}</span>
                      <span className="tags-check" aria-hidden="true">
                        <motion.span
                          className="flex"
                          initial={false}
                          animate={{ opacity: active ? 1 : 0, scale: reduce ? 1 : active ? 1 : 0.6 }}
                          transition={{ duration: reduce ? 0.12 : 0.25, ease: EASE }}
                        ><Check size={12} strokeWidth={2.5} /></motion.span>
                      </span>
                    </motion.button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="tags-empty">
              <div className="tags-emblem" aria-hidden="true">{tags.length ? <Search size={23} strokeWidth={1.5} /> : <Tag size={23} strokeWidth={1.5} />}</div>
              <p className="mt-4 text-[15px] font-semibold text-ink">{tags.length ? t("empty.noResults") : t("tags.empty")}</p>
              <p className="mt-1.5 max-w-[270px] text-[13px] leading-relaxed text-muted">{tags.length ? t("tags.noMatchesHint") : t("tags.emptyHint")}</p>
              {query && <button type="button" className="tags-reset press mt-2" onClick={clearSearch}>{t("tags.clearSearch")}</button>}
            </div>
          )}
        </div>

        <footer className="tags-footer">
          <div className="min-w-0">
            {selected.length ? (
              <motion.button
                type="button"
                role="switch"
                aria-checked={matchAll}
                aria-label={t("tags.requireAll")}
                title={t(matchAll ? "tags.switchToAny" : "tags.switchToAll")}
                className="tags-match-mode press-bg"
                onClick={() => onMatchAllChange(!matchAll)}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <ArrowLeftRight size={14} className="shrink-0" aria-hidden="true" />
                <span className="tags-match-label" aria-hidden="true">
                  <span className="tags-match-sizer">{t("tags.matchAny")}</span>
                  <span className="tags-match-sizer">{t("tags.matchAll")}</span>
                  <AnimatePresence initial={false}>
                    <motion.span
                      key={String(matchAll)}
                      initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: reduce ? 0 : -4 }}
                      transition={{ duration: reduce ? 0.12 : 0.25, ease: EASE }}
                    >{t(matchAll ? "tags.matchAll" : "tags.matchAny")}</motion.span>
                  </AnimatePresence>
                </span>
              </motion.button>
            ) : <p className="text-[12px] leading-5 text-muted">{t("tags.unfiltered")}</p>}
          </div>
          <button type="button" className="btn-primary press shrink-0" onClick={onClose}>{t("select.done")}</button>
        </footer>
      </motion.div>
    </dialog>
  );
}
