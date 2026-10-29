import { useCallback, useEffect, useRef, useState } from "react";
import { CloudDownload, Loader2 } from "lucide-react";
import { useI18n } from "../i18n";
import { Dialog, DialogCloseButton } from "./Dialog";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Resolves on success; the parent opens the editor. Rejects with the backend error string. */
  onImport: (url: string) => Promise<void>;
}

type ImportError = "url" | "notfound" | "generic";

export function ImportDialog({ open, onClose, onImport }: ImportDialogProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ImportError | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    window.setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  const submit = useCallback(async () => {
    const v = url.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onImport(v);
    } catch (e) {
      const msg = String(e);
      setError(
        msg.includes("CIVITAI_URL") ? "url" : msg.includes("CIVITAI_NOT_FOUND") || msg.includes("CIVITAI_NO_IMAGE") ? "notfound" : "generic"
      );
      setBusy(false);
    }
  }, [busy, onImport, url]);

  return (
    <Dialog open={open} onClose={onClose} labelledBy="import-title" width={560}>
      <div className="flex items-center justify-between px-7 pt-6 pb-1">
        <h2 id="import-title" className="t-display flex items-center gap-2.5 text-[19px] text-ink">
          <CloudDownload size={18} strokeWidth={1.8} className="text-faint" />
          {t("import.civitai.title")}
        </h2>
        <DialogCloseButton onClose={onClose} label={t("action.close")} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-4 px-7 pt-2 pb-1">
          <p className="text-[13px] leading-relaxed text-muted">{t("import.civitai.hint")}</p>
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            placeholder={t("import.civitai.placeholder")}
            spellCheck={false}
            disabled={busy}
            className="field select-text"
          />
          {error ? (
            <p
              role="alert"
              className={`text-[12.5px] leading-relaxed ${
                error === "notfound" ? "text-body" : "text-destructive"
              }`}
            >
              {error === "url"
                ? t("import.civitai.errorUrl")
                : error === "notfound"
                  ? t("import.civitai.errorNotFound")
                  : t("import.civitai.errorGeneric")}
            </p>
          ) : (
            <span aria-hidden className="block h-[18px]" />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line-soft px-7 py-4">
          <button type="button" className="btn-ghost press cursor-pointer" onClick={onClose} disabled={busy}>
            {t("action.cancel")}
          </button>
          <button type="submit" className="btn-primary press min-w-[104px] cursor-pointer" disabled={!url.trim() || busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <CloudDownload size={14.5} strokeWidth={2} />}
            {busy ? t("import.civitai.busy") : t("import.civitai.go")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
