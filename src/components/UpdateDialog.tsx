import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { CheckCircle2, Download, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { useI18n } from "../i18n";
import type { UpdateAvailability } from "../lib/useUpdateCheck";
import { Dialog, DialogCloseButton } from "./Dialog";

type Phase = "checking" | "latest" | "available" | "downloading" | "restarting" | "error";

const INLINE_MD = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(\S+\))/g;

/** GitHub release bodies are markdown. Render the subset they actually use —
 * headings, bullets, bold, inline code, links — into quiet, readable rows
 * instead of a gray wall of asterisks. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE_MD)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(
        <strong key={`${keyBase}-${k++}`} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <code
          key={`${keyBase}-${k++}`}
          className="rounded-md border border-hairline bg-card px-1.5 py-[1px] font-mono text-[11px] text-ink"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      const label = tok.slice(1, tok.indexOf("]"));
      const href = tok.slice(tok.indexOf("(") + 1, -1);
      out.push(
        /^https?:\/\//.test(href) ? (
          <a
            key={`${keyBase}-${k++}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-action hover:underline"
          >
            {label}
          </a>
        ) : (
          label
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function ReleaseNotes({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let bullets: ReactNode[][] = [];
  let para: string[] = [];
  let k = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push(<p key={`p-${k++}`}>{renderInline(para.join(" "), `p${k}`)}</p>);
    para = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    blocks.push(
      <ul key={`ul-${k++}`} className="space-y-1.5">
        {items.map((node, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-faint" />
            <span className="min-w-0">{node}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      bullets.push(renderInline(line.replace(/^[-*]\s+/, ""), `b${k}-${bullets.length}`));
    } else if (line === "") {
      flushPara();
      flushBullets();
    } else if (/^#{1,6}\s+/.test(line)) {
      flushPara();
      flushBullets();
      blocks.push(
        <p key={`h-${k++}`} className="text-[13px] font-semibold text-ink">
          {renderInline(line.replace(/^#+\s+/, ""), `h${k}`)}
        </p>,
      );
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();

  return (
    <div className="mt-3 max-h-56 w-full overflow-y-auto rounded-xl bg-parchment px-4 py-3.5 text-left">
      <div className="space-y-2.5 text-[12.5px] leading-relaxed text-body">
        {blocks}
      </div>
    </div>
  );
}

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
            {available.body && <ReleaseNotes body={available.body} />}
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
            {t("settings.updates.restarting")}
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
