import { motion, useReducedMotion } from "motion/react";
import { Layers, Plus, FolderOpen } from "lucide-react";
import { useI18n } from "../i18n";

interface GroupEmptyStateProps {
  /** Shown in the hint so it is obvious which folder is empty. */
  groupName?: string;
  lora?: boolean;
  onNew: () => void;
  onShowAll: () => void;
}

/** A quiet state for a folder that exists but holds nothing yet. It is
 * deliberately smaller than the shelf-wide EmptyState: the library is alive,
 * this one group is just waiting. */
export function GroupEmptyState({ groupName, lora, onNew, onShowAll }: GroupEmptyStateProps) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { type: "spring", visualDuration: 0.36, bounce: 0.08 }}
      className="flex h-full flex-col items-center justify-center gap-5 pb-16 text-center"
    >
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-2xl border border-hairline bg-card text-faint shadow-chip"
      >
        <FolderOpen size={23} strokeWidth={1.4} />
      </span>
      <div>
        <h2 className="t-display text-[20px] text-ink">{t("groups.empty.title")}</h2>
        <p className="mx-auto mt-1.5 max-w-[380px] text-[13.5px] leading-relaxed text-muted">
          {groupName
            ? t("groups.empty.subNamed", { name: groupName })
            : t("groups.empty.sub")}
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        <button type="button" className="btn-primary press cursor-pointer" onClick={onNew}>
          <Plus size={15.5} />
          {lora ? t("action.newLora") : t("action.new")}
        </button>
        <button type="button" className="btn-ghost press cursor-pointer" onClick={onShowAll}>
          <Layers size={15} />
          {t(lora ? "groups.all.lora" : "groups.all")}
        </button>
      </div>
    </motion.div>
  );
}
