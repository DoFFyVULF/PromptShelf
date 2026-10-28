import { ChevronDown, Folder, ListChecks, X } from "lucide-react";
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
  selectMode,
  onToggleSelectMode
}: FilterBarProps) {
  const { t, count } = useI18n();

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

      {tags.map((tag) => {
        const active = selected.includes(tag.name);
        return (
          <button
            key={tag.name}
            type="button"
            onClick={() => onToggle(tag.name)}
            aria-pressed={active}
            className={`press h-7 shrink-0 cursor-pointer rounded-full px-3 text-[12.5px] font-medium transition-colors ${
              active
                ? "bg-ink text-white"
                : "border border-hairline bg-card text-body hover:bg-parchment"
            }`}
          >
            {tag.name}
            <span className={`ml-1.5 text-[11px] ${active ? "opacity-60" : "text-faint"}`}>{tag.count}</span>
          </button>
        );
      })}

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
