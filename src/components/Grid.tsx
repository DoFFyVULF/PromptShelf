import { memo, useState } from "react";
import type { RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ImageOff, Images, Pin, Star } from "lucide-react";
import { pluralCategory, useI18n } from "../i18n";
import { assetUrl } from "../lib/api";
import { GRID_GAP, useEntranceWindow, useVirtualGrid, VirtualRow } from "../lib/virtualGrid";
import { attachCardGhost } from "../lib/dragGhost";
import { GridImage } from "./GridImage";
import { ImportJobTile, type ImportJob } from "./ImportJobs";
import { TileShell } from "./PinShell";
import { WorkflowBadge } from "./WorkflowBadge";
import type { CardSummary } from "../lib/types";

/** dataTransfer type used when dragging cards onto the groups panel. */
export const CARD_DRAG_TYPE = "application/x-promptshelf-cards";
/** Dragging a group row inside the panel to change the display order. */
export const GROUP_DRAG_TYPE = "application/x-promptshelf-group";

interface GridProps {
  cards: CardSummary[];
  /** Background CivitAI imports: placeholder tiles before the real cards. */
  jobs: ImportJob[];
  onJobRetry: (job: ImportJob) => void;
  onJobDismiss: (id: string) => void;
  onOpen: (id: string) => void;
  selectMode: boolean;
  selection: string[];
  onToggleSelect: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  /** The shelf's scroll container, used to window the rows. */
  scrollRef: RefObject<HTMLElement | null>;
}

interface CardTileProps {
  card: CardSummary;
  onOpen: (id: string) => void;
  delay: number;
  /** First-screen tiles keep the staggered entrance; scrolled-in ones do not. */
  enter: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  selection: string[];
  onTogglePin: (id: string, pinned: boolean) => void;
}

