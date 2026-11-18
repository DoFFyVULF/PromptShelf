import { motion, useReducedMotion } from "motion/react";
import { Layers2, Ungroup } from "lucide-react";
import { useI18n, type DictKey } from "../i18n";
import { assetUrl } from "../lib/api";
import type { LoraFamily } from "../lib/loraFamilies";

interface LoraFamilyTileProps {
  family: LoraFamily;
  onOpen: (id: string) => void;
  onSplit: (id: string) => void;
  delay: number;
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
  onSplit,
  delay,
}: LoraFamilyTileProps) {
  const { t, lang, formatDate } = useI18n();
  const reduce = useReducedMotion() ?? false;

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
      className={`anim-tile group relative flex cursor-pointer flex-col overflow-hidden rounded-card border border-hairline bg-card transition-[border-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-hover hover:shadow-tile-hover`}
      style={{ animationDelay: `${Math.min(delay, 320)}ms` }}
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
                  <img
                    src={assetUrl(lora.cover.thumb)}
                    alt=""
                    draggable={false}
                    loading="lazy"
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

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSplit(family.id);
            }}
            aria-label={t("family.split")}
            title={t("family.split")}
            className="press absolute top-1.5 right-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Ungroup size={14} />
          </button>

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
