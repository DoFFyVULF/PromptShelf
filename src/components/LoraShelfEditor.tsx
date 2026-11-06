import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageDown, Loader2, Plus, X } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { api, assetUrl } from "../lib/api";
import type { LoraDetail as LoraDetailData, StagedImage } from "../lib/types";
import { useToast } from "./Toasts";
import { Dialog, DialogCloseButton } from "./Dialog";
import { IMAGE_EXTS } from "./Editor";

interface LoraEditorProps {
  /** null → create a new lora; otherwise edit the given one. */
  lora: LoraDetailData | null;
  staged: StagedImage[];
  onStaged: (images: StagedImage[]) => void;
  onClose: () => void;
  onSaved: (lora: LoraDetailData) => void;
}

export function LoraShelfEditor({ lora, staged, onStaged, onClose, onSaved }: LoraEditorProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [name, setName] = useState(lora?.name ?? "");
  const [baseModel, setBaseModel] = useState(lora?.base_model ?? "");
  const [triggerDraft, setTriggerDraft] = useState((lora?.trigger_words ?? []).join(", "));
  const [tipsDraft, setTipsDraft] = useState((lora?.usage_tips ?? []).join("\n"));
  const [description, setDescription] = useState(lora?.description ?? "");
  const [note, setNote] = useState(lora?.note ?? "");
  const [tags, setTags] = useState<string[]>(lora?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
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

  const addTag = useCallback(() => {
    const v = tagDraft.trim().replace(/^#/, "");
    if (!v) return;
    if (!tags.some((x) => x.toLowerCase() === v.toLowerCase())) setTags([...tags, v]);
    setTagDraft("");
  }, [tagDraft, tags]);

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
      const saved = lora
        ? await api.updateLora({
            id: lora.id,
            name: trimmedName,
            base_model: baseModel.trim(),
            usage_tips: usageTips,
            trigger_words: triggerWords,
            description: description,
            primary_tag: lora.primary_tag,
            note,
            rating: lora.rating,
            tags
          })
        : await api.createLora({
            name: trimmedName,
            base_model: baseModel.trim(),
            usage_tips: usageTips,
            trigger_words: triggerWords,
            description: description,
            note,
            tags,
            images: staged.map((s) => s.path)
          });
      toast(lora ? t("toast.updated") : t("toast.saved"));
      onSaved(saved);
    } catch {
      toast(t("toast.error"), "error");
      setSaving(false);
    }
  }, [baseModel, description, lora, name, note, onSaved, staged, tags, t, toast, triggerWords, usageTips]);

  /** The dialog is closed with unsaved staged images — their temp files go. */
  const discard = useCallback(() => {
    for (const img of staged) void api.discardTemp(img.path).catch(() => undefined);
    onClose();
  }, [onClose, staged]);

  return (
    <Dialog open onClose={discard} labelledBy="lora-editor-title" width={620}>
      <div className="flex items-center justify-between px-7 pt-6 pb-1">
        <h2 id="lora-editor-title" className="t-display text-[19px] text-ink">
          {lora ? t("loraeditor.edit.title") : t("loraeditor.new.title")}
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

        {!lora && (
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
        )}

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
          <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-hairline bg-card px-2.5 py-2 transition-colors focus-within:border-line-active focus-within:shadow-focus">
            {tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 rounded-full bg-parchment py-0.5 pr-1.5 pl-2.5 text-[12px] text-body">
                {tag}
                <button
                  type="button"
                  aria-label={`${t("action.delete")}: ${tag}`}
                  onClick={() => setTags(tags.filter((x) => x !== tag))}
                  className="cursor-pointer rounded-full text-faint transition-colors hover:text-ink"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              id="lora-tag-input"
              type="text"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                } else if (e.key === "Backspace" && tagDraft === "" && tags.length > 0) {
                  setTags(tags.slice(0, -1));
                }
              }}
              onBlur={addTag}
              placeholder={tags.length === 0 ? t("editor.tags.placeholder") : ""}
              spellCheck={false}
              className="min-w-[110px] flex-1 border-0 bg-transparent py-1 text-[13px] outline-none placeholder:text-faint"
            />
          </div>
        </section>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line-soft px-7 py-4">
        <button type="button" className="btn-ghost press cursor-pointer" onClick={discard}>
          {t("action.cancel")}
        </button>
        <button type="button" className="btn-primary press min-w-[104px] cursor-pointer" onClick={save} disabled={saving || !name.trim()}>
          {saving && <Loader2 size={14} className="spin" />}
          {t("action.save")}
        </button>
      </div>
    </Dialog>
  );
}
