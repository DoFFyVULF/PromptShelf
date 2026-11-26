import { memo, useMemo, useState } from "react";
import type { RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Layers, Pin, Star } from "lucide-react";
import { useI18n } from "../i18n";
import { assetUrl } from "../lib/api";
import { GRID_GAP, useEntranceWindow, useVirtualGrid, VirtualRow } from "../lib/virtualGrid";
import { attachCardGhost } from "../lib/dragGhost";
import { GridImage } from "./GridImage";
import { ImportJobTile, type ImportJob } from "./ImportJobs";
import { CARD_DRAG_TYPE } from "./Grid";
import { LoraFamilyTile } from "./LoraFamilyTile";
import { TileShell } from "./PinShell";
import type { LoraFamily } from "../lib/loraFamilies";
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
  onTogglePin: (id: string, pinned: boolean) => void;
  /** Accepted same-lora variant sets; each one occupies one tile in the grid. */
  families: LoraFamily[];
  onOpenFamily: (id: string) => void;
  /** Pins every variant in the group, so the deck floats to the top. */
  onToggleFamilyPin: (memberIds: string[], pinned: boolean) => void;
  /** The shelf's scroll container, used to window the rows. */
  scrollRef: RefObject<HTMLElement | null>;
}

interface LoraTileProps {
  lora: LoraSummary;
  onOpen: (id: string) => void;
  delay: number;
  /** First-screen tiles keep the staggered entrance; scrolled-in ones do not. */
  enter: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}

