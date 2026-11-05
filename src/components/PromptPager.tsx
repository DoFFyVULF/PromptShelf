import { useCallback, useEffect, useInsertionEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, Copy, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import { modKey } from "../lib/platform";
import type { CardDetail as CardDetailType } from "../lib/types";
import { useToast } from "./Toasts";

/* Prompt pager: the card's main prompt is page 1, every additional variant is
   another page inside the same parchment block. Page flips are iOS-style —
   the outgoing page slides out while the incoming one slides in, direction
   aware, on the Apple ease curve; the active page dot glides along the rail. */

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

// JS twin of APPLE_EASE cubic-bezier(0.32, 0.72, 0, 1) for the rAF-driven dot,
// so the ink pill and the white digit window move in the very same frame
function easeBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-4) break;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sampleY(Math.min(1, Math.max(0, t)));
  };
}
const EASE_APPLE_FN = easeBezier(0.32, 0.72, 0, 1);

// edge fade + scroll padding of the rail, kept in sync so the active pill
// always lands fully inside the unfaded zone
const RAIL_PAD = 8;

interface PromptPagerProps {
  card: CardDetailType;
  /** Replaces the card in App state after every persisted mutation. */
  onChanged: (card: CardDetailType) => void;
  /** Clipboard helper with the Tauri fallback (shared with the detail view). */
  copyText: (text: string) => Promise<boolean>;
}

