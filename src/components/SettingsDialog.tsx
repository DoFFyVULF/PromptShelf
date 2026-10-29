import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Download, Upload, FolderOpen, Loader2, Eye, EyeOff, Pencil, FolderUp, RefreshCw } from "lucide-react";
import { save as saveFileDialog, open as openFileDialog, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import type { AppSettings, LibraryPaths } from "../lib/types";
import { Dialog } from "./Dialog";
import { useToast } from "./Toasts";
import { UpdateDialog } from "./UpdateDialog";

interface SettingsDialogProps {
  open: boolean;
  settings: AppSettings;
  paths: LibraryPaths | null;
  onClose: () => void;
  onSaved: (s: AppSettings) => void;
  onImported: () => void;
}

export function SettingsDialog({ open, settings, paths, onClose, onSaved, onImported }: SettingsDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => undefined);
  }, []);
  // API key display: masked by default; the eye reveals it, the pencil edits it.
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [keyEditing, setKeyEditing] = useState(false);
  const keyBeforeEdit = useRef("");
  const keyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setKeyRevealed(false);
      setKeyEditing(false);
    }
  }, [open, settings]);

  const save = useCallback(
    async (next: AppSettings) => {
      setSaving(true);
      try {
        const s = await api.setSettings({
          max_side: next.max_side,
          quality: next.quality,
          format: next.format,
          originals: next.originals,
          thumbs: next.thumbs,
          civitai_api_key: next.civitai_api_key ?? ""
        });
        onSaved(s);
        toast(t("toast.settingsSaved"));
      } catch {
        toast(t("toast.error"), "error");
      } finally {
        setSaving(false);
      }
    },
    [onSaved, t, toast]
  );

  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      const next = { ...draft, ...patch };
      setDraft(next);
      void save(next);
    },
    [draft, save]
  );

  const startKeyEdit = useCallback(() => {
    keyBeforeEdit.current = draft.civitai_api_key ?? "";
    setKeyEditing(true);
    setKeyRevealed(true);
    window.setTimeout(() => {
      keyInputRef.current?.focus();
      keyInputRef.current?.select();
    }, 30);
  }, [draft.civitai_api_key]);

  const commitKey = useCallback(() => {
    const v = (draft.civitai_api_key ?? "").trim();
    if (v !== (keyBeforeEdit.current || "").trim()) {
      update({ civitai_api_key: v });
    }
    setKeyEditing(false);
    setKeyRevealed(false);
  }, [draft.civitai_api_key, update]);

  const cancelKeyEdit = useCallback(() => {
    setDraft((d) => ({ ...d, civitai_api_key: keyBeforeEdit.current }));
    setKeyEditing(false);
    setKeyRevealed(false);
  }, []);

  const doExport = useCallback(async () => {
    try {
      const path = await saveFileDialog({
        title: t("settings.exportTitle"),
        defaultPath: `promptshelf-${new Date().toISOString().slice(0, 10)}.promptshelf`,
        filters: [{ name: "PromptShelf", extensions: ["promptshelf", "zip"] }]
      });
      if (!path) return;
      setBusy(true);
      await api.exportLibrary(path);
      toast(t("toast.exported"));
    } catch {
      toast(t("toast.error"), "error");
    } finally {
      setBusy(false);
    }
  }, [t, toast]);

  const doImport = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        title: t("settings.importTitle"),
        multiple: false,
        filters: [{ name: "PromptShelf", extensions: ["promptshelf", "zip"] }]
      });
      if (!picked || typeof picked !== "string") return;

      const yes = await message(t("settings.importConfirm"), {
        title: t("settings.importTitle"),
        kind: "warning",
        okLabel: t("settings.import")
      });
      if (!yes) return;

      setBusy(true);
      await api.importLibrary(picked);
      toast(t("toast.imported"));
      onImported();
      onClose();
    } catch {
      toast(t("toast.error"), "error");
    } finally {
      setBusy(false);
    }
  }, [onClose, onImported, t, toast]);

  const doMove = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        title: t("settings.location.change"),
        directory: true,
        multiple: false
      });
      if (!picked || typeof picked !== "string") return;
      const yes = await message(t("settings.location.moveConfirm"), {
        title: t("settings.location.change"),
        kind: "info",
        okLabel: t("settings.location.change")
      });
      if (!yes) return;
      setMoving(true);
      await api.moveLibrary(picked.trim());
      toast(t("settings.location.moved"));
      // Apply on the next start: everything (db, images, asset paths) reads
      // the library from the manifest-resolved dir.
      window.setTimeout(() => {
        void relaunch().catch(() => undefined);
      }, 900);
    } catch {
      toast(t("settings.location.moveError"), "error");
    } finally {
      setMoving(false);
    }
  }, [t, toast]);

  return (
    <Dialog open={open} onClose={onClose} labelledBy="settings-title" width={580}>
      <div className="flex items-center justify-between px-7 pt-6 pb-1">
        <h2 id="settings-title" className="t-display text-[19px] text-ink">
          {t("settings.title")}
        </h2>
        {saving && <Loader2 size={14} className="spin text-faint" />}
      </div>

      <div className="max-h-[70vh] space-y-7 overflow-y-auto px-7 pt-3 pb-2">
        <section>
          <h3 className="t-section">{t("settings.images")}</h3>
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-[1fr_150px] items-center gap-4">
              <div>
                <label className="block text-[13.5px] font-medium text-ink">{t("settings.maxSide")}</label>
                <p className="mt-0.5 text-[11.5px] text-faint">{t("settings.maxSide.hint")}</p>
              </div>
              <select
                className="field"
                value={draft.max_side}
                onChange={(e) => update({ max_side: Number(e.target.value) })}
              >
                {[800, 1024, 1200, 1600, 2048, 2560].map((v) => (
                  <option key={v} value={v}>
                    {v} px
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-[1fr_150px] items-center gap-4">
              <div>
                <label className="block text-[13.5px] font-medium text-ink">
                  {t("settings.quality")}
                  <span className="ml-2 text-[12px] font-normal text-faint">{draft.quality}%</span>
                </label>
                <input
                  type="range"
                  className="range mt-2.5"
                  min={40}
                  max={100}
                  step={5}
                  value={draft.quality}
                  onChange={(e) => setDraft({ ...draft, quality: Number(e.target.value) })}
                  onMouseUp={() => save(draft)}
                  onTouchEnd={() => save(draft)}
                  onKeyUp={() => save(draft)}
                />
              </div>
              <div className="justify-self-end">
                <div className="flex rounded-full border border-hairline bg-card p-0.5">
                  {(["jpeg", "webp"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => update({ format: f })}
                      aria-pressed={draft.format === f}
                      className={`press h-7 cursor-pointer rounded-full px-3 text-[11.5px] font-semibold transition-colors ${
                        draft.format === f ? "bg-ink text-white" : "text-muted hover:text-ink"
                      }`}
                    >
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-card px-4 py-3 transition-colors hover:border-zinc-300">
              <input
                type="checkbox"
                checked={draft.originals}
                onChange={(e) => update({ originals: e.target.checked })}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-[#18181b]"
              />
              <span>
                <span className="block text-[13.5px] font-medium text-ink">{t("settings.originals")}</span>
                <span className="mt-0.5 block text-[11.5px] text-faint">{t("settings.originals.hint")}</span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-card px-4 py-3 transition-colors hover:border-zinc-300">
              <input
                type="checkbox"
                checked={!draft.thumbs}
                onChange={(e) => update({ thumbs: !e.target.checked })}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-[#18181b]"
              />
              <span>
                <span className="block text-[13.5px] font-medium text-ink">{t("settings.thumbs")}</span>
                <span className="mt-0.5 block text-[11.5px] text-faint">{t("settings.thumbs.hint")}</span>
              </span>
            </label>

            <p className="text-[11.5px] text-faint">{t("settings.applyNote")}</p>
          </div>
        </section>

        <section>
          <h3 className="t-section">{t("settings.civitai")}</h3>
          <div className="mt-3 space-y-2">
            <label className="block text-[13.5px] font-medium text-ink" htmlFor="settings-civitai-key">
              {t("settings.civitaiKey")}
            </label>
            <div className="flex items-center gap-2">
              {keyEditing ? (
                <div className="min-w-0 flex-1">
                  <input
                    ref={keyInputRef}
                    id="settings-civitai-key"
                    type="text"
                    value={draft.civitai_api_key ?? ""}
                    onChange={(e) => setDraft({ ...draft, civitai_api_key: e.target.value })}
                    onBlur={commitKey}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelKeyEdit();
                      }
                    }}
                    placeholder={t("settings.civitaiKey.placeholder")}
                    spellCheck={false}
                    autoComplete="off"
                    className="field select-text font-mono text-[12px]"
                  />
                </div>
              ) : (
                <>
                  <code
                    className="min-w-0 flex-1 truncate rounded-lg bg-parchment px-3 py-2 font-mono text-[11.5px] text-muted select-text"
                    title={keyRevealed ? (draft.civitai_api_key || undefined) : undefined}
                  >
                    {draft.civitai_api_key ? (
                      keyRevealed ? (
                        draft.civitai_api_key
                      ) : (
                        "••••••••••"
                      )
                    ) : (
                      <span className="text-faint">{t("settings.civitaiKey.empty")}</span>
                    )}
                  </code>
                  <button
                    type="button"
                    className="btn-icon press shrink-0 cursor-pointer"
                    aria-label={keyRevealed ? t("settings.civitaiKey.hide") : t("settings.civitaiKey.show")}
                    title={keyRevealed ? t("settings.civitaiKey.hide") : t("settings.civitaiKey.show")}
                    disabled={!draft.civitai_api_key}
                    onClick={() => setKeyRevealed((v) => !v)}
                  >
                    {keyRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    type="button"
                    className="btn-icon press shrink-0 cursor-pointer"
                    aria-label={t("settings.civitaiKey.edit")}
                    title={t("settings.civitaiKey.edit")}
                    onClick={startKeyEdit}
                  >
                    <Pencil size={16} />
                  </button>
                </>
              )}
            </div>
            <p className="text-[11.5px] text-faint">{t("settings.civitaiKey.hint")}</p>
          </div>
        </section>

        <section>
          <h3 className="t-section">{t("settings.storage")}</h3>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-[13.5px] font-medium text-ink">{t("settings.location")}</label>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-parchment px-3 py-2 font-mono text-[11.5px] text-muted select-text">
                  {paths?.data_dir ?? "…"}
                </code>
                <button
                  type="button"
                  className="btn-icon press shrink-0 cursor-pointer"
                  aria-label={t("settings.location.change")}
                  title={t("settings.location.change")}
                  disabled={moving}
                  onClick={doMove}
                >
                  {moving ? <Loader2 size={15} className="spin" /> : <FolderUp size={15} />}
                </button>
                <button
                  type="button"
                  className="btn-icon press shrink-0 cursor-pointer"
                  aria-label={t("settings.reveal")}
                  title={t("settings.reveal")}
                  onClick={() => paths && api.revealFile(paths.data_dir)}
                >
                  <FolderOpen size={15} />
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <button type="button" className="btn-ghost press cursor-pointer" onClick={doExport} disabled={busy}>
                {busy ? <Loader2 size={14} className="spin" /> : <Download size={14.5} />}
                {t("settings.export")}
              </button>
              <button type="button" className="btn-ghost press cursor-pointer" onClick={doImport} disabled={busy}>
                <Upload size={14.5} />
                {t("settings.import")}
              </button>
            </div>
            <p className="text-[11.5px] text-faint">{t("settings.importNote")}</p>
          </div>
        </section>

        <section>
          <h3 className="t-section">{t("settings.updates")}</h3>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" className="btn-ghost press cursor-pointer" onClick={() => setUpdatesOpen(true)}>
              <RefreshCw size={14.5} />
              {t("settings.updates.check")}
            </button>
            {version && <span className="text-[11.5px] text-faint">v{version}</span>}
          </div>
        </section>
      </div>

      <UpdateDialog open={updatesOpen} onClose={() => setUpdatesOpen(false)} />
    </Dialog>
  );
}
