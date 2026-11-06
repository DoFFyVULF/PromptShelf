import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { Layers, Star } from "lucide-react";
import { useI18n } from "../i18n";
import { assetUrl } from "../lib/api";
import { ImportJobTile, type ImportJob } from "./ImportJobs";
import { CARD_DRAG_TYPE } from "./Grid";
import type { LoraSummary } from "../lib/types";

interface LoraGridProps {
  loras: LoraSummary[];
  jobs: ImportJob[];
  onJobRetry: (job: ImportJob) => void;
  onJobDismiss: (id: string) => void;
  onOpen: (id: string) => void;
  selectMode: boolean;
  selection: string[];
  onToggleSelect: (id: string) => void;
}

function LoraTile({
  lora,
  onOpen,
  delay,
  selectMode,
  selected,
  onToggleSelect
}: {
  lora: LoraSummary;
  onOpen: (id: string) => void;
  delay: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { formatDate, t } = useI18n();
  const [dragging, setDragging] = useState(false);

  const activate = () => {
    if (selectMode) onToggleSelect(lora.id);
    else onOpen(lora.id);
  };

  /** Lora drags reuse the card drag channel — only one groups panel exists at
   * a time (the one for the active shelf), so the payload never crosses over. */
  const onDragStart = (e: React.DragEvent) => {
    try {
      e.dataTransfer.setData(CARD_DRAG_TYPE, JSON.stringify([lora.id]));
      e.dataTransfer.setData("text/plain", `promptshelf:${lora.name}`);
    } catch {
      /* some engines restrict custom types */
    }
    e.dataTransfer.effectAllowed = "move";
    window.setTimeout(() => setDragging(true), 0);
  };

  return (
    <article
      className={`anim-tile group relative flex cursor-pointer flex-col overflow-hidden rounded-card border bg-card transition-[border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-hover hover:shadow-tile-hover ${
        dragging ? "scale-[0.9] border-leaf-edge/80 shadow-none" : "border-hairline"
      }`}
      style={{ animationDelay: `${Math.min(delay, 320)}ms` }}
      onClick={activate}
      role="button"
      tabIndex={0}
      draggable={!selectMode}
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
    >
      {selectMode && (
        <span
          aria-hidden
          className={`absolute top-2.5 left-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border backdrop-blur transition-all ${
            selected ? "border-emerald-600 bg-emerald-500 text-white" : "border-zinc-300 bg-white/85 text-transparent"
          } ${dragging ? "opacity-35" : ""}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
      )}

      <div className={`p-2.5 pb-0 transition-opacity duration-200 ease-out ${dragging ? "opacity-35" : ""}`}>
        <div className="relative aspect-[4/3] overflow-hidden rounded-tile bg-parchment">
          {lora.cover ? (
            <img
              src={assetUrl(lora.cover.thumb)}
              alt=""
              draggable={false}
              loading="lazy"
              className="no-drag h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-faint">
              <Layers size={34} strokeWidth={1.3} />
              <span className="max-w-[80%] truncate text-[12px]">{lora.name}</span>
            </div>
          )}
          {/* blue primary badge, like CivitAI's model-page label */}
          {lora.primary_tag && (
            <span className="absolute top-1.5 left-1.5 rounded-md bg-action px-1.5 py-[2px] text-[9.5px] font-bold tracking-wide text-white uppercase shadow-chip">
              {lora.primary_tag}
            </span>
          )}
          {lora.base_model && (
            <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white backdrop-blur-sm">
              {lora.base_model}
            </span>
          )}
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 flex-col px-3.5 pt-2.5 pb-3 transition-opacity duration-200 ease-out ${dragging ? "opacity-35" : ""}`}>
        <p className="line-clamp-2 min-h-[2.2em] text-[13.5px] font-semibold leading-[1.38] tracking-[-0.01em] text-ink">
          {lora.name}
        </p>

        {/* trigger words as violet chips like the CivitAI page */}
        <div className="mt-1.5 flex min-h-[20px] flex-wrap items-center gap-1">
          {lora.trigger_words.slice(0, 3).map((tw) => (
            <span key={tw} className="max-w-[110px] truncate rounded-full bg-violet-soft px-2 py-0.5 text-[10.5px] font-medium text-violet">
              {tw}
            </span>
          ))}
          {lora.trigger_words.length > 3 && (
            <span
              title={lora.trigger_words.slice(3).join(", ")}
              className="shrink-0 rounded-full border border-dashed border-hairline bg-transparent px-2 py-0.5 text-[10.5px] font-medium text-faint"
            >
              +{lora.trigger_words.length - 3}
            </span>
          )}
          {!lora.trigger_words.length && lora.tags[0] && (
            <span className="rounded-full bg-parchment px-2 py-0.5 text-[10.5px] text-muted">{lora.tags[0]}</span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between pt-2.5">
          {/* import date, not the CivitAI publish date */}
          <span className="text-[11.5px] text-faint">{formatDate(lora.created_at)}</span>
          {lora.rating > 0 ? (
            <span className="flex items-center gap-1 text-[11.5px] font-medium text-body">
              <Star size={11.5} className="fill-ink text-ink" />
              {lora.rating}
            </span>
          ) : (
            <span className="text-[11.5px] text-transparent select-none" aria-hidden>
              {t("sort.rating")}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function LoraGrid({ loras, jobs, onJobRetry, onJobDismiss, onOpen, selectMode, selection, onToggleSelect }: LoraGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(236px,1fr))] gap-4 px-5 pt-5 pb-10">
      <AnimatePresence mode="popLayout">
        {jobs.map((job) => (
          <ImportJobTile key={job.id} job={job} onRetry={onJobRetry} onDismiss={onJobDismiss} lora />
        ))}
      </AnimatePresence>
      {loras.map((lora, i) => (
        <LoraTile
          key={lora.id}
          lora={lora}
          onOpen={onOpen}
          delay={i * 28}
          selectMode={selectMode}
          selected={selection.includes(lora.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}