export function PromptPager({ card, onChanged, copyText }: PromptPagerProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const reduced = useReducedMotion();

  const pages = [card.prompt, ...card.variants];
  const multi = pages.length > 1; // declared early: the rail effects read it in deps

  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1); // 1 → forward, -1 → back
  const [mode, setMode] = useState<"view" | "edit" | "add">("view");
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [armed, setArmed] = useState(false); // two-tap delete
  const [saving, setSaving] = useState(false);

  const armTimer = useRef<number | null>(null);
  const copyTimer = useRef<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const whiteRef = useRef<HTMLDivElement>(null); // white digits, clipped to the dot
  const dotAnim = useRef<number | null>(null);
  const railAnim = useRef<number | null>(null);
  const prevIdx = useRef(0); // direction of travel for the rail follow policy
  const dotPos = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const dotLive = useRef(false); // false → next dot update must not animate
  const shellRef = useRef<HTMLDivElement>(null);
  const [railScrolls, setRailScrolls] = useState(false); // strip overflows on narrow windows
  // captured right before a commit that reshapes the prompt block: scrollTop of
  // the dialog column, the block's layout height, and whether the digits rail
  // (the block's bottom edge) was already on screen
  const pin = useRef<{ el: HTMLElement; top: number; h: number | null; railVisible: boolean } | null>(null);

  // keep the current page valid when variants shrink (delete) or the card swaps
  useEffect(() => {
    setIdx((i) => Math.min(i, pages.length - 1));
  }, [pages.length]);

  useEffect(() => {
    setIdx(0);
    setDir(1);
    setMode("view");
    setArmed(false);
  }, [card.id]);

  useEffect(
    () => () => {
      if (armTimer.current) window.clearTimeout(armTimer.current);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      if (dotAnim.current) window.cancelAnimationFrame(dotAnim.current);
      if (railAnim.current) window.cancelAnimationFrame(railAnim.current);
    },
    []
  );

  // rail only fades its edges when it actually overflows
  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el) {
      setRailScrolls(false);
      dotLive.current = false; // the dot remounts with the rail → no glide-in
      return;
    }
    const sync = () => setRailScrolls(el.scrollWidth - el.clientWidth > 2);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [pages.length, mode, multi]);

  // the active-pill dot and a white copy of the digits clipped to it are both
  // driven by ONE rAF loop: the pill glides and the white window follows it in
  // the very same frame, so a digit turns white exactly while the ink pill is
  // under it — there is no discrete color change (and nothing to go out of
  // phase) at any point of the flight
  useLayoutEffect(() => {
    if (dotAnim.current) {
      cancelAnimationFrame(dotAnim.current);
      dotAnim.current = null;
    }
    const strip = railRef.current;
    const dot = dotRef.current;
    const white = whiteRef.current;
    const pill = strip?.children[idx] as HTMLElement | undefined;
    if (!strip || !dot || !white || !pill || !multi || mode !== "view") return;

    const scrollW = strip.scrollWidth;
    const apply = (x: number, y: number, w: number, h: number) => {
      dot.style.transform = `translate(${x}px, ${y}px)`;
      dot.style.width = `${w}px`;
      dot.style.height = `${h}px`;
      white.style.width = `${scrollW}px`;
      white.style.clipPath = `inset(0 ${Math.max(0, scrollW - x - w)}px 0 ${Math.max(0, x)}px)`;
      dotPos.current = { x, y, w, h };
    };

    const to = { x: pill.offsetLeft, y: pill.offsetTop, w: pill.offsetWidth, h: pill.offsetHeight };

    if (!dotLive.current || reduced) {
      apply(to.x, to.y, to.w, to.h);
      dotLive.current = true;
      return;
    }

    const from = dotPos.current;
    const start = performance.now();
    const duration = 300;
    const step = (now: number) => {
      const p = EASE_APPLE_FN(Math.min(1, (now - start) / duration));
      apply(
        from.x + (to.x - from.x) * p,
        from.y + (to.y - from.y) * p,
        from.w + (to.w - from.w) * p,
        from.h + (to.h - from.h) * p
      );
      dotAnim.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    dotAnim.current = requestAnimationFrame(step);

    return () => {
      if (dotAnim.current) {
        cancelAnimationFrame(dotAnim.current);
        dotAnim.current = null;
      }
    };
  }, [idx, pages.length, mode, multi, reduced]);

  // rail follow policy, direction-aware:
  //  • forward  → the clicked digit parks at the LEFT edge, so 14, 15, … open
  //    up to the right
  //  • backward → it parks at the RIGHT edge, so the earlier digits open up to
  //    the left and near the start the strip lands on 0 (digit 1 visible)
  useEffect(() => {
    const el = railRef.current;
    const active = el?.children[idx] as HTMLElement | undefined;
    const forward = idx >= prevIdx.current;
    prevIdx.current = idx;
    if (!el || !active || !multi) return;
    if (railAnim.current) {
      cancelAnimationFrame(railAnim.current);
      railAnim.current = null;
    }
    const pad = RAIL_PAD + 2;
    const visible = el.clientWidth;
    const max = Math.max(0, el.scrollWidth - visible);
    const raw = forward
      ? active.offsetLeft - pad
      : active.offsetLeft + active.offsetWidth + pad - visible;
    const target = Math.max(0, Math.min(max, raw));
    const from = el.scrollLeft;
    if (Math.abs(target - from) <= 1) return;
    if (reduced) {
      el.scrollLeft = target;
      return;
    }
    const start = performance.now();
    const duration = 260;
    const step = (now: number) => {
      const p = EASE_APPLE_FN(Math.min(1, (now - start) / duration));
      el.scrollLeft = from + (target - from) * p;
      railAnim.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    railAnim.current = requestAnimationFrame(step);
    return () => {
      if (railAnim.current) {
        cancelAnimationFrame(railAnim.current);
        railAnim.current = null;
      }
    };
  }, [idx, pages.length, mode, multi, reduced]);

  const disarm = useCallback(() => {
    if (armTimer.current) window.clearTimeout(armTimer.current);
    armTimer.current = null;
    setArmed(false);
  }, []);

  // remember the scroll context BEFORE the state update that will reshape this
  // block; after the commit the scroll is corrected so that when the block
  // grows or shrinks, its bottom edge — where the page digits are — stays
  // exactly where it was on screen instead of drifting out of view
  const capturePin = useCallback(() => {
    const shell = shellRef.current;
    let node: HTMLElement | null = shell;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      node = node.parentElement;
    }
    if (!node || !shell) {
      pin.current = null;
      return;
    }
    const box = shell.getBoundingClientRect();
    const sBox = node.getBoundingClientRect();
    // does the user already see the bottom of the block (digits right below)?
    const railVisible = box.bottom < sBox.bottom - 8 || box.bottom - sBox.top < sBox.height;
    pin.current = { el: node, top: node.scrollTop, h: shell.offsetHeight, railVisible };
  }, []);

  // useInsertionEffect, not useLayoutEffect: motion measures the shared
  // layoutId pill flight in ITS layout effects, and a child's layout effects
  // always run first. If the scroll correction happened later, the pill would
  // fly from stale coordinates and only snap into place at the end — exactly
  // the "wobbles then settles" artifact. Insertion effects run before every
  // layout effect, so the flight is measured against the final geometry.
  useInsertionEffect(() => {
    const p = pin.current;
    if (!p) return;
    pin.current = null;
    const shell = shellRef.current;
    // offsetHeight reads flow layout, ignoring motion's transform-based
    // height morph — exactly the value the flow position of the rail follows
    const delta = shell && p.railVisible && p.h !== null ? shell.offsetHeight - p.h : 0;
    const target = p.top + delta;
    if (Math.abs(p.el.scrollTop - target) > 1) p.el.scrollTop = target;
  }, [card, idx, mode]);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, next));
      if (clamped === idx) return;
      capturePin();
      setDir(clamped > idx ? 1 : -1);
      setMode("view");
      disarm();
      setIdx(clamped);
    },
    [capturePin, disarm, idx, pages.length]
  );

  const copy = useCallback(async () => {
    if (await copyText(pages[idx])) {
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    }
  }, [copyText, idx, pages]);

  const startEdit = useCallback(() => {
    capturePin();
    setDraft(pages[idx]);
    setMode("edit");
    disarm();
  }, [capturePin, disarm, idx, pages]);

  const startAdd = useCallback(() => {
    // a new variant is written from page 1; after save the pager lands on it
    capturePin();
    setDraft("");
    setDir(1);
    setIdx(0);
    setMode("add");
    disarm();
  }, [capturePin, disarm]);

  const cancel = useCallback(() => {
    capturePin();
    setMode("view");
  }, [capturePin]);

  // one write path for every mutation: the whole card passes through
  // update_card and variants ship wholesale — mirrors how the rating is saved in place
  const persist = useCallback(
    async (patch: { prompt?: string; variants?: string[] }, landing?: number) => {
      setSaving(true);
      try {
        await api.updateCard({
          id: card.id,
          prompt: patch.prompt ?? card.prompt,
          variants: patch.variants ?? card.variants,
          negative_prompt: card.negative_prompt ?? "",
          note: card.note ?? "",
          rating: card.rating,
          tags: card.tags,
          loras: card.loras ?? [],
          author: card.author ?? null,
          checkpoint: card.checkpoint ?? null,
          meta: card.meta ?? []
        });
        const fresh = await api.getCard(card.id);
        // capture in the same continuation as the commit: onChanged + setMode
        // + setIdx land in one batch, so the pin survives to the right frame
        capturePin();
        onChanged(fresh);
        setMode("view");
        toast(idx === 0 && landing === undefined ? t("toast.updated") : t("variant.saved"));
        if (landing !== undefined) {
          setDir(landing >= idx ? 1 : -1);
          setIdx(Math.max(0, landing));
        }
      } catch {
        // the draft stays open on failure so nothing is lost
      } finally {
        setSaving(false);
      }
    },
    [card, idx, capturePin, onChanged]
  );

  const saveDraft = useCallback(() => {
    const value = draft.trim();
    if (!value) return;
    if (mode === "add") {
      void persist({ variants: [...card.variants, value] }, card.variants.length);
    } else if (idx === 0) {
      // page 1 is the card's main prompt
      void persist({ prompt: value });
    } else {
      const next = [...card.variants];
      next[idx - 1] = value;
      void persist({ variants: next });
    }
  }, [card.variants, draft, idx, mode, persist]);

  const removeCurrent = useCallback(() => {
    if (idx === 0) return;
    if (!armed) {
      setArmed(true);
      if (armTimer.current) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArmed(false), 2600);
      return;
    }
    disarm();
    const next = card.variants.filter((_, i) => i !== idx - 1);
    void persist({ variants: next }, idx - 1);
  }, [armed, card.variants, disarm, idx, persist]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveDraft();
      }
    },
    [cancel, saveDraft]
  );

  const canDelete = idx > 0;

  return (
    <section className="group/pager relative">
      {/* header: label + page counter + hover actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <p className="text-[10.5px] font-semibold tracking-[0.07em] text-faint uppercase select-none">{t("editor.prompt")}</p>
          {multi && (
            <span className="rounded-full bg-parchment px-1.5 py-0.5 text-[10px] font-medium text-muted tabular-nums select-none">
              {t("detail.imageOf", { i: idx + 1, n: pages.length })}
            </span>
          )}
        </div>

        <div
          className={`flex items-center transition-opacity duration-150 ${
            mode === "view" ? "opacity-0 group-hover/pager:opacity-100 focus-within:opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <button
            type="button"
            aria-label={t("action.copy")}
            title={t("action.copy")}
            onClick={copy}
            className="press -mr-1 flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md text-faint hover:bg-parchment hover:text-ink"
          >
            {copied ? <Check size={12.5} className="text-leaf-icon" /> : <Copy size={12.5} />}
          </button>
          <button
            type="button"
            aria-label={t("action.edit")}
            title={t("action.edit")}
            onClick={startEdit}
            className="press flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md text-faint hover:bg-parchment hover:text-ink"
          >
            <Pencil size={12} />
          </button>
          {canDelete && (
            <button
              type="button"
              aria-label={armed ? t("action.confirmDelete") : t("variant.deleteTitle")}
              title={armed ? t("action.confirmDelete") : t("variant.deleteTitle")}
              onClick={removeCurrent}
              className={`press flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md ${
                armed ? "bg-destructive text-on-ink" : "text-faint hover:bg-destructive-soft hover:text-destructive"
              }`}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* parchment block: the flipping page surface. The old page pops out of
         layout during the flip so the block never collapses to zero height —
         a zero-height frame clamps the dialog column's scroll and throws the
         user to the top on long prompts. The wrapper morphs height instead. */}
      <motion.div
        ref={shellRef}
        layout={!reduced}
        transition={{ duration: reduced ? 0 : 0.3, ease: APPLE_EASE }}
        className={`relative mt-2 mb-2 rounded-xl transition-[box-shadow] duration-200 ${armed ? "shadow-[0_0_0_1px_rgb(220_38_38/0.45)]" : ""}`}
      >
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          {mode === "view" ? (
            <motion.div
              key={`page-${idx}-${pages[idx].length}`}
              custom={dir}
              variants={{
                enter: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * 40 }),
                center: { opacity: 1, x: 0 },
                exit: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * -40 })
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: reduced ? 0.14 : 0.3, ease: APPLE_EASE }}
              className="rounded-xl bg-parchment px-4 py-3.5 text-[13.5px] leading-[1.62] whitespace-pre-wrap text-body select-text"
            >
              {pages[idx]}
            </motion.div>
          ) : (
            <motion.div
              key="draft"
              initial={{ opacity: 0, y: reduced ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : 6 }}
              transition={{ duration: reduced ? 0.14 : 0.24, ease: APPLE_EASE }}
            >
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                spellCheck={false}
                rows={6}
                placeholder={mode === "add" ? t("variant.add.placeholder") : t("editor.prompt.placeholder")}
                className="field-in-block resize-none select-text"
              />
              <div className="mt-1.5 flex items-center gap-2">
                <span className="min-w-0 mr-auto truncate text-[10.5px] text-faint select-none">
                  {modKey}↩ · {t("action.cancel")}: Esc
                </span>
                <button
                  type="button"
                  onClick={cancel}
                  className="press cursor-pointer rounded-full border border-hairline bg-card px-3 py-1 text-[12px] font-medium text-ink hover:bg-parchment"
                >
                  {t("action.cancel")}
                </button>
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={saving || !draft.trim()}
                  className="press flex cursor-pointer items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-on-ink hover:bg-ink-hover disabled:cursor-default disabled:opacity-40"
                >
                  {saving && <Loader2 size={11} className="spin" />}
                  {t("action.save")}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* bottom rail: chevrons + page indicators + add-variant pill.
         Many variants compress into a dot strip so the rail never overflows. */}
      <div className="flex min-w-0 items-center gap-1">
        {multi && mode === "view" && (
          <>
            <button
              type="button"
              aria-label="Previous"
              onClick={() => go(idx - 1)}
              disabled={idx === 0}
              className="press flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-faint hover:bg-parchment hover:text-ink disabled:cursor-default disabled:opacity-30"
            >
              <ChevronLeft size={12} />
            </button>
            <div
              ref={railRef}
              style={{
                scrollBehavior: "auto",
                ...(railScrolls
                  ? {
                      maskImage: `linear-gradient(to right, transparent 0, black ${RAIL_PAD}px, black calc(100% - ${RAIL_PAD}px), transparent 100%)`,
                      WebkitMaskImage: `linear-gradient(to right, transparent 0, black ${RAIL_PAD}px, black calc(100% - ${RAIL_PAD}px), transparent 100%)`
                    }
                  : {})
              }}
              className="relative flex min-w-0 items-center gap-1 overflow-x-auto scroll-hidden py-1 -my-1 pl-2"
            >
              {pages.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={i === 0 ? t("variant.original") : `${t("editor.prompt")} ${i + 1}`}
                  title={p.length > 44 ? `${p.slice(0, 44)}…` : p}
                  onClick={() => go(i)}
                  className="relative flex h-5 min-w-5 shrink-0 cursor-pointer items-center justify-center rounded-full px-1"
                >
                  {/* base digit: a constant muted tone, never animated */}
                  <span className="text-[10px] font-medium tabular-nums text-faint">{i + 1}</span>
                </button>
              ))}
              {/* trailing pad: the last pill never sits inside the fade zone */}
              <span className="w-2 shrink-0" aria-hidden />
              {/* the one active-pill dot: absolute, driven imperatively above */}
              <span
                ref={dotRef}
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 rounded-full bg-ink"
                style={{ width: 0, height: 0, transform: "translate(0, 0)" }}
              />
              {/* white copy of the digits, clipped to the dot: the digit reads
                 white exactly while the ink pill is under it, frame by frame,
                 so there is no color transition at all */}
              <div
                ref={whiteRef}
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 flex w-max items-center gap-1 overflow-hidden pl-2 text-on-ink"
                style={{ clipPath: "inset(0 100% 0 0)" }}
              >
                {pages.map((_, i) => (
                  <span
                    key={i}
                    className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums"
                  >
                    {i + 1}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              aria-label="Next"
              onClick={() => go(idx + 1)}
              disabled={idx === pages.length - 1}
              className="press flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-faint hover:bg-parchment hover:text-ink disabled:cursor-default disabled:opacity-30"
            >
              <ChevronRight size={12} />
            </button>
          </>
        )}

        <button
          type="button"
          aria-label={t("variant.add")}
          title={t("variant.add.short")}
          onClick={startAdd}
          disabled={mode !== "view" || card.variants.length >= 24}
          className="press ml-auto flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-dashed border-line-hover px-2.5 text-[10.5px] font-medium text-faint transition-colors hover:border-line-active hover:text-muted disabled:cursor-default disabled:opacity-40"
        >
          <Plus size={11} strokeWidth={2} />
          {t("variant.add")}
        </button>
      </div>
    </section>
  );
}
