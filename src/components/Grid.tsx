import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ImageOff, Images, Star } from "lucide-react";
import { useI18n } from "../i18n";
import { assetUrl } from "../lib/api";
import { attachCardGhost } from "../lib/dragGhost";
import { ImportJobTile, type ImportJob } from "./ImportJobs";
import type { CardSummary } from "../lib/types";

/** dataTransfer type used when dragging cards onto the groups panel. */
export const CARD_DRAG_TYPE = "application/x-promptshelf-cards";

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
}

function CardTile({
  card,
  onOpen,
  delay,
  selectMode,
  selected,
  onToggleSelect,
  selection
}: {
  card: CardSummary;
  onOpen: (id: string) => void;
  delay: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  selection: string[];
}) {
  const { formatDate, t, lang } = useI18n();
  const reduced = useReducedMotion();
  const plural = new Intl.PluralRules(lang).select(card.variant_count);
  const variantLabel = t(`variant.more.${plural === "one" || plural === "few" || plural === "many" ? plural : "other"}`, { n: card.variant_count });
  const sheetTransition = { duration: reduced ? 0 : 0.4, ease: [0.32, 0.72, 0, 1] as const };
  // the source tile "picks up": shrinks and fades while the card is dragged.
  // The state is set on a timeout so React doesn't re-render during the
  // dragstart dispatch; the ghost is already captured from the canvas.
  const [dragging, setDragging] = useState(false);

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

    attachCardGhost(e, { title: card.prompt.trim(), count: ids.length });
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
      className={`anim-tile group relative flex cursor-pointer flex-col overflow-hidden rounded-card border bg-card transition-[border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-hover hover:shadow-tile-hover ${
        dragging
          ? "scale-[0.9] border-leaf-edge/80 shadow-none"
          : "border-hairline"
      }`}
      style={{ animationDelay: `${Math.min(delay, 320)}ms` }}
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
            <img
              src={assetUrl(card.cover.thumb)}
              alt=""
              draggable={false}
              loading="lazy"
              className="no-drag h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
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
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 flex-col px-3.5 pt-2.5 pb-3 transition-opacity duration-200 ease-out ${dragging ? "opacity-35" : ""}`}>
        <p className="line-clamp-2 min-h-[2.6em] text-[13.5px] leading-[1.42] text-ink">{card.prompt}</p>

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

        {/* tags row: show up to 10 tags, collapse the rest */}
        <div className="mt-2.5 flex min-h-[22px] flex-wrap items-center gap-1">
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

export function CardGrid({ cards, jobs, onJobRetry, onJobDismiss, onOpen, selectMode, selection, onToggleSelect }: GridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(236px,1fr))] gap-4 px-5 pt-5 pb-10">
      <AnimatePresence mode="popLayout">
        {jobs.map((job) => (
          <ImportJobTile key={job.id} job={job} onRetry={onJobRetry} onDismiss={onJobDismiss} />
        ))}
      </AnimatePresence>
      {cards.map((card, i) => (
        <CardTile
          key={card.id}
          card={card}
          onOpen={onOpen}
          delay={i * 28}
          selectMode={selectMode}
          selected={selection.includes(card.id)}
          onToggleSelect={onToggleSelect}
          selection={selection}
        />
      ))}
    </div>
  );
}
