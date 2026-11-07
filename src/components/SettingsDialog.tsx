import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { getVersion } from "@tauri-apps/api/app";
import { Download, Upload, FolderOpen, Loader2, Eye, EyeOff, Pencil, FolderUp, RefreshCw, Sun, Moon, Monitor } from "lucide-react";
import { save as saveFileDialog, open as openFileDialog, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import type { UpdateAvailability } from "../lib/useUpdateCheck";
import type { AppSettings, Lang, LibraryPaths, Theme } from "../lib/types";
import { Dialog } from "./Dialog";
import { useToast } from "./Toasts";
import { SegmentedControl } from "./SegmentedControl";
import { RollingNumber } from "./RollingNumber";
import { UpdateDialog } from "./UpdateDialog";

interface SettingsDialogProps {
  open: boolean;
  settings: AppSettings;
  paths: LibraryPaths | null;
  lang: Lang;
  onLang: (l: Lang) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onClose: () => void;
  onSaved: (s: AppSettings) => void;
  onImported: () => void;
  /** Version pending in the update source, even after the user dismissed the
   * header badge — the settings section is the quiet reminder. */
  updateVersion: string | null;
  onUpdateOpen: () => void;
  onUpdateDismissed: () => void;
  onUpdateFound: (a: UpdateAvailability) => void;
}

/** A soft checkbox: the box fills with ink and the checkmark draws itself,
 * instead of the hard native accent swap. Rendered as a quiet row — the
 * surrounding card provides the frame. */
function FancyCheckbox({ checked, onChange, label, hint }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-parchment/60"
    >
      <span
        className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-200 ${
          checked ? "border-ink bg-ink" : "border-line-active bg-transparent"
        }`}
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3 text-on-ink" aria-hidden>
          <motion.path
            d="M2.2 6.4 L4.8 9 L9.8 3.2"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
            transition={{ duration: checked ? 0.28 : 0.16, ease: [0.32, 0.72, 0, 1] }}
          />
        </svg>
      </span>
      <span>
        <span className="block text-[13.5px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-[11.5px] text-faint">{hint}</span>
      </span>
    </button>
  );
}

export function SettingsDialog({ open, settings, paths, lang, onLang, theme, onTheme, onClose, onSaved, onImported, updateVersion, onUpdateOpen, onUpdateDismissed, onUpdateFound }: SettingsDialogProps) {
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
          theme: next.theme,
          civitai_api_key: next.civitai_api_key ?? "",
          lora_previews: next.lora_previews,
          update_auto_check: next.update_auto_check
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
          <h3 className="t-section">{t("settings.general")}</h3>
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-[1fr_150px] items-center gap-4">
              <div>
                <label className="block text-[13.5px] font-medium text-ink">{t("settings.theme")}</label>
                <p className="mt-0.5 text-[11.5px] text-faint">{t("settings.theme.hint")}</p>
              </div>
              <div className="justify-self-end">
                <SegmentedControl
                  id="theme"
                  ariaLabel={t("settings.theme")}
                  value={theme}
                  onChange={(v) => onTheme(v as Theme)}
                  options={[
                    {
                      value: "light",
                      label: t("settings.theme.light"),
                      className: "w-9",
                      // the sun rolls back up, like a sunrise
                      enter: { rotate: -120, scale: 0.55, opacity: 0 },
                      content: <Sun size={14} strokeWidth={2} />
                    },
                    {
                      value: "dark",
                      label: t("settings.theme.dark"),
                      className: "w-9",
                      // the moon rolls in the opposite direction
                      enter: { rotate: 120, scale: 0.55, opacity: 0 },
                      content: <Moon size={14} strokeWidth={2} />
                    },
                    {
                      value: "system",
                      label: t("settings.theme.system"),
                      className: "w-9",
                      enter: { y: 9, scale: 0.55, opacity: 0 },
                      content: <Monitor size={14} strokeWidth={2} />
                    }
                  ]}
                />
              </div>
            </div>

            <div className="grid grid-cols-[1fr_150px] items-center gap-4">
              <div>
                <label className="block text-[13.5px] font-medium text-ink">{t("settings.language")}</label>
                <p className="mt-0.5 text-[11.5px] text-faint">{t("settings.language.hint")}</p>
              </div>
              <div className="justify-self-end">
                <SegmentedControl
                  id="lang"
                  ariaLabel={t("nav.language")}
                  value={lang}
                  onChange={(v) => onLang(v as Lang)}
                  options={(["en", "ru"] as const).map((l) => ({
                    value: l,
                    label: l.toUpperCase(),
                    // the letters flip over, like a split-flap departures board
                    enter: { rotateX: -82, y: 2, scale: 0.9, opacity: 0, transformPerspective: 420 },
                    content: (
                      <span className="text-[11.5px] font-semibold tracking-wide">{l === "en" ? "EN" : "РУ"}</span>
                    )
                  }))}
                />
              </div>
            </div>
          </div>
        </section>

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
                  <span className="ml-2 text-[12px] font-normal text-faint">
                    <RollingNumber value={draft.quality} />
                  </span>
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
                <SegmentedControl
                  id="format"
                  ariaLabel={t("settings.quality")}
                  value={draft.format}
                  onChange={(v) => update({ format: v as AppSettings["format"] })}
                  options={(["jpeg", "webp"] as const).map((f) => ({
                    value: f,
                    label: f.toUpperCase(),
                    // a quick pop, like a camera shutter picking its film
                    enter: { scale: 0.45, opacity: 0 },
                    content: (
                      <span className="text-[11.5px] font-semibold tracking-wide">{f.toUpperCase()}</span>
                    )
                  }))}
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-card px-4 py-3 transition-colors hover:border-line-hover">
              <input
                type="checkbox"
                checked={draft.originals}
                onChange={(e) => update({ originals: e.target.checked })}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-ink"
              />
              <span>
                <span className="block text-[13.5px] font-medium text-ink">{t("settings.originals")}</span>
                <span className="mt-0.5 block text-[11.5px] text-faint">{t("settings.originals.hint")}</span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-card px-4 py-3 transition-colors hover:border-line-hover">
              <input
                type="checkbox"
                checked={!draft.thumbs}
                onChange={(e) => update({ thumbs: !e.target.checked })}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-ink"
              />
              <span>
                <span className="block text-[13.5px] font-medium text-ink">{t("settings.thumbs")}</span>
                <span className="mt-0.5 block text-[11.5px] text-faint">{t("settings.thumbs.hint")}</span>
              </span>
            </label>

            <div className="grid grid-cols-[1fr_150px] items-center gap-4">
              <div>
                <label className="block text-[13.5px] font-medium text-ink">{t("settings.loraPreviews")}</label>
                <p className="mt-0.5 text-[11.5px] text-faint">{t("settings.loraPreviews.hint")}</p>
              </div>
              <select
                className="field"
                value={draft.lora_previews ?? 0}
                onChange={(e) => update({ lora_previews: Number(e.target.value) })}
              >
                <option value={0}>{t("settings.loraPreviews.all")}</option>
                {[1, 2, 3, 4, 6, 8, 12].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

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
          <div className="mt-3 overflow-hidden rounded-xl border border-hairline bg-card">
            <div className="flex items-center justify-between gap-3 py-3 pr-3 pl-4">
              <div className="min-w-0">
                <span className="block text-[13.5px] font-medium text-ink">{t("settings.updates.version")}</span>
                <span className="mt-0.5 block text-[11.5px] text-faint">
                  PromptShelf {version ? `v${version}` : "…"}
                </span>
              </div>
              <button type="button" className="btn-ghost press shrink-0 cursor-pointer" onClick={() => setUpdatesOpen(true)}>
                <RefreshCw size={14.5} />
                {t("settings.updates.check")}
              </button>
            </div>

            <div className="h-px bg-hairline" aria-hidden />

            <FancyCheckbox
              checked={draft.update_auto_check}
              onChange={(v) => update({ update_auto_check: v })}
              label={t("settings.updates.autoCheck")}
              hint={t("settings.updates.autoCheck.hint")}
            />

            {updateVersion && (
              <div className="flex items-center gap-3 border-t border-hairline bg-action/5 px-4 py-3">
                <Download size={15} className="shrink-0 text-action" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-body">
                  {t("settings.updates.available").replace("{version}", updateVersion)}
                </span>
                <button
                  type="button"
                  className="press shrink-0 cursor-pointer rounded-full bg-action px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-action/85"
                  onClick={onUpdateOpen}
                >
                  {t("settings.updates.open")}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* manual check entry: a fresh network check, reported back to the
          shared availability state so the badge stays in sync */}
      <UpdateDialog
        open={updatesOpen}
        onClose={() => setUpdatesOpen(false)}
        known={null}
        onDismissed={onUpdateDismissed}
        onFound={onUpdateFound}
      />
    </Dialog>
  );
}
