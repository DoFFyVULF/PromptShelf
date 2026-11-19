import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageDown, Loader2, Plus, X } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { api, assetUrl } from "../lib/api";
import type { LoraDetail as LoraDetailData, StagedImage, TagCount } from "../lib/types";
import { useToast } from "./Toasts";
import { Dialog, DialogCloseButton } from "./Dialog";
import { TagInput } from "./TagInput";
import { IMAGE_EXTS } from "./Editor";

interface LoraEditorProps {
  staged: StagedImage[];
  onStaged: (images: StagedImage[]) => void;
  /** Tags already used across the lora shelf, for the tag field's hints. */
  suggestions: TagCount[];
  onClose: () => void;
  onSaved: (lora: LoraDetailData) => void;
}

export function LoraShelfEditor({ staged, onStaged, suggestions, onClose, onSaved }: LoraEditorProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [baseModel, setBaseModel] = useState("");
  const [triggerDraft, setTriggerDraft] = useState("");
  const [tipsDraft, setTipsDraft] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.setTimeout(() => nameRef.current?.focus(), 80);
  }, []);

  const triggerWords = useMemo(
    () => triggerDraft.split(",").map((w) => w.trim()).filter(Boolean),
    [triggerDraft]
  );
  const usageTips = useMemo(
    () => tipsDraft.split("\n").map((w) => w.trim()).filter(Boolean),
    [tipsDraft]
  );

  const pickImages = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        multiple: true,
        title: t("editor.choose"),
        filters: [{ name: "Images", extensions: IMAGE_EXTS }]
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      setPicking(true);
      try {
        const added: StagedImage[] = staged;
        for (const p of paths) {
          try {
            const preview = await api.previewImage(p);
            if (!added.some((s) => s.preview === preview)) added.push({ path: p, preview });
            onStaged([...added]);
          } catch {
            /* skip unreadable file */
          }
        }
      } finally {
        setPicking(false);
      }
    } catch {
      toast(t("toast.error"), "error");
    }
  }, [onStaged, staged, t, toast]);

  const save = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast(t("toast.loraRequired"), "error");
      return;
    }
    setSaving(true);
    try {
      const saved = await api.createLora({
        name: trimmedName,
        base_model: baseModel.trim(),
        usage_tips: usageTips,
        trigger_words: triggerWords,
        description,
        note,
        tags,
        images: staged.map((s) => s.path)
      });
      toast(t("toast.saved"));
      onSaved(saved);
    } catch {
      toast(t("toast.error"), "error");
      setSaving(false);
    }
  }, [baseModel, description, name, note, onSaved, staged, tags, t, toast, triggerWords, usageTips]);

  /** The dialog is closed with unsaved staged images — their temp files go. */
  const discard = useCallback(() => {
    for (const img of staged) void api.discardTemp(img.path).catch(() => undefined);
    onClose();
  }, [onClose, staged]);

  return (
    <Dialog open onClose={discard} labelledBy="lora-editor-title" width={620}>
      <div className="flex items-center justify-between px-7 pt-6 pb-1">
        <h2 id="lora-editor-title" className="t-display text-[19px] text-ink">
          {t("loraeditor.new.title")}
        </h2>
        <DialogCloseButton onClose={discard} label={t("action.close")} />
      </div>

      <div className="max-h-[62vh] space-y-4 overflow-y-auto px-7 pt-2 pb-4">
        <section>
          <label className="t-section block" htmlFor="lora-name">
            {t("loraeditor.name")}
          </label>
          <input
            ref={nameRef}
            id="lora-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("loraeditor.name.placeholder")}
            spellCheck={false}
            maxLength={96}
            className="field mt-2 select-text"
          />
        </section>

        <section className="grid grid-cols-2 gap-4">
          <div>
            <label className="t-section block" htmlFor="lora-base">
              {t("loraeditor.baseModel")}
            </label>
            <input
              id="lora-base"
              type="text"
              value={baseModel}
              onChange={(e) => setBaseModel(e.target.value)}
              placeholder={t("loraeditor.baseModel.placeholder")}
              spellCheck={false}
              maxLength={64}
              className="field mt-2 select-text"
            />
          </div>
          <div>
            <label className="t-section block" htmlFor="lora-triggers">
              {t("loraeditor.triggerWords")}
            </label>
            <input
              id="lora-triggers"
              type="text"
              value={triggerDraft}
              onChange={(e) => setTriggerDraft(e.target.value)}
              placeholder={t("loraeditor.triggerWords.placeholder")}
              spellCheck={false}
              className="field mt-2 select-text"
            />
          </div>
        </section>

        <section>
          <p className="t-section block">{t("editor.images")}</p>
          <div className="mt-2 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {staged.map((img) => (
              <div key={img.path} className="group relative h-16 w-20 shrink-0 overflow-hidden rounded-[9px] border border-hairline">
                <img src={assetUrl(img.preview)} alt="" draggable={false} className="no-drag h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label={t("editor.removeImage")}
                  onClick={() => {
                    void api.discardTemp(img.path).catch(() => undefined);
                    onStaged(staged.filter((s) => s.path !== img.path));
                  }}
                  className="absolute top-0.5 right-0.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={pickImages}
              disabled={picking}
              className="press flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border-2 border-dashed border-line-hover text-faint transition-colors hover:border-line-active hover:text-muted disabled:cursor-default disabled:opacity-50"
            >
              {picking ? <Loader2 size={15} className="spin" /> : <Plus size={15} strokeWidth={1.8} />}
            </button>
            {staged.length === 0 && (
              <span className="flex items-center gap-2 pl-1 text-[12px] text-faint">
                <ImageDown size={14} />
                {t("editor.dropHint")}
              </span>
            )}
          </div>
        </section>

        <section>
          <label className="t-section block" htmlFor="lora-tips">
            {t("loraeditor.usageTips")}
          </label>
          <textarea
            id="lora-tips"
            value={tipsDraft}
            onChange={(e) => setTipsDraft(e.target.value)}
            placeholder={t("loraeditor.usageTips.placeholder")}
            spellCheck={false}
            rows={2}
            className="field mt-2 resize-none select-text"
          />
        </section>

        <section>
          <label className="t-section block" htmlFor="lora-desc">
            {t("loraeditor.description")}
          </label>
          <textarea
            id="lora-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("loraeditor.description.placeholder")}
            rows={4}
            className="field mt-2 resize-y select-text"
          />
        </section>

        <section>
          <label className="t-section block" htmlFor="lora-note">
            {t("lora.note")}
          </label>
          <textarea
            id="lora-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("editor.note.placeholder")}
            rows={2}
            className="field mt-2 resize-none select-text"
          />
        </section>

        <section>
          <label className="t-section block" htmlFor="lora-tag-input">
            {t("editor.tags")}
          </label>
          <TagInput
            id="lora-tag-input"
            tags={tags}
            onChange={setTags}
            suggestions={suggestions}
            placeholder={t("editor.tags.placeholder")}
          />
        </section>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line-soft px-7 py-4">
        <button type="button" className="btn-ghost press cursor-pointer" onClick={discard}>
          {t("action.cancel")}
        </button>
        <button type="button" className="btn-primary press min-w-[104px] cursor-pointer justify-center" onClick={save} disabled={saving || !name.trim()}>
          {saving && <Loader2 size={14} className="spin" />}
          {t("action.save")}
        </button>
      </div>
    </Dialog>
  );
}
