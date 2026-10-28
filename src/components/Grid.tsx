import { useState } from "react";
import { Images, Star } from "lucide-react";
import { useI18n } from "../i18n";
import { assetUrl } from "../lib/api";
import type { CardSummary } from "../lib/types";

/** dataTransfer type used when dragging cards onto the groups panel. */
export const CARD_DRAG_TYPE = "application/x-promptshelf-cards";

interface GridProps {
  cards: CardSummary[];
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
  const { formatDate, t } = useI18n();
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

    // The card that travels with the cursor is a shrunken painting of the
    // tile on a canvas: the photo is drawn synchronously from the already
    // decoded <img>, so it always makes it into the drag snapshot (a cloned
    // <img> would still be decoding and render empty in WebKit). The canvas
    // is parked behind the opaque source tile (z-index -1, centred on it) so
    // WebKit can snapshot it while nothing flashes in the UI.
    const tile = e.currentTarget as HTMLElement;
    const tileRect = tile.getBoundingClientRect();
    const box = tile.querySelector<HTMLElement>("[data-ghost-box]");
    const img = box?.querySelector("img");
    const boxRect = box?.getBoundingClientRect();
    const S = 0.62;
    const pad = 10;
    const footH = 30;
    const bw = boxRect?.width ?? tileRect.width - pad * 2;
    const bh = boxRect?.height ?? bw * 0.75;
    const W = Math.round(bw + pad * 2);
    const H = Math.round(pad + bh + footH);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const m = 18; // room for the soft shadow inside the bitmap
    const cw = Math.round(W * S) + m * 2;
    const ch = Math.round(H * S) + m * 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.cssText = `position:fixed;left:${Math.round(tileRect.left + tileRect.width / 2 - cw / 2)}px;top:${Math.round(
      tileRect.top + tileRect.height / 2 - ch / 2
    )}px;width:${cw}px;height:${ch}px;pointer-events:none;z-index:-1;`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(m, m);
      ctx.scale(S, S);
      // per-corner rounded rect in design coordinates
      const path = (x: number, y: number, w: number, h: number, tl: number, tr: number, br: number, bl: number) => {
        ctx.beginPath();
        ctx.moveTo(x + tl, y);
        ctx.lineTo(x + w - tr, y);
        ctx.arcTo(x + w, y, x + w, y + tr, tr);
        ctx.lineTo(x + w, y + h - br);
        ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
        ctx.lineTo(x + bl, y + h);
        ctx.arcTo(x, y + h, x, y + h - bl, bl);
        ctx.lineTo(x, y + tl);
        ctx.arcTo(x, y, x + tl, y, tl);
        ctx.closePath();
      };
      // card body with a soft shadow (shadow metrics are device-space)
      ctx.save();
      ctx.shadowColor = "rgba(23,23,28,0.32)";
      ctx.shadowBlur = 20 * dpr;
      ctx.shadowOffsetY = 9 * dpr;
      ctx.fillStyle = "#ffffff";
      path(0, 0, W, H, 10, 10, 10, 10);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "rgba(24,24,27,0.14)";
      ctx.lineWidth = 1;
      path(0.5, 0.5, W - 1, H - 1, 10, 10, 10, 10);
      ctx.stroke();
      // cover image, cover-cropped like object-cover, top corners rounded
      const iw = W - pad * 2;
      ctx.save();
      path(pad, pad, iw, bh, 8, 8, 0, 0);
      ctx.clip();
      if (img && img.complete && img.naturalWidth > 0) {
        const ir = img.naturalWidth / img.naturalHeight;
        const br = iw / bh;
        let sx = 0;
        let sy = 0;
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;
        if (ir > br) {
          sw = sh * br;
          sx = (img.naturalWidth - sw) / 2;
        } else {
          sh = sw / br;
          sy = (img.naturalHeight - sh) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, pad, pad, iw, bh);
      } else {
        ctx.fillStyle = "#f4f4f5";
        ctx.fillRect(pad, pad, iw, bh);
        ctx.fillStyle = "#a1a1aa";
        ctx.font = "500 13px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(card.prompt.trim().slice(0, 80) || "…", pad + iw / 2, pad + bh / 2);
        ctx.textAlign = "left";
      }
      ctx.restore();
      // footer: truncated prompt, like the tile's first line
      const p = card.prompt.trim();
      if (p) {
        ctx.fillStyle = "#3f3f46";
        ctx.font = "500 12.5px system-ui, sans-serif";
        ctx.textBaseline = "middle";
        let txt = p;
        if (ctx.measureText(txt).width > iw) {
          while (txt.length > 1 && ctx.measureText(`${txt}…`).width > iw) txt = txt.slice(0, -1);
          txt = `${txt}…`;
        }
        ctx.fillText(txt, pad, pad + bh + footH / 2 + 1);
      }
      // emerald count pill for multi-card drags
      if (ids.length > 1) {
        const cx = W - 16;
        const cy = 16;
        ctx.beginPath();
        ctx.arc(cx, cy, 11, 0, Math.PI * 2);
        ctx.fillStyle = "#059669";
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "600 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(ids.length), cx, cy + 0.5);
        ctx.textAlign = "left";
      }
    }
    document.body.appendChild(canvas);
    try {
      e.dataTransfer.setDragImage(canvas, Math.round(cw / 2), Math.round(ch / 2));
    } catch {
      /* fall back to the browser's default ghost */
    }
    // parked behind the tile (invisible); remove once the drag is over
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      canvas.remove();
      window.removeEventListener("dragend", cleanup);
      window.removeEventListener("drop", cleanup);
    };
    window.addEventListener("dragend", cleanup);
    window.addEventListener("drop", cleanup);
    window.setTimeout(cleanup, 15000);
    window.setTimeout(() => setDragging(true), 0);
  };

  return (
    <article
      className={`anim-tile group relative flex cursor-pointer flex-col overflow-hidden rounded-card border bg-card transition-[border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-[0_10px_30px_-12px_rgb(0_0_0/0.12)] ${
        dragging
          ? "scale-[0.9] border-emerald-300/80 shadow-none"
          : "border-hairline"
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
            <div className="flex h-full w-full items-center justify-center">
              <span className="max-w-[85%] px-3 text-center text-[12px] leading-snug text-faint line-clamp-3">
                {card.prompt}
              </span>
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
    </article>
  );
}

export function CardGrid({ cards, onOpen, selectMode, selection, onToggleSelect }: GridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(236px,1fr))] gap-4 px-5 pt-5 pb-10">
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

export function GridSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(236px,1fr))] gap-4 px-5 pt-5 pb-10">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-card border border-line-soft bg-card p-2.5">
          <div className="aspect-[4/3] animate-pulse rounded-tile bg-parchment" />
          <div className="space-y-2 px-1.5 pt-3 pb-2">
            <div className="h-3 w-4/5 animate-pulse rounded-full bg-parchment" />
            <div className="h-3 w-3/5 animate-pulse rounded-full bg-parchment" />
          </div>
        </div>
      ))}
    </div>
  );
}
