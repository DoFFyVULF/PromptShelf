import { ChevronDown, Folder, ListChecks, Tag, X } from "lucide-react";
import { useI18n } from "../i18n";
import type { GroupInfo, TagCount } from "../lib/types";

interface FilterBarProps {
  tags: TagCount[];
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
  shown: number;
  filtering: boolean;
  group: GroupInfo | null;
  onOpenGroups: () => void;
  onOpenTags: () => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
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
  onOpenTags,
  selectMode,
  onToggleSelectMode
}: FilterBarProps) {
  const { t, count } = useI18n();
  const hasTagsFilter = selected.length > 0;

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-line-soft px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button
        type="button"
        data-groups-trigger
        onClick={onOpenGroups}
        title={t("groups.title")}
        className="press flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-card py-0 pr-2.5 pl-3 text-[12.5px] font-medium text-body transition-colors hover:bg-parchment"
      >
        <Folder size={13} className="text-faint" />
        <span className="max-w-[160px] truncate">{group?.name ?? t("group.home")}</span>
        <ChevronDown size={12} className="text-faint" />
      </button>

      <button
        type="button"
        onClick={onClear}
        className={`press h-7 shrink-0 cursor-pointer rounded-full px-3 text-[12.5px] font-medium transition-colors ${
          !filtering
            ? "bg-ink text-white"
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
            ? "bg-ink text-white"
            : "border border-hairline bg-card text-body hover:bg-parchment"
        }`}
      >
        <Tag size={12.5} className={hasTagsFilter ? "opacity-80" : "text-faint"} />
        <span>{t("tags.title")}</span>
        {hasTagsFilter && (
          <span className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-white/20 px-1 text-[10px] font-semibold tabular-nums">
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
          selectMode ? "bg-ink text-white" : "border border-hairline bg-card text-muted hover:bg-parchment hover:text-ink"
        }`}
      >
        <ListChecks size={13.5} />
      </button>

      <span className="shrink-0 pl-1 text-[12px] text-faint">{count(shown)}</span>
    </div>
  );
}
