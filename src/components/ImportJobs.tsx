import { motion, useReducedMotion } from "motion/react";
import { Check, CloudDownload, Copy, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useI18n, type DictKey } from "../i18n";
import type { CivitaiImport, DuplicateHit } from "../lib/types";

/** One background CivitAI import: lives as a placeholder card in the grid
 * until the fetch finishes, then dissolves into the real card. */
export type ImportJobStatus = "running" | "dup" | "error" | "done";
export type ImportJobError = "url" | "notfound" | "generic";

export interface ImportJob {
  id: string;
  url: string;
  status: ImportJobStatus;
  error?: ImportJobError;
  /** Parked duplicate payload: the fetched result (or null → refetch on proceed). */
  pre?: CivitaiImport | null;
  hits?: DuplicateHit[];
}

const ENTER_SPRING = { type: "spring", stiffness: 360, damping: 31, mass: 0.9 } as const;
const EXIT_TWEEN = { duration: 0.2, ease: "easeIn" } as const;
const CHECK_SPRING = { type: "spring", stiffness: 520, damping: 22 } as const;

/** Short link for the placeholder card and the dialog queue: no scheme, no www. */
export function importJobLabel(url: string): string {
  const cut = url.replace(/^https?:\/\/(www\.)?/i, "");
  return cut.length > 44 ? `${cut.slice(0, 44)}…` : cut || url;
}

export function importErrorToKey(msg: string): ImportJobError {
  return String(msg).includes("CIVITAI_URL")
    ? "url"
    : String(msg).includes("CIVITAI_NOT_FOUND") || String(msg).includes("CIVITAI_NO_IMAGE")
      ? "notfound"
      : "generic";
}

interface ImportJobTileProps {
  job: ImportJob;
  onRetry: (job: ImportJob) => void;
  onDismiss: (id: string) => void;
  /** Lora shelf: the same tile, model-page error copy. */
  lora?: boolean;
}

/** Grid placeholder that mirrors the CardTile anatomy: cover area up top,
 * meta underneath. Running = dormant cover with a light sweep; done = a
 * stamped check for a beat before the tile dissolves under the real card. */
export function ImportJobTile({ job, onRetry, onDismiss, lora }: ImportJobTileProps) {
  const { t } = useI18n();
  const reduce = useReducedMotion() ?? false;
  const label = importJobLabel(job.url);
  const errorKey = (err: ImportJobError) =>
    lora
      ? `import.lora.error${err === "url" ? "Url" : err === "notfound" ? "NotFound" : "Generic"}`
      : `import.civitai.error${err === "url" ? "Url" : err === "notfound" ? "NotFound" : "Generic"}`;

  return (
    <motion.article
      layout={reduce ? undefined : true}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.96 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, transition: EXIT_TWEEN }}
      transition={reduce ? { duration: 0.2 } : ENTER_SPRING}
      className={`overflow-hidden rounded-card border bg-card ${
        job.status === "error" ? "border-destructive/40" : "border-hairline"
      }`}
    >
      <div className="p-2.5 pb-0">
        <div
          className={`relative aspect-[4/3] overflow-hidden rounded-tile bg-parchment ${
            job.status === "error" ? "bg-destructive-soft" : ""
          }`}
        >
          {job.status === "running" && (
            <>
              <div className="absolute inset-0 animate-pulse" />
              <div aria-hidden className="import-sweep" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-faint">
                <CloudDownload size={26} strokeWidth={1.4} />
                <Loader2 size={14} className="spin text-muted" aria-hidden />
              </div>
              <span role="status" className="sr-only">
                {t("import.jobs.running")}
              </span>
            </>
          )}

          {job.status === "done" && (
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              transition={CHECK_SPRING}
              className="absolute inset-0 flex items-center justify-center bg-leaf-icon/12"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-leaf-icon text-white shadow-chip">
                <Check size={18} strokeWidth={2.6} />
              </span>
              <span role="status" className="sr-only">
                {t("import.receipt.ok")}
              </span>
            </motion.div>
          )}

          {job.status === "dup" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-faint">
              <Copy size={26} strokeWidth={1.4} />
              <span className="rounded-full border border-hairline bg-card px-2.5 py-1 text-[11px] font-medium text-muted">
                {t("import.jobs.dup")}
              </span>
            </div>
          )}

          {job.status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-destructive">
              <TriangleAlert size={26} strokeWidth={1.4} />
              <span role="alert" className="sr-only">
                {t(errorKey(job.error ?? "generic") as DictKey)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-[108px] flex-col px-3.5 pt-2.5 pb-3">
        {job.status === "error" ? (
          <>
            <p className="line-clamp-2 min-h-[2.6em] text-[12.5px] leading-[1.42] text-destructive">
              {t(errorKey(job.error ?? "generic") as DictKey)}
            </p>
            <div className="mt-auto flex items-center justify-between pt-2.5">
              <button
                type="button"
                onClick={() => onRetry(job)}
                className="press flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-hairline bg-card px-2.5 text-[12px] font-medium text-body transition-colors hover:border-line-hover hover:bg-parchment"
              >
                <RotateCcw size={12.5} />
                {t("action.retry")}
              </button>
              <button
                type="button"
                aria-label={t("import.jobs.remove")}
                title={t("import.jobs.remove")}
                onClick={() => onDismiss(job.id)}
                className="press flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-faint transition-colors hover:bg-destructive-soft hover:text-destructive"
              >
                <X size={14} />
              </button>
            </div>
          </>
        ) : job.status === "running" ? (
          <>
            <p className="line-clamp-2 min-h-[2.6em] text-[13.5px] leading-[1.42] text-faint select-none">
              {t("import.jobs.running")}
            </p>
            <div className="mt-auto pt-2.5">
              <span title={job.url} className="block truncate text-[11.5px] text-faint select-none">
                {label}
              </span>
            </div>
          </>
        ) : (
          <>
            <p
              className={`line-clamp-2 min-h-[2.6em] text-[13.5px] leading-[1.42] select-none ${
                job.status === "dup" ? "text-muted" : "text-leaf-icon"
              }`}
            >
              {job.status === "done" ? t("import.receipt.ok") : t("import.jobs.dup")}
            </p>
            <div className="mt-auto pt-2.5">
              <span title={job.url} className="block truncate text-[11.5px] text-faint select-none">
                {label}
              </span>
            </div>
          </>
        )}
      </div>
    </motion.article>
  );
}
