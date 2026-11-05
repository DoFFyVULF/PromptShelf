import { useCallback, useEffect, useRef, useState } from "react";
import { CloudDownload } from "lucide-react";
import { useI18n } from "../i18n";
import { Dialog, DialogCloseButton } from "./Dialog";

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Hands the link(s) to the background runner; never blocks the form. */
  onSubmit: (url: string) => void;
}

/** More than this many links in one paste is almost certainly an accident. */
const MAX_LINKS_PER_PASTE = 10;

/** Extract every URL in the paste; fall back to the raw text so the real
 * validation error ("that's not a CivitAI link") still surfaces in the grid. */
function parseLinks(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const matches = text.match(/https?:\/\/\S+/g);
  if (!matches) return [text];
  const unique = [...new Set(matches.map((m) => m.replace(/[),.;]+$/, "")))];
  return unique.slice(0, MAX_LINKS_PER_PASTE);
}

export function ImportDialog({ open, onClose, onSubmit }: ImportDialogProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  /** Submit is instant: links join the background queue and the field clears
   * for the next paste — the dialog stays open, while the import itself
   * happens out in the library: placeholder tiles morph into the real cards
   * right in the grid. */
  const submit = useCallback(() => {
    const links = parseLinks(url);
    if (links.length === 0) return;
    for (const link of links) onSubmit(link);
    setUrl("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [onSubmit, url]);

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
          submit();
        }}
      >
        <div className="space-y-4 px-7 pt-2 pb-1">
          <p className="text-[13px] leading-relaxed text-muted">{t("import.civitai.hint")}</p>
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("import.civitai.placeholder")}
            spellCheck={false}
            className="field select-text"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line-soft px-7 py-4">
          <button type="submit" className="btn-primary press min-w-[104px] cursor-pointer" disabled={!url.trim()}>
            <CloudDownload size={14.5} strokeWidth={2} />
            {t("import.civitai.go")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