function LoraTileBase({
  lora,
  onOpen,
  delay,
  enter,
  selectMode,
  selected,
  onToggleSelect,
  onTogglePin
}: LoraTileProps) {
  const { formatDate, t } = useI18n();
  const reduced = useReducedMotion();
  const [dragging, setDragging] = useState(false);
  // seeded once: a reorder must not replay the entrance animation
  const [stagger] = useState(() => Math.min(delay, 320));
  // A tile mounted by the virtual window after the first beat stays quiet.
  const [entrance] = useState(enter);

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
    attachCardGhost(e, {
      title: lora.name,
      strong: true,
      badge: lora.primary_tag ?? undefined,
      meta: lora.base_model ?? undefined
    });
    window.setTimeout(() => setDragging(true), 0);
  };

  return (
    <article
      className={`${entrance ? "anim-tile " : ""}group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-card border bg-card transition-[border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-hover hover:shadow-tile-hover ${
        dragging ? "scale-[0.9] border-leaf-edge/80 shadow-none" : "border-hairline"
      } ${lora.pinned ? "tile-pinned" : ""}`}
      style={entrance ? { animationDelay: `${stagger}ms` } : undefined}
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
        <div data-ghost-box className="relative aspect-[4/3] overflow-hidden rounded-tile bg-parchment">
          {lora.cover ? (
            <GridImage
              src={assetUrl(lora.cover.thumb)}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              className="no-drag h-full w-full object-cover group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-faint">
              <Layers size={34} strokeWidth={1.3} />
              <span className="max-w-[80%] truncate text-[12px]">{lora.name}</span>
            </div>
          )}
          {/* blue primary badge, like CivitAI's model-page label */}
          {lora.primary_tag && (
            <span className="absolute top-1.5 left-1.5 max-w-[calc(100%-3rem)] truncate rounded-md bg-action px-1.5 py-[2px] text-[9.5px] font-bold tracking-wide text-white uppercase shadow-chip">
              {lora.primary_tag}
            </span>
          )}
          {lora.base_model && (
            <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white backdrop-blur-sm">
              {lora.base_model}
            </span>
          )}
          {!selectMode && !dragging && (
            <div
              className={`absolute top-2 right-2 z-10 transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                lora.pinned
                  ? "opacity-100"
                  : "pointer-events-none -translate-y-1 opacity-0 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100"
              }`}
            >
              <motion.button
                type="button"
                draggable={false}
                className={`pin-chip ${lora.pinned ? "is-on" : ""}`}
                aria-label={lora.pinned ? t("card.unpin") : t("card.pin")}
                aria-pressed={lora.pinned}
                title={lora.pinned ? t("card.unpin") : t("card.pin")}
                onClick={(e) => {
                  e.stopPropagation();
                  // drop the focus before the tile moves, or WebKit scrolls
                  // the button back into view
                  if (e.detail > 0) e.currentTarget.blur();
                  onTogglePin(lora.id, !lora.pinned);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                whileHover={reduced ? undefined : { scale: 1.08 }}
                whileTap={reduced ? undefined : { scale: 0.88 }}
                transition={{ type: "spring", stiffness: 520, damping: 26 }}
              >
                <motion.span
                  key={lora.pinned ? "on" : "off"}
                  initial={{ scale: 0.55, rotate: -35, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 560, damping: 20 }
                  }
                >
                  <Pin
                    size={14}
                    strokeWidth={2.2}
                    className={lora.pinned ? "fill-current" : undefined}
                  />
                </motion.span>
              </motion.button>
            </div>
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

/** See CardTile: `delay` only seeds the mount stagger, so it stays out of the
 * comparison and a pin re-renders the tile the user touched, not the shelf. */
const LoraTile = memo(LoraTileBase, (a: LoraTileProps, b: LoraTileProps) => (
  a.lora === b.lora &&
  a.selected === b.selected &&
  a.selectMode === b.selectMode &&
  a.onOpen === b.onOpen &&
  a.onToggleSelect === b.onToggleSelect &&
  a.onTogglePin === b.onTogglePin
));

type LoraEntry =
  | { kind: "lora"; key: string; lora: LoraSummary }
  | { kind: "family"; key: string; family: LoraFamily };

interface LoraRowProps {
  entries: LoraEntry[];
  start: number;
  columns: number;
  enter: boolean;
  selectMode: boolean;
  selection: string[];
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onOpenFamily: (id: string) => void;
  onToggleFamilyPin: (memberIds: string[], pinned: boolean) => void;
}

/**
 * See CardRow: keeping the tiles out of the `top`-only re-render stops Motion
 * from re-projecting their layout boxes while rows are being measured. The
 * family replacement is already baked into `entries`, so it stays a single tile.
 */
const LoraRow = memo(function LoraRow({
  entries,
  start,
  columns,
  enter,
  selectMode,
  selection,
  onOpen,
  onToggleSelect,
  onTogglePin,
  onOpenFamily,
  onToggleFamilyPin
}: LoraRowProps) {
  return (
    <>
      {entries.slice(start, start + columns).map((entry, column) => {
        const index = start + column;
        if (entry.kind === "family") {
          // the deck reads as pinned only when every variant is
          const pinned = entry.family.members.every((member) => member.pinned);
          return (
            <TileShell key={entry.key} pinned={pinned}>
              <LoraFamilyTile
                family={entry.family}
                onOpen={onOpenFamily}
                onTogglePin={onToggleFamilyPin}
                delay={enter ? index * 28 : 0}
                enter={enter}
              />
            </TileShell>
          );
        }
        return (
          <TileShell key={entry.key} pinned={entry.lora.pinned}>
            <LoraTile
              lora={entry.lora}
              onOpen={onOpen}
              delay={enter ? index * 28 : 0}
              enter={enter}
              selectMode={selectMode}
              selected={selection.includes(entry.lora.id)}
              onToggleSelect={onToggleSelect}
              onTogglePin={onTogglePin}
            />
          </TileShell>
        );
      })}
    </>
  );
});

export function LoraGrid({ loras, jobs, onJobRetry, onJobDismiss, onOpen, selectMode, selection, onToggleSelect, onTogglePin, families, onOpenFamily, onToggleFamilyPin, scrollRef }: LoraGridProps) {
  const entering = useEntranceWindow();
  // Members disappear from the grid and are represented by one deck tile at
  // the position of their newest member, so sorting stays intact. Building the
  // entries up front lets the virtual window count shelf rows, not members.
  const entries = useMemo(() => {
    const familyByMember = new Map<string, LoraFamily>();
    for (const family of families) {
      for (const member of family.members) familyByMember.set(member.id, family);
    }
    const shownFamilies = new Set<string>();
    const out: LoraEntry[] = [];
    for (const lora of loras) {
      const family = familyByMember.get(lora.id);
      if (family) {
        if (shownFamilies.has(family.id)) continue;
        shownFamilies.add(family.id);
        out.push({ kind: "family", key: `family-${family.id}`, family });
      } else {
        out.push({ kind: "lora", key: lora.id, lora });
      }
    }
    return out;
  }, [families, loras]);

  const { containerRef, columns, rows, totalHeight, measureRow, ready } = useVirtualGrid({
    count: entries.length,
    scrollRef,
    textBlockHeight: 128,
    revision: jobs.length
  });

  return (
    <div className="px-5 pt-5 pb-10">
      <div className="jobs-strip relative grid grid-cols-[repeat(auto-fill,minmax(236px,1fr))] gap-4">
        <AnimatePresence mode="popLayout">
          {jobs.map((job) => (
            <ImportJobTile key={job.id} job={job} onRetry={onJobRetry} onDismiss={onJobDismiss} lora />
          ))}
        </AnimatePresence>
      </div>

      <div ref={containerRef} className="relative" style={{ height: totalHeight }}>
        {ready &&
          rows.map((row) => {
            const start = row.index * columns;
            const enter = entering && row.index < 4;
            return (
              <VirtualRow
                key={row.index}
                index={row.index}
                top={row.top}
                columns={columns}
                gap={GRID_GAP}
                animate={!enter}
                onMeasure={measureRow}
              >
                <LoraRow
                  entries={entries}
                  start={start}
                  columns={columns}
                  enter={enter}
                  selectMode={selectMode}
                  selection={selection}
                  onOpen={onOpen}
                  onToggleSelect={onToggleSelect}
                  onTogglePin={onTogglePin}
                  onOpenFamily={onOpenFamily}
                  onToggleFamilyPin={onToggleFamilyPin}
                />
              </VirtualRow>
            );
          })}
      </div>
    </div>
  );
}
