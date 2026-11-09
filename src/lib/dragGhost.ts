import type { DragEvent as ReactDragEvent } from "react";

/**
 * The card that travels with the cursor during a drag is a shrunken painting
 * of the tile on a canvas. It is shared by both shelves so a prompt drag and a
 * Lora drag feel identical.
 *
 * The photo is drawn synchronously from the already decoded <img>, so it always
 * makes it into the drag snapshot (a cloned <img> would still be decoding and
 * render empty in WebKit). The canvas is parked behind the opaque source tile
 * (z-index -1, centred on it) so WebKit can snapshot it while nothing flashes
 * in the UI.
 */
export interface CardGhostOptions {
  /** Footer caption — the prompt line, or the Lora name. */
  title: string;
  /** Paint the footer caption semibold (Lora names are semibold on the tile). */
  strong?: boolean;
  /** Emerald count badge for multi-selection drags. */
  count?: number;
  /** Blue label pill over the image, top-left (Lora primary tag). */
  badge?: string;
  /** Dark pill over the image, bottom-right (Lora base model). */
  meta?: string;
}

/** Ghost size relative to the tile it was picked up from. */
const BASE_SCALE = 0.62;
/**
 * Depth cue: the dragged card is lifted off the shelf towards the viewer, so it
 * renders a touch larger with a deeper, softer shadow than a resting tile.
 */
const LIFT = 1.08;
const PAD = 10;
const FOOT_H = 30;
/** Room for the soft, lifted shadow inside the bitmap. */
const MARGIN = 40;

export function attachCardGhost(e: ReactDragEvent, opts: CardGhostOptions) {
  const tile = e.currentTarget as HTMLElement;
  const tileRect = tile.getBoundingClientRect();
  const box = tile.querySelector<HTMLElement>("[data-ghost-box]");
  const img = box?.querySelector("img");
  const boxRect = box?.getBoundingClientRect();
  const scale = BASE_SCALE * LIFT;
  const bw = boxRect?.width ?? tileRect.width - PAD * 2;
  const bh = boxRect?.height ?? bw * 0.75;
  const W = Math.round(bw + PAD * 2);
  const H = Math.round(PAD + bh + FOOT_H);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(W * scale) + MARGIN * 2;
  const ch = Math.round(H * scale) + MARGIN * 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  canvas.style.cssText = `position:fixed;left:${Math.round(tileRect.left + tileRect.width / 2 - cw / 2)}px;top:${Math.round(
    tileRect.top + tileRect.height / 2 - ch / 2
  )}px;width:${cw}px;height:${ch}px;pointer-events:none;z-index:-1;`;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // the ghost is painted from the live theme tokens so it matches the
    // card in both light and dark mode
    const cs = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    const cardBg = token("--color-card", "#ffffff");
    const imgBg = token("--color-parchment", "#f4f4f5");
    const footText = token("--color-body", "#3f3f46");
    const tileEdge = token("--color-hairline", "#e4e4e7");
    const action = token("--color-action", "#0066cc");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(MARGIN, MARGIN);
    ctx.scale(scale, scale);
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
      ctx.arcTo(x, y + tl, x + tl, y, tl);
      ctx.closePath();
    };
    // card body with a lifted, softly blurred shadow (shadow metrics are
    // device-space, so they are not affected by the scale above)
    ctx.save();
    ctx.shadowColor = "rgba(23,23,28,0.38)";
    ctx.shadowBlur = 26 * dpr;
    ctx.shadowOffsetY = 12 * dpr;
    ctx.fillStyle = cardBg;
    path(0, 0, W, H, 10, 10, 10, 10);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = tileEdge;
    ctx.lineWidth = 1;
    path(0.5, 0.5, W - 1, H - 1, 10, 10, 10, 10);
    ctx.stroke();
    // cover image, cover-cropped like object-cover, top corners rounded
    const iw = W - PAD * 2;
    ctx.save();
    path(PAD, PAD, iw, bh, 8, 8, 0, 0);
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
      ctx.drawImage(img, sx, sy, sw, sh, PAD, PAD, iw, bh);
    } else {
      ctx.fillStyle = imgBg;
      ctx.fillRect(PAD, PAD, iw, bh);
      ctx.fillStyle = token("--color-faint", "#a1a1aa");
      ctx.font = "500 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opts.title.slice(0, 80) || "…", PAD + iw / 2, PAD + bh / 2);
      ctx.textAlign = "left";
    }
    ctx.restore();
    // ellipsis-fit a label to the available width at the current font
    const fit = (text: string, max: number) => {
      if (ctx.measureText(text).width <= max) return text;
      let txt = text;
      while (txt.length > 1 && ctx.measureText(`${txt}…`).width > max) txt = txt.slice(0, -1);
      return `${txt}…`;
    };
    // small label pill over the image, top-left (like the tile's primary tag)
    if (opts.badge) {
      ctx.font = "700 9.5px system-ui, sans-serif";
      const label = fit(opts.badge.toUpperCase(), iw - 22);
      const tw = ctx.measureText(label).width;
      const pw = tw + 10;
      const ph = 15;
      const px = PAD + 6;
      const py = PAD + 6;
      path(px, py, pw, ph, 5, 5, 5, 5);
      ctx.fillStyle = action;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, px + 5, py + ph / 2 + 0.5);
    }
    // small meta pill over the image, bottom-right (like the base model chip)
    if (opts.meta) {
      ctx.font = "500 10.5px system-ui, sans-serif";
      const label = fit(opts.meta, iw - 30);
      const tw = ctx.measureText(label).width;
      const pw = tw + 12;
      const ph = 17;
      const px = PAD + iw - pw - 6;
      const py = PAD + bh - ph - 6;
      path(px, py, pw, ph, ph / 2, ph / 2, ph / 2, ph / 2);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, px + 6, py + ph / 2 + 0.5);
    }
    // footer: truncated title, like the tile's first line
    if (opts.title) {
      ctx.fillStyle = footText;
      ctx.font = `${opts.strong ? 600 : 500} 12.5px system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(fit(opts.title, iw), PAD, PAD + bh + FOOT_H / 2 + 1);
    }
    // emerald count pill for multi-card drags
    if (opts.count && opts.count > 1) {
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
      ctx.fillText(String(opts.count), cx, cy + 0.5);
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
}