function CardTileBase({
  card,
  onOpen,
  delay,
  enter,
  selectMode,
  selected,
  onToggleSelect,
  selection,
  onTogglePin
}: CardTileProps) {
  const { formatDate, t, lang } = useI18n();
  const reduced = useReducedMotion();
  const plural = pluralCategory(lang, card.variant_count);
  const variantLabel = t(`variant.more.${plural === "one" || plural === "few" || plural === "many" ? plural : "other"}`, { n: card.variant_count });
  const sheetTransition = { duration: reduced ? 0 : 0.4, ease: [0.32, 0.72, 0, 1] as const };
  // the source tile "picks up": shrinks and fades while the card is dragged.
  // The state is set on a timeout so React doesn't re-render during the
  // dragstart dispatch; the ghost is already captured from the canvas.
  const [dragging, setDragging] = useState(false);
  // The entrance stagger is a mount-time affair. Reading it from the prop after
  // a reorder would rewrite `animation-delay` on every tile, which restarts
  // `tile-in` and makes the whole shelf flash. Capture it once instead: a tile
  // mounted by the virtual window after the first beat stays quiet.
  const [stagger] = useState(() => Math.min(delay, 320));
  const [entrance] = useState(enter);

  const activate = () => {
    if (selectMode) onToggleSelect(card.id);
    else onOpen(card.id);
  };

  const onDragStart = (e: React.DragEvent) => {
    const ids = selected ? selection : [card.id];
    try {
      e.dataTransfer.setData(CARD_DRAG_TYPE, JSON.stringify(ids));
      e.dataTransfer.setData("text/plain", `promptshelf:${ids.length}`);
    } catch {
      /* some engines restrict custom types */
    }
    e.dataTransfer.effectAllowed = "move";

    attachCardGhost(e, { title: card.prompt.trim() || t("card.noPrompt"), count: ids.length });
    // the source tile "picks up" on a timeout so React doesn't re-render
    // during the dragstart dispatch; the ghost is already captured.
    window.setTimeout(() => setDragging(true), 0);
  };

  return (
    <motion.article
      initial="rest"
      animate="rest"
      whileHover={reduced || selectMode || dragging ? "rest" : "spread"}
      whileFocus={reduced || selectMode ? "rest" : "spread"}
      className={`${entrance ? "anim-tile " : ""}group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-card border bg-card transition-[border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-hover hover:shadow-tile-hover ${
        dragging
          ? "scale-[0.9] border-leaf-edge/80 shadow-none"
          : "border-hairline"
      } ${card.pinned ? "tile-pinned" : ""}`}
      style={entrance ? { animationDelay: `${stagger}ms` } : undefined}
      onClick={activate}
      role="button"
      tabIndex={0}
      draggable={!selectMode}
      onDragStartCapture={onDragStart}
      onDragEndCapture={() => setDragging(false)}
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
          {card.cover ? (
            <GridImage
              src={assetUrl(card.cover.thumb)}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              className="no-drag h-full w-full object-cover group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-faint">
              <ImageOff size={40} strokeWidth={1.2} />
              <span className="text-[13px]">{t("detail.noImages")}</span>
            </div>
          )}
          {card.image_count > 1 && (
            <span className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white backdrop-blur-sm">
              <Images size={10.5} />
              {card.image_count}
            </span>
          )}
          {!selectMode && !dragging && (
            <div
              className={`absolute top-2 right-2 z-10 transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                card.pinned
                  ? "opacity-100"
                  : "pointer-events-none -translate-y-1 opacity-0 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100"
              }`}
            >
              <motion.button
                type="button"
                draggable={false}
                className={`pin-chip ${card.pinned ? "is-on" : ""}`}
                aria-label={card.pinned ? t("card.unpin") : t("card.pin")}
                aria-pressed={card.pinned}
                title={card.pinned ? t("card.unpin") : t("card.pin")}
                onClick={(e) => {
                  e.stopPropagation();
                  // A pointer click leaves the chip focused; when the card is
                  // moved to the top, WebKit scrolls the focused button into
                  // view and yanks the shelf with it.
                  if (e.detail > 0) e.currentTarget.blur();
                  onTogglePin(card.id, !card.pinned);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                whileHover={reduced ? undefined : { scale: 1.08 }}
                whileTap={reduced ? undefined : { scale: 0.88 }}
                transition={{ type: "spring", stiffness: 520, damping: 26 }}
              >
                <motion.span
                  key={card.pinned ? "on" : "off"}
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
                    className={card.pinned ? "fill-current" : undefined}
                  />
                </motion.span>
              </motion.button>
            </div>
          )}
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 flex-col px-3.5 pt-2.5 pb-3 transition-opacity duration-200 ease-out ${dragging ? "opacity-35" : ""}`}>
        <p className="line-clamp-2 min-h-[2.6em] text-[13.5px] leading-[1.42] text-ink">
          {card.prompt.trim() ? card.prompt : <span className="text-faint">{t("card.noPrompt")}</span>}
        </p>

        {card.variant_count > 0 && (
          <div className="mt-2 flex items-center gap-2.5 text-[11.5px] leading-5 text-muted">
            <span aria-hidden="true" className="relative block h-7 w-7 shrink-0">
              <motion.span
                className="absolute top-0.5 left-0 h-5 w-[18px] rounded-[4px] border border-line-hover bg-parchment"
                variants={{ rest: { x: 6, y: 4 }, spread: { x: 8, y: 6 } }}
                transition={sheetTransition}
              />
              <motion.span
                className="absolute top-0.5 left-0 h-5 w-[18px] rounded-[4px] border border-line-hover bg-parchment"
                variants={{ rest: { x: 3, y: 2 }, spread: { x: 4, y: 3 } }}
                transition={sheetTransition}
              />
              <span className="absolute top-0.5 left-0 flex h-5 w-[18px] flex-col justify-center gap-[3px] rounded-[4px] border border-line-hover bg-card px-1">
                <span className="h-px w-full bg-muted" />
                <span className="h-px w-2/3 bg-muted" />
              </span>
            </span>
            <span className="whitespace-nowrap tabular-nums">{variantLabel}</span>
          </div>
        )}

        {/* meta row: the workflow seal leads the tags — it is a state, not a
            tag, and it is the one chip that can be filled or outlined */}
        <div className="mt-2.5 flex min-h-[22px] flex-wrap items-center gap-1">
          {card.workflow && (
            <WorkflowBadge
              saved={card.workflow.saved}
              nodes={card.workflow.node_count}
              delay={entrance ? stagger : 0}
              enter={entrance}
            />
          )}
          {card.tags.slice(0, 10).map((tag) => (
            <span key={tag} className="max-w-[96px] truncate rounded-full bg-parchment px-2 py-0.5 text-[11px] text-muted">
              {tag}
            </span>
          ))}
          {card.tags.length > 10 && (
            <span
              title={card.tags.slice(10).join(", ")}
              className="shrink-0 rounded-full border border-dashed border-hairline bg-transparent px-2 py-0.5 text-[11px] font-medium text-faint"
            >
              +{card.tags.length - 10}
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between pt-2.5">
          <span className="text-[11.5px] text-faint">{formatDate(card.created_at)}</span>
          {card.rating > 0 ? (
            <span className="flex items-center gap-1 text-[11.5px] font-medium text-body">
              <Star size={11.5} className="fill-ink text-ink" />
              {card.rating}
            </span>
          ) : (
            <span className="text-[11.5px] text-transparent select-none" aria-hidden>
              {t("sort.rating")}
            </span>
          )}
        </div>
      </div>
    </motion.article>
  );
}

/**
 * A pin re-sorts the shelf, which re-indexes every tile. `delay` only seeds the
 * mount stagger, so it is deliberately left out of the comparison: the tile the
 * user touched (and nothing else) re-renders.
 */
const CardTile = memo(CardTileBase, (a: CardTileProps, b: CardTileProps) => (
  a.card === b.card &&
  a.selected === b.selected &&
  a.selectMode === b.selectMode &&
  a.selection === b.selection &&
  a.onOpen === b.onOpen &&
  a.onToggleSelect === b.onToggleSelect &&
  a.onTogglePin === b.onTogglePin
));

interface CardRowProps {
  cards: CardSummary[];
  start: number;
  columns: number;
  enter: boolean;
  selectMode: boolean;
  selection: string[];
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}

/**
 * Row contents are memoized separately from the row's position. Virtualization
 * nudges `top` as heights are measured; if the tiles re-rendered on every nudge,
 * Motion would re-project their `layout="position"` boxes from a stale snapshot
 * and the shelf would visibly jitter (worst when many narrow rows are visible).
 * A real reorder still changes `cards`/`start`, so pin flights keep working.
 */
const CardRow = memo(function CardRow({
  cards,
  start,
  columns,
  enter,
  selectMode,
  selection,
  onOpen,
  onToggleSelect,
  onTogglePin
}: CardRowProps) {
  return (
    <>
      {cards.slice(start, start + columns).map((card, column) => {
        const index = start + column;
        return (
          <TileShell key={card.id} pinned={card.pinned}>
            <CardTile
              card={card}
              onOpen={onOpen}
              delay={enter ? index * 28 : 0}
              enter={enter}
              selectMode={selectMode}
              selected={selection.includes(card.id)}
              onToggleSelect={onToggleSelect}
              onTogglePin={onTogglePin}
              selection={selection}
            />
          </TileShell>
        );
      })}
    </>
  );
});

export function CardGrid({ cards, jobs, onJobRetry, onJobDismiss, onOpen, selectMode, selection, onToggleSelect, onTogglePin, scrollRef }: GridProps) {
  const entering = useEntranceWindow();
  const { containerRef, columns, rows, totalHeight, measureRow, ready } = useVirtualGrid({
    count: cards.length,
    scrollRef,
    textBlockHeight: 170,
    revision: jobs.length
  });

  return (
    <div className="px-5 pt-5 pb-10">
      <div className="jobs-strip relative grid grid-cols-[repeat(auto-fill,minmax(236px,1fr))] gap-4">
        <AnimatePresence mode="popLayout">
          {jobs.map((job) => (
            <ImportJobTile key={job.id} job={job} onRetry={onJobRetry} onDismiss={onJobDismiss} />
          ))}
        </AnimatePresence>
      </div>

      <div ref={containerRef} className="relative" style={{ height: totalHeight }}>
        {ready &&
          rows.map((row) => {
            const start = row.index * columns;
            // Only the first screen earns the entrance stagger; rows mounted
            // by the virtual window fade quietly in the overscan instead.
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
                <CardRow
                  cards={cards}
                  start={start}
                  columns={columns}
                  enter={enter}
                  selectMode={selectMode}
                  selection={selection}
                  onOpen={onOpen}
                  onToggleSelect={onToggleSelect}
                  onTogglePin={onTogglePin}
                />
              </VirtualRow>
            );
          })}
      </div>
    </div>
  );
}
