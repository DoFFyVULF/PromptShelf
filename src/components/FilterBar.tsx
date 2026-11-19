import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Folder, Layers, ListChecks, Tag, X } from "lucide-react";
import { useI18n } from "../i18n";
import { isAllGroups } from "../lib/groups";
import { groupColorVar } from "../lib/groupStyle";
import type { GroupInfo, TagCount } from "../lib/types";
import { GroupGlyph } from "./GroupGlyph";

interface FilterBarProps {
  tags: TagCount[];
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
  shown: number;
  filtering: boolean;
  group: GroupInfo | null;
  onOpenGroups: () => void;
  /** Whether the groups panel is currently open (for the chip's ARIA state). */
  groupsOpen?: boolean;
  onOpenTags: () => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  /** Lora shelf: pluralised count words differ. */
  lora?: boolean;
}

export function FilterBar({
  tags,
  selected,
  onToggle,
  onClear,
  shown,
  filtering,
  group,
  onOpenGroups,
  groupsOpen,
  onOpenTags,
  selectMode,
  onToggleSelectMode,
  lora
}: FilterBarProps) {
  const { t, count } = useI18n();
  const reduceMotion = useReducedMotion();
  const hasTagsFilter = selected.length > 0;
  const allScope = group ? isAllGroups(group.id) : false;

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-line-soft px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button
        type="button"
        data-groups-trigger
        onClick={onOpenGroups}
        title={allScope ? t("groups.allHint") : t("groups.title")}
        aria-haspopup="dialog"
        aria-expanded={groupsOpen}
        className="press flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-card py-0 pr-2.5 pl-3 text-[12.5px] font-medium text-body outline-none transition-colors hover:bg-parchment focus-visible:shadow-focus"
      >
        {/* The scope swap is a tiny crossfade — enough to register the change
            from a folder to the whole shelf without drawing attention. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={allScope ? "all" : "group"}
            initial={reduceMotion ? false : { opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: reduceMotion ? 0 : 0.14, ease: "easeOut" }}
            className="flex min-w-0 items-center gap-1.5"
          >
            {allScope ? (
              <Layers size={13} className="shrink-0 text-faint" />
            ) : (
              <span className="flex shrink-0 text-faint">
                <GroupGlyph group={group} size={13} fallback={<Folder size={13} />} />
              </span>
            )}
            <span
              className="max-w-[160px] truncate"
              style={!allScope && group?.color ? { color: groupColorVar(group.color) } : undefined}
            >
              {group?.name ?? t("group.home")}
            </span>
          </motion.span>
        </AnimatePresence>
        <ChevronDown size={12} className="shrink-0 text-faint" />
      </button>

      <button
        type="button"
        onClick={onClear}
        className={`press h-7 shrink-0 cursor-pointer rounded-full px-3 text-[12.5px] font-medium transition-colors ${
          !filtering
            ? "bg-ink text-on-ink"
            : "border border-hairline bg-card text-body hover:bg-parchment"
        }`}
      >
        {t("tags.all")}
      </button>

      <button
        type="button"
        onClick={onOpenTags}
        aria-pressed={hasTagsFilter}
        title={t("tags.title")}
        className={`press flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors ${
          hasTagsFilter
            ? "bg-ink text-on-ink"
            : "border border-hairline bg-card text-body hover:bg-parchment"
        }`}
      >
        <Tag size={12.5} className={hasTagsFilter ? "opacity-80" : "text-faint"} />
        <span>{t("tags.title")}</span>
        {hasTagsFilter && (
          <span className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-on-ink/20 px-1 text-[10px] font-semibold tabular-nums">
            {selected.length}
          </span>
        )}
      </button>

      <div className="flex-1" />

      {selectMode && (
        <button
          type="button"
          onClick={onToggleSelectMode}
          className="press flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-card px-3 text-[12.5px] font-medium text-body transition-colors hover:bg-parchment"
        >
          <X size={12.5} />
          {t("select.done")}
        </button>
      )}
      <button
        type="button"
        onClick={onToggleSelectMode}
        aria-pressed={selectMode}
        title={t("select.select")}
        className={`press flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors ${
          selectMode ? "bg-ink text-on-ink" : "border border-hairline bg-card text-muted hover:bg-parchment hover:text-ink"
        }`}
      >
        <ListChecks size={13.5} />
      </button>

      <span className="shrink-0 pl-1 text-[12px] text-faint">{count(shown, lora ? "lora" : "prompt")}</span>
    </div>
  );
}
