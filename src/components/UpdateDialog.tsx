import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { CheckCircle2, Download, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { useI18n } from "../i18n";
import type { UpdateAvailability } from "../lib/useUpdateCheck";
import { Dialog, DialogCloseButton } from "./Dialog";

type Phase = "checking" | "latest" | "available" | "downloading" | "restarting" | "error";

interface UpdateDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-resolved availability (logo badge) — skips the network check. */
  known: UpdateAvailability | null;
  /** The user closed the dialog while an update was pending — the header
   * indicator hides until the next launch. */
  onDismissed: () => void;
  /** A manual check from this dialog found an update — report it back so the
   * app-wide availability state stays in sync. */
  onFound?: (a: UpdateAvailability) => void;
}

/** "Check for updates" flow: check → nice result → install → relaunch.
 * When opened with a known availability the check is skipped entirely. */
export function UpdateDialog({ open, onClose, known, onDismissed, onFound }: UpdateDialogProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("checking");
  const [available, setAvailable] = useState<UpdateAvailability | null>(null);
  const [current, setCurrent] = useState("");

  const checkNow = useCallback(async (alive: { ok: boolean }) => {
    setPhase("checking");
    setAvailable(null);
    try {
      const found = await check();
      if (!alive.ok) return;
      setPhase(found ? "available" : "latest");
      if (found) {
        const a: UpdateAvailability = {
          version: found.version,
          body: found.body ?? "",
          real: found,
        };
        setAvailable(a);
        onFound?.(a);
      }
    } catch {
      if (alive.ok) setPhase("error");
    }
  }, [onFound]);

  useEffect(() => {
    if (!open) {
      setPhase("checking");
      setAvailable(null);
      return;
    }
    const alive = { ok: true };
    if (known) {
      setPhase("available");
      setAvailable(known);
    } else {
      void checkNow(alive);
    }
    getVersion()
      .then((v) => alive.ok && setCurrent(v))
      .catch(() => undefined);
    return () => {
      alive.ok = false;
    };
  }, [open, known, checkNow]);

  const install = useCallback(async () => {
    if (!available) return;
    setPhase("downloading");
    try {
      await available.real.downloadAndInstall();
      setPhase("restarting");
      window.setTimeout(() => {
        void relaunch().catch(() => undefined);
      }, 600);
    } catch {
      setPhase("error");
    }
  }, [available]);

  const handleClose = useCallback(() => {
    // An interrupted install can leave the app half-updated.
    if (phase === "downloading" || phase === "restarting") return;
    // Closing while an update is on the table counts as "cancel" — the user
    // said no; the header badge hides until the next launch.
    if (phase === "available" && available) onDismissed();
    onClose();
  }, [available, onClose, onDismissed, phase]);

  const icon =
    phase === "latest" ? (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-leaf-icon/10 text-leaf-icon">
        <CheckCircle2 size={26} strokeWidth={1.7} />
      </span>
    ) : phase === "available" ? (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-action/10 text-action">
        <Download size={24} strokeWidth={1.8} />
      </span>
    ) : phase === "error" ? (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle size={26} strokeWidth={1.7} />
      </span>
    ) : (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-parchment text-faint">
        <Loader2 size={22} className="spin" />
      </span>
    );

  return (
    <Dialog open={open} onClose={handleClose} labelledBy="update-title" width={440}>
      <div className="flex items-center justify-between px-6 pt-5 pb-1">
        <h2 id="update-title" className="t-display text-[19px] text-ink">
          {t("settings.updates.title")}
        </h2>
        <DialogCloseButton onClose={handleClose} label={t("action.close")} />
      </div>

      <div className="flex min-h-[220px] flex-col items-center justify-center px-8 pt-3 pb-7 text-center">
        <div className="select-none">{icon}</div>

        {phase === "checking" && (
          <p className="mt-3 text-[13.5px] text-muted">{t("settings.updates.checking")}</p>
        )}

        {phase === "latest" && (
          <>
            <p className="mt-3 text-[15px] font-semibold text-ink">{t("settings.updates.latest")}</p>
            <p className="mt-1.5 text-[12.5px] text-faint">
              {t("settings.updates.latestHint").replace("{version}", current || "—")}
            </p>
          </>
        )}

        {phase === "available" && available && (
          <>
            <p className="mt-3 text-[15px] font-semibold text-ink">
              {t("settings.updates.available").replace("{version}", available.version)}
            </p>
            {available.body && (
              <p className="mt-2 max-h-28 overflow-y-auto text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted select-text">
                {available.body}
              </p>
            )}
            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                className="btn-primary press cursor-pointer"
                onClick={() => void install()}
              >
                <Download size={14.5} />
                {t("settings.updates.install")}
              </button>
              <button type="button" className="btn-ghost press cursor-pointer" onClick={handleClose}>
                {t("action.cancel")}
              </button>
            </div>
          </>
        )}

        {phase === "downloading" && (
          <p className="mt-3 flex items-center gap-2 text-[13.5px] text-muted">
            <Loader2 size={14} className="spin" />
            {t("settings.updates.installing")}
          </p>
        )}

        {phase === "restarting" && (
          <p className="mt-3 flex items-center gap-2 text-[13.5px] text-muted">
            <Loader2 size={14} className="spin" />
            {t("settings.location.moved")}
          </p>
        )}

        {phase === "error" && (
          <>
            <p className="mt-3 max-w-[300px] text-[12.5px] leading-relaxed text-destructive">{t("settings.updates.error")}</p>
            <button
              type="button"
              className="btn-ghost press mt-4 cursor-pointer"
              onClick={() => void checkNow({ ok: true })}
            >
              <RefreshCw size={14.5} />
              {t("settings.updates.check")}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
