import { useEffect, useRef } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { DictKey } from "../i18n";
import type { LoraItem } from "../lib/types";

export interface LoraDraft {
  index: number | null; // null → adding a new row
  name: string;
  value: string;
}

export const MAX_LORAS = 24;

type TFn = (key: DictKey, vars?: Record<string, string | number>) => string;

/** Pure: merges an open draft into the list (edit-in-place, one entry per name). */
export function applyLoraDraft(list: LoraItem[], draft: LoraDraft | null): LoraItem[] {
  if (!draft) return list;
  const name = draft.name.trim();
  const value = draft.value.trim();
  if (!name || name.length > 64 || value.length > 32) return list;
  const at = draft.index ?? list.length;
  const out: LoraItem[] = [];
  for (let i = 0; i < list.length; i++) {
    if (i === at) continue;
    if (list[i].name.toLowerCase() === name.toLowerCase()) continue; // moved/merged
    out.push(list[i]);
  }
  out.splice(Math.min(at, out.length), 0, { name, value });
  return out.slice(0, MAX_LORAS);
}

interface LoraEditorProps {
  loras: LoraItem[];
  onChange: (next: LoraItem[]) => void;
  draft: LoraDraft | null;
  onDraft: (d: LoraDraft | null) => void;
  t: TFn;
}

/**
 * LoRA list with add/edit/delete. Controlled: the host owns `loras` + `draft`
 * so it can merge unsaved drafts on save and treat Esc as "cancel draft".
 * Hover slides a red-tinted slice and the actions in from the right edge.
 */
export function LoraEditor({ loras, onChange, draft, onDraft, t }: LoraEditorProps) {
  const nameRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    onChange(applyLoraDraft(loras, draft));
    onDraft(null);
  };

  const cancel = () => onDraft(null);

  const startAdd = () => {
    onChange(applyLoraDraft(loras, draft));
    onDraft({ index: null, name: "", value: "" });
  };

  const startEdit = (index: number) => {
    const merged = applyLoraDraft(loras, draft);
    const target = merged[index];
    onChange(merged);
    onDraft(target ? { index, name: target.name, value: target.value } : { index: null, name: "", value: "" });
  };

  const remove = (index: number) => {
    onChange(loras.filter((_, i) => i !== index));
    if (draft === null || draft.index === index) {
      onDraft(null);
    } else if (draft.index !== null && draft.index > index) {
      onDraft({ ...draft, index: draft.index - 1 });
    }
  };

  // focus the name input when a draft opens or moves to another row
  const prevDraft = useRef<LoraDraft | null>(null);
  useEffect(() => {
    const wasOpen = prevDraft.current !== null;
    const idxChanged = (prevDraft.current?.index ?? null) !== (draft?.index ?? null);
    if (draft !== null && (!wasOpen || idxChanged)) {
      window.setTimeout(() => nameRef.current?.focus(), 30);
    }
    prevDraft.current = draft;
  }, [draft]);

  return (
    <section>
      <div className="flex items-center justify-between">
        <span className="t-section">{t("editor.loras")}</span>
        <button
          type="button"
          aria-label={t("editor.loras.add")}
          title={t("editor.loras.add")}
          onClick={startAdd}
          disabled={loras.length >= MAX_LORAS}
          className="press flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-full border border-hairline bg-card text-muted transition-colors hover:border-zinc-400 hover:text-ink disabled:cursor-default disabled:opacity-35 disabled:hover:border-hairline disabled:hover:text-muted"
        >
          <Plus size={13.5} />
        </button>
      </div>

      <div className="mt-2 space-y-1.5">
        {loras.map((lora, i) =>
          draft?.index === i ? (
            <LoraDraftRow key={`draft-${i}`} draft={draft} nameRef={nameRef} onDraft={onDraft} onCommit={commit} onCancel={cancel} t={t} />
          ) : (
            <div
              key={`${lora.name}-${i}`}
              className="group relative flex h-9 items-center overflow-hidden rounded-[10px] border border-hairline bg-card pr-1.5 pl-3"
            >
              {/* colored slice slides in from the right edge, under the value + actions */}
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 w-[88px] translate-x-[102%] opacity-0 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none motion-reduce:translate-x-0 motion-reduce:opacity-100"
                style={{ clipPath: "polygon(14px 0, 100% 0, 100% 100%, 0 100%)" }}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-body">{lora.name}</span>
              {lora.value && (
                <span className="relative z-10 ml-2 shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-[11.5px] leading-none text-zinc-500 tabular-nums">
                  {lora.value}
                </span>
              )}
              {/* edit/delete pop out right after the value */}
              <div className="relative z-20 ml-2 flex shrink-0 translate-x-[104%] items-center gap-0.5 opacity-0 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none motion-reduce:translate-x-0 motion-reduce:opacity-100">
                <button
                  type="button"
                  aria-label={t("action.edit")}
                  onClick={() => startEdit(i)}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-white/85 hover:text-ink"
                >
                  <Pencil size={12.5} />
                </button>
                <button
                  type="button"
                  aria-label={t("action.delete")}
                  onClick={() => remove(i)}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-destructive transition-colors hover:bg-white/85"
                >
                  <Trash2 size={12.5} />
                </button>
              </div>
            </div>
          )
        )}

        {draft?.index === null && (
          <LoraDraftRow draft={draft} nameRef={nameRef} onDraft={onDraft} onCommit={commit} onCancel={cancel} t={t} />
        )}

        {loras.length === 0 && !draft && <p className="px-0.5 text-[12px] text-faint">{t("editor.loras.empty")}</p>}
        {loras.length >= MAX_LORAS && <p className="px-0.5 text-[11px] text-faint">{t("editor.loras.limit")}</p>}
      </div>
    </section>
  );
}

/** Inline name+value editor for one LoRA row (add or edit). */
function LoraDraftRow({
  draft,
  nameRef,
  onDraft,
  onCommit,
  onCancel,
  t
}: {
  draft: LoraDraft;
  nameRef: React.RefObject<HTMLInputElement>;
  onDraft: (d: LoraDraft | null) => void;
  onCommit: () => void;
  onCancel: () => void;
  t: TFn;
}) {
  return (
    <div
      className="flex h-9 items-center gap-1.5 rounded-[10px] border border-ink/50 bg-card pr-1 pl-1.5 shadow-[0_0_0_3px_rgb(24_24_27/0.05)]"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onCommit();
      }}
    >
      <input
        ref={nameRef}
        type="text"
        value={draft.name}
        onChange={(e) => onDraft({ ...draft, name: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          }
        }}
        placeholder={t("editor.loras.name.placeholder")}
        spellCheck={false}
        autoFocus
        maxLength={64}
        className="h-7 min-w-0 flex-1 rounded-md bg-parchment px-2 text-[13px] outline-none placeholder:text-faint"
      />
      <input
        type="text"
        value={draft.value}
        onChange={(e) => onDraft({ ...draft, value: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          }
        }}
        placeholder={t("editor.loras.value.placeholder")}
        spellCheck={false}
        maxLength={32}
        className="h-7 w-[112px] shrink-0 rounded-md bg-parchment px-2 text-right text-[12.5px] tabular-nums outline-none placeholder:text-faint"
      />
      <button
        type="button"
        aria-label={t("action.save")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCommit}
        className="flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md text-ink transition-colors hover:bg-parchment"
      >
        <Check size={13} />
      </button>
      <button
        type="button"
        aria-label={t("action.cancel")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCancel}
        className="flex h-6.5 w-6.5 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-parchment"
      >
        <X size={13} />
      </button>
    </div>
  );
}
