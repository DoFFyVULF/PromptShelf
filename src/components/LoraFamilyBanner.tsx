import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useI18n } from "../i18n";

interface LoraFamilyBannerProps {
  count: number;
  onGroup: () => void;
  onDismiss: () => void;
}

/**
 * The quiet offer that appears in the header — between search and sort — when
 * the shelf holds the same lora in more than one version / base model. One
 * blue pill to accept, one ghost close to decline; no third accent, no shadow.
 */
export function LoraFamilyBanner({
  count,
  onGroup,
  onDismiss,
}: LoraFamilyBannerProps) {
  const { t } = useI18n();
  const reduce = useReducedMotion() ?? false;

  return (
    <AnimatePresence initial={false}>
      {count > 0 && (
        <motion.div
          key="lora-family-offer"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, x: 8 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, x: 8 }}
          transition={
            reduce
              ? { duration: 0.12 }
              : { type: "spring", stiffness: 420, damping: 32 }
          }
          title={t("family.banner", { n: count })}
          className="flex h-9 shrink-0 items-center gap-2 overflow-hidden rounded-full border border-action/20 bg-action/[0.06] py-0 pr-1 pl-2.5"
        >
          {/* A tiny deck — the same Z-tilt as the group tile, one glance ahead. */}
          <span aria-hidden className="relative block h-[18px] w-[24px] shrink-0">
            {[-20, 0, 20].map((angle, i) => (
              <span
                key={i}
                style={{
                  zIndex: i + 1,
                  transform: `translateX(-50%) rotateZ(${angle}deg)`,
                }}
                className={`absolute top-[1px] left-1/2 h-[16px] w-[11px] rounded-[3px] border ${
                  i === 1
                    ? "border-action/40 bg-card"
                    : "border-action/25 bg-action/10"
                }`}
              />
            ))}
          </span>
          <span className="hidden max-w-[220px] truncate text-[12px] font-medium text-body xl:inline">
            {t("family.banner", { n: count })}
          </span>
          <button
            type="button"
            onClick={onGroup}
            className="press-bg flex h-7 shrink-0 cursor-pointer items-center rounded-full bg-action px-3 text-[12px] font-medium text-white transition-[filter] hover:brightness-110"
          >
            {t("family.group")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("family.dismiss")}
            title={t("family.dismiss")}
            className="btn-icon press-bg h-7 w-7 shrink-0 cursor-pointer"
          >
            <X size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
