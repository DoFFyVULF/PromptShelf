import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Layers2, Pin } from "lucide-react";
import { useI18n, type DictKey } from "../i18n";
import { assetUrl } from "../lib/api";
import { GridImage } from "./GridImage";
import type { LoraFamily } from "../lib/loraFamilies";

interface LoraFamilyTileProps {
  family: LoraFamily;
  onOpen: (id: string) => void;
  /** Pins or unpins every variant the group is made of. */
  onTogglePin: (memberIds: string[], pinned: boolean) => void;
  delay: number;
  /** First-screen tiles keep the staggered entrance; scrolled-in ones do not. */
  enter: boolean;
}

/**
 * Same footprint as a lora tile: identical padding, 4:3 cover, two-line name,
 * chip row and footer. The cover is a small deck of the variants, tilted on
 * Z and fanned out on hover — the group reads at a glance without hiding any
 * of its members.
 */
export function LoraFamilyTile({
  family,
  onOpen,
  onTogglePin,
  delay,
  enter,
}: LoraFamilyTileProps) {
  const { t, lang, formatDate } = useI18n();
  const reduce = useReducedMotion() ?? false;
  // seeded once: a reorder must not replay the entrance animation
  const [stagger] = useState(() => Math.min(delay, 320));
  // A deck mounted by the virtual window after the first beat stays quiet.
  const [entrance] = useState(enter);

  // The deck is one shelf entry: it only reads as pinned when every variant
  // is, and toggling it pins the whole group at once.
  const pinned = family.members.every((lora) => lora.pinned);
  const memberIds = family.members.map((lora) => lora.id);

  const shown = family.members.slice(0, 3);
  const angles = shown.length === 2 ? [-8, 8] : [-13, 0, 13];
  const shifts = shown.length === 2 ? [-11, 11] : [-17, 0, 17];

  const n = family.members.length;
  const variantKey: DictKey =
    lang === "ru"
      ? n % 10 === 1 && n % 100 !== 11
        ? "family.variants.one"
        : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
          ? "family.variants.few"
          : "family.variants.many"
      : n === 1
        ? "family.variants.one"
        : "family.variants.other";

  const activate = () => onOpen(family.id);

  return (
    <article
      className={`${entrance ? "anim-tile " : ""}group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-card border bg-card transition-[border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-hover hover:shadow-tile-hover ${
        pinned ? "tile-pinned" : "border-hairline"
      }`}
      style={entrance ? { animationDelay: `${stagger}ms` } : undefined}
      onClick={activate}
      role="button"
      tabIndex={0}
      aria-label={`${family.name} — ${t(variantKey, { n })}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
    >
      <div className="p-2.5 pb-0">
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-tile bg-parchment">
          <motion.div
            className="relative h-full w-full"
            initial="rest"
            animate="rest"
            whileHover={reduce ? undefined : "hover"}
          >
            {shown.map((lora, i) => (
              <motion.div
                key={lora.id}
                className="absolute inset-0 m-auto h-[70%] w-[56%] overflow-hidden rounded-[10px] border border-hairline bg-card shadow-product"
                style={{ zIndex: i + 1 }}
                variants={{
                  rest: { rotateZ: angles[i], x: shifts[i], y: 0, scale: 1 },
                  hover: {
                    rotateZ: angles[i] * 1.4,
                    x: shifts[i] * 1.75,
                    y: -5 + i * 2,
                    scale: 1.03,
                  },
                }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 320, damping: 24 }
                }
              >
                {lora.cover ? (
                  <GridImage
                    src={assetUrl(lora.cover.thumb)}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    className="no-drag h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-faint">
                    <Layers2 size={20} strokeWidth={1.4} />
                  </div>
                )}
              </motion.div>
            ))}
          </motion.div>

          <span className="absolute top-1.5 left-1.5 rounded-md bg-action px-1.5 py-[2px] text-[9.5px] font-bold tracking-wide text-white uppercase shadow-chip">
            {t(family.reason === "version" ? "family.badge.version" : "family.badge.model")}
          </span>

          <div className="absolute top-1.5 right-1.5 flex items-center gap-1.5">
            {/* Pin control mirrors a single lora tile: a quiet glass chip on
                hover, a struck gold seal once the whole group is pinned. */}
            <motion.button
              type="button"
              draggable={false}
              className={`pin-chip ${pinned ? "is-on" : ""} ${
                pinned
                  ? ""
                  : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
              }`}
              aria-label={pinned ? t("family.unpin") : t("family.pin")}
              aria-pressed={pinned}
              title={pinned ? t("family.unpin") : t("family.pin")}
              onClick={(e) => {
                e.stopPropagation();
                // drop the focus before the deck moves, or WebKit scrolls the
                // button back into view
                if (e.detail > 0) e.currentTarget.blur();
                onTogglePin(memberIds, !pinned);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              whileHover={reduce ? undefined : { scale: 1.08 }}
              whileTap={reduce ? undefined : { scale: 0.88 }}
              transition={{ type: "spring", stiffness: 520, damping: 26 }}
            >
              <motion.span
                key={pinned ? "on" : "off"}
                initial={{ scale: 0.55, rotate: -35, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={
                  reduce ? { duration: 0 } : { type: "spring", stiffness: 560, damping: 20 }
                }
              >
                <Pin size={14} strokeWidth={2.2} className={pinned ? "fill-current" : undefined} />
              </motion.span>
            </motion.button>
          </div>

          {n > 3 && (
            <span className="absolute right-1.5 bottom-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white backdrop-blur-sm">
              +{n - 3}
            </span>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3.5 pt-2.5 pb-3">
        <p className="line-clamp-2 min-h-[2.2em] text-[13.5px] font-semibold leading-[1.38] tracking-[-0.01em] text-ink">
          {family.name}
        </p>

        <div className="mt-1.5 flex min-h-[20px] flex-wrap items-center gap-1">
          {family.members.slice(0, 3).map((lora) => (
            <span
              key={lora.id}
              title={lora.name}
              className="max-w-[110px] truncate rounded-full bg-parchment px-2 py-0.5 text-[10.5px] font-medium text-muted"
            >
              {lora.base_model || lora.name}
            </span>
          ))}
        </div>

        <div className="mt-auto flex items-center justify-between pt-2.5">
          <span className="text-[11.5px] text-faint">
            {formatDate(family.members[0].created_at)}
          </span>
          <span className="flex items-center gap-1 text-[11.5px] font-medium text-body">
            <Layers2 size={11.5} />
            {t(variantKey, { n })}
          </span>
        </div>
      </div>
    </article>
  );
}
