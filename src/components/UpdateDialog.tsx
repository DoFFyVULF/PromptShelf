import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { CheckCircle2, Download, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { useI18n } from "../i18n";
import { Dialog, DialogCloseButton } from "./Dialog";

type Phase = "checking" | "latest" | "available" | "downloading" | "restarting" | "error";

interface UpdateDialogProps {
  open: boolean;
  onClose: () => void;
}

/** "Check for updates" flow: check → nice result → install → relaunch. */
export function UpdateDialog({ open, onClose }: UpdateDialogProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("checking");
  const [update, setUpdate] = useState<Update | null>(null);
  const [current, setCurrent] = useState("");

  const checkNow = useCallback(async (alive: { ok: boolean }) => {
    setPhase("checking");
    setUpdate(null);
    try {
      const found = await check();
      if (!alive.ok) return;
      setPhase(found ? "available" : "latest");
      if (found) setUpdate(found);
    } catch {
      if (alive.ok) setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const alive = { ok: true };
    void checkNow(alive);
    getVersion()
      .then((v) => alive.ok && setCurrent(v))
      .catch(() => undefined);
    return () => {
      alive.ok = false;
    };
  }, [open, checkNow]);

  const install = useCallback(async () => {
    if (!update) return;
    setPhase("downloading");
    try {
      await update.downloadAndInstall();
      setPhase("restarting");
      window.setTimeout(() => {
        void relaunch().catch(() => undefined);
      }, 600);
    } catch {
      setPhase("error");
    }
  }, [update]);

  const handleClose = useCallback(() => {
    // An interrupted install can leave the app half-updated.
    if (phase === "downloading" || phase === "restarting") return;
    onClose();
  }, [onClose, phase]);

  const icon =
    phase === "latest" ? (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
        <CheckCircle2 size={26} strokeWidth={1.7} />
      </span>
    ) : phase === "available" ? (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 text-blue-600">
        <Download size={24} strokeWidth={1.8} />
      </span>
    ) : phase === "error" ? (
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-600">
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

        {phase === "available" && (
          <>
            <p className="mt-3 text-[15px] font-semibold text-ink">
              {t("settings.updates.available").replace("{version}", update?.version ?? "")}
            </p>
            {update?.body && (
              <p className="mt-2 max-h-28 overflow-y-auto text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted select-text">
                {update.body}
              </p>
            )}
            <button type="button" className="btn-primary press mt-5 cursor-pointer" onClick={() => void install()}>
              <Download size={14.5} />
              {t("settings.updates.install")}
            </button>
          </>
        )}

        {(phase === "downloading" || phase === "restarting") && (
          <p className="mt-3 flex items-center gap-2 text-[13.5px] text-muted">
            <Loader2 size={14} className="spin" />
            {phase === "downloading" ? t("settings.updates.installing") : t("settings.location.moved")}
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
