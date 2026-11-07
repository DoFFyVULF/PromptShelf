import { useRef } from "react";
import { useInView, usePageInView } from "motion/react";
import { ChevronsLeftRight, ClipboardPaste, ImagePlus, Import, Plus, SearchX } from "lucide-react";
import { useI18n } from "../i18n";
import { modKey } from "../lib/platform";

/** Empty prompt shelf: a miniature card — the generated scene as its cover
 * and its prompt typing itself into the caption strip below (CSS loop, calm
 * cadence, same pause scheme as the lora glyph). The cover is deliberately
 * the same baseline lighthouse the lora glyph re-renders with a lora — the
 * two shelves preview one continuous story. */
function PromptCardGlyph({ paused }: { paused?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const pageInView = usePageInView();
  const sweep = inView && pageInView && !paused ? "run" : "paused";

  return (
    <div
      ref={ref}
      data-sweep={sweep}
      aria-hidden
      className="sweep-glyph w-[224px] rounded-[12px] border border-hairline bg-card p-2 shadow-chip"
    >
      <div className="relative h-[104px] overflow-hidden rounded-[8px]">
        <LoraSceneArt applied={false} />
      </div>
      <div className="mt-2 rounded-[6px] bg-parchment px-2 py-1.5">
        <div className="prompt-type overflow-hidden whitespace-nowrap font-mono text-[10.5px] leading-tight text-muted">
          a lighthouse at dusk, calm sea
        </div>
      </div>
    </div>
  );
}

/** The mini comparison scene rendered twice: a quiet grayscale baseline and
 * the same lighthouse re-imagined once a lora is applied — violet night,
 * stars, glow. Identical geometry, different palette, like a real
 * before/after pair shot with the same prompt and seed. */
function LoraSceneArt({ applied }: { applied: boolean }) {
  const u = applied ? "b" : "a";
  const band = applied ? "#2f2258" : "#52525a";
  return (
    <svg viewBox="0 0 224 104" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={`sky-${u}`} x1="0" y1="0" x2="0" y2="1">
          {applied ? (
            <>
              <stop offset="0" stopColor="#1b1345" />
              <stop offset="0.6" stopColor="#33246b" />
              <stop offset="1" stopColor="#4c3690" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#55555d" />
              <stop offset="1" stopColor="#86868e" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`sea-${u}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={applied ? "#241a56" : "#3c3c43"} />
          <stop offset="1" stopColor={applied ? "#0f0b28" : "#232327"} />
        </linearGradient>
        <radialGradient id={`glow-${u}`}>
          <stop offset="0" stopColor="#c4b5fd" stopOpacity="0.85" />
          <stop offset="1" stopColor="#c4b5fd" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="224" height="68" fill={`url(#sky-${u})`} />
      {applied &&
        [[18, 14, 1], [46, 30, 0.8], [74, 10, 1.1], [130, 18, 0.9], [188, 8, 1.2], [204, 34, 0.8], [96, 24, 0.7], [214, 20, 0.9], [60, 44, 0.7], [146, 38, 0.8], [8, 38, 0.8], [178, 44, 0.7]].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="#ede9fe" opacity={0.4 + (i % 4) * 0.15} />
        ))}
      {applied && <circle cx="168" cy="26" r="20" fill={`url(#glow-${u})`} />}
      <circle cx="168" cy="26" r="9" fill={applied ? "#f5f3ff" : "#d4d4d8"} opacity={applied ? 0.95 : 0.5} />

      <rect y="68" width="224" height="36" fill={`url(#sea-${u})`} />
      {applied && <rect y="67.5" width="224" height="1" fill="#a78bfa" opacity="0.4" />}

      <path d="M0 88 L36 80 L80 84 L128 78 L176 84 L224 90 L224 104 L0 104 Z" fill={applied ? "#120d2c" : "#232327"} />
      <polygon points="98,86 126,86 121,46 103,46" fill={applied ? "#ece9fb" : "#a5a5ab"} />
      <polygon points="112,86 126,86 121,46 112,46" fill="#000" opacity={applied ? 0.16 : 0.1} />
      <polygon points="101.5,58 122.5,58 123.2,63 100.9,63" fill={band} />
      <polygon points="100.2,74 123.8,74 124.4,79 99.6,79" fill={band} />
      <rect x="106" y="38" width="14" height="8" rx="1" fill={applied ? "#f5f3ff" : "#d4d4d8"} opacity={applied ? 0.95 : 0.5} />
      {applied && <circle cx="113" cy="42" r="14" fill={`url(#glow-${u})`} style={{ mixBlendMode: "screen" }} />}
      <polygon points="104,38 122,38 113,30" fill={band} />

      <g fill={applied ? "#c4b5fd" : "#c8c8cc"}>
        <rect x="107" y="72" width="12" height="1.8" rx="0.9" opacity={applied ? 0.5 : 0.15} />
        <rect x="109" y="78" width="9" height="1.8" rx="0.9" opacity={applied ? 0.4 : 0.12} />
        <rect x="110" y="84" width="7" height="1.8" rx="0.9" opacity={applied ? 0.3 : 0.1} />
      </g>
      {applied &&
        [[30, 94, 0.9], [52, 99, 0.7], [88, 96, 1], [140, 94, 0.8], [186, 98, 0.9], [206, 93, 0.7], [160, 101, 0.8]].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="#c4b5fd" opacity="0.35" />
        ))}
    </svg>
  );
}

