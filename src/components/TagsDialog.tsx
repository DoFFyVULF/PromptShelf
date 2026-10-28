import { useCallback, useMemo, useRef, useState } from "react";
import { Search, Tag, X } from "lucide-react";
import { useI18n } from "../i18n";
import type { TagCount } from "../lib/types";
import { Dialog, DialogCloseButton } from "./Dialog";

interface TagsDialogProps {
  open: boolean;
  onClose: () => void;
  tags: TagCount[];
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}

export function TagsDialog({ open, onClose, tags, selected, onToggle, onClear }: TagsDialogProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredTags = useMemo(
    () => tags.filter((tag) => tag.name.toLowerCase().includes(query.trim().toLowerCase())),
    [tags, query]
  );

  const hasSelected = selected.length > 0;
  const total = tags.length;

  const handleClear = useCallback(() => {
    onClear();
    setQuery("");
  }, [onClear]);

  return (
    <Dialog open={open} onClose={onClose} labelledBy="tags-title" width={780}>
      <div className="flex max-h-[460px] flex-col">
        {/* header */}
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
          <div className="flex items-center gap-2">
            <Tag size={15} className="text-faint" />
            <h2 id="tags-title" className="t-display text-[15px]">
              {t("tags.title")}
            </h2>
            <span className="rounded-full bg-parchment px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted">
              {total}
            </span>
          </div>
          <DialogCloseButton onClose={onClose} label={t("action.close")} />
        </div>

        {/* search + actions */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center gap-2.5">
            <div className="relative flex-1">
              <Search
                size={14.5}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search.placeholder")}
                className="h-9 w-full rounded-[10px] border border-hairline bg-card pl-10 pr-3 text-[13.5px] transition-colors placeholder:text-faint hover:border-zinc-300 focus:border-zinc-400 focus:outline-none focus:shadow-[0_0_0_3px_rgb(24_24_27/0.06)]"
                autoFocus
              />
            </div>
            {hasSelected && (
              <button
                type="button"
                onClick={handleClear}
                className="press flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-card px-3 text-[12.5px] font-medium text-body transition-colors hover:bg-parchment"
              >
                <span>{t("tags.all")}</span>
                <X size={13.5} className="text-faint" />
              </button>
            )}
          </div>

          {/* selected chips */}
          {hasSelected && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {selected.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggle(tag)}
                  className="press flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[11.5px] font-medium text-white transition-colors hover:opacity-85"
                >
                  <span className="max-w-[140px] truncate">{tag}</span>
                  <X size={11.5} className="shrink-0 opacity-70" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* tag grid */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {filteredTags.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-8 text-center">
              <Tag size={26} className="mb-2 text-faint" />
              <p className="text-[12.5px] text-faint">{t("empty.noResults")}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
              {filteredTags.map((tag) => {
                const active = selected.includes(tag.name);
                return (
                  <li key={tag.name}>
                    <button
                      type="button"
                      onClick={() => onToggle(tag.name)}
                      aria-pressed={active}
                      className={`press flex w-full items-center justify-between rounded-[10px] border px-2.5 py-2 text-[12.5px] transition-colors ${
                        active
                          ? "border-transparent bg-ink text-white"
                          : "border border-hairline bg-card text-body hover:bg-parchment"
                      }`}
                    >
                      <span className="truncate">{tag.name}</span>
                      <span
                        className={`shrink-0 pl-2 text-[10.5px] tabular-nums ${
                          active ? "opacity-70" : "text-faint"
                        }`}
                      >
                        {tag.count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