/** Empty lora shelf: a live miniature of the card's core idea — one scene,
 * two renditions, and a comparison divider gliding between them (CSS loop,
 * calm 5s cadence). The sweep runs only while the glyph is actually on
 * screen and nothing covers the shelf; reduced motion rests it at 50%. */
function LoraCardGlyph({ paused }: { paused?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const pageInView = usePageInView();
  const sweep = inView && pageInView && !paused ? "run" : "paused";

  return (
    <div
      ref={ref}
      data-sweep={sweep}
      aria-hidden
      className="sweep-glyph w-[224px] rounded-[12px] border border-hairline bg-card p-2 shadow-chip"
    >
      <div className="relative h-[104px] overflow-hidden rounded-[8px]">
        <LoraSceneArt applied={false} />
        <div className="absolute left-2 top-2 rounded-[5px] border border-hairline bg-card/80 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-muted backdrop-blur-sm">
          base
        </div>
        <div className="sweep-pane absolute inset-0">
          <LoraSceneArt applied />
          <div className="absolute right-2 top-2 rounded-[5px] border border-violet-edge bg-violet-soft/80 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-violet backdrop-blur-sm">
            with lora
          </div>
        </div>
        <div className="sweep-line absolute inset-y-0 w-[2px] -translate-x-1/2">
          <div className="h-full w-full bg-violet opacity-80" />
          <div className="absolute left-1/2 top-1/2 flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-hairline bg-card shadow-chip">
            <ChevronsLeftRight size={10} className="text-violet" />
          </div>
        </div>
      </div>
      <div className="mt-2 pb-0.5 text-center font-mono text-[10.5px] tracking-tight text-faint">
        &lt;lora:my_style:0.7&gt;
      </div>
    </div>
  );
}

interface EmptyStateProps {
  hasFilters: boolean;
  onNew: () => void;
  onPaste: () => void;
  onClear: () => void;
  /** Lora shelf: the shelf CTA becomes "add lora", the second button imports. */
  lora?: boolean;
  onImport?: () => void;
  /** True while a dialog/panel covers the shelf — pauses the glyph motion. */
  paused?: boolean;
}

export function EmptyState({ hasFilters, onNew, onPaste, onClear, lora, onImport, paused }: EmptyStateProps) {
  const { t } = useI18n();

  if (hasFilters) {
    return (
      <div className="anim-fade flex h-full flex-col items-center justify-center gap-4 pb-16 text-center">
        <SearchX size={44} strokeWidth={1.2} className="text-faint" />
        <div>
          <h2 className="t-display text-[20px] text-ink">{t("empty.noResults")}</h2>
          <p className="mt-1.5 text-[13.5px] text-muted">{t("empty.noResultsSub")}</p>
        </div>
        <button type="button" className="btn-ghost press cursor-pointer" onClick={onClear}>
          {t("action.clear")}
        </button>
      </div>
    );
  }

  if (lora) {
    return (
      <div className="anim-fade flex h-full flex-col items-center justify-center gap-5 pb-16 text-center">
        <LoraCardGlyph paused={paused} />
        <div>
          <h2 className="t-display text-[24px] text-ink">{t("empty.lora.title")}</h2>
          <p className="mx-auto mt-2 max-w-[380px] text-[14px] leading-relaxed text-muted">{t("empty.lora.sub")}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button type="button" className="btn-primary press cursor-pointer" onClick={onImport}>
            <Import size={15.5} />
            {t("empty.lora.cta")}
          </button>
          <button type="button" className="btn-ghost press cursor-pointer" onClick={onNew}>
            <Plus size={15.5} />
            {t("empty.lora.add")}
          </button>
        </div>
        <p className="text-[12.5px] text-faint">{t("empty.lora.dropHint")}</p>
      </div>
    );
  }

  return (
    <div className="anim-fade flex h-full flex-col items-center justify-center gap-5 pb-16 text-center">
      <PromptCardGlyph paused={paused} />
      <div>
        <h2 className="t-display text-[24px] text-ink">{t("empty.title")}</h2>
        <p className="mx-auto mt-2 max-w-[380px] text-[14px] leading-relaxed text-muted">{t("empty.sub")}</p>
      </div>
      <div className="flex items-center gap-2.5">
        <button type="button" className="btn-primary press cursor-pointer" onClick={onNew}>
          <ImagePlus size={15.5} />
          {t("empty.cta")}
        </button>
        <button type="button" className="btn-ghost press cursor-pointer" onClick={onPaste}>
          <ClipboardPaste size={15.5} />
          {t("empty.paste")}
          <kbd className="kbd ml-1">{modKey}V</kbd>
        </button>
      </div>
      <p className="text-[12.5px] text-faint">{t("empty.dropHint")}</p>
    </div>
  );
}
