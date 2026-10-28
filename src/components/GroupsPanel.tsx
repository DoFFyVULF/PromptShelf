import { useEffect, useRef, useState } from "react";
import { CornerDownRight, Home, Pencil, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "../i18n";
import { api } from "../lib/api";
import type { GroupInfo } from "../lib/types";
import { CARD_DRAG_TYPE } from "./Grid";
import { useToast } from "./Toasts";

interface GroupsPanelProps {
  open: boolean;
  onClose: () => void;
  groups: GroupInfo[];
  currentGroupId: string;
  selection: string[];
  onSwitch: (id: string) => void;
  onChanged: () => void;
  onMoved: (toGroup: GroupInfo, ids: string[]) => void;
}

export function GroupsPanel({
  open,
  onClose,
  groups,
  currentGroupId,
  selection,
  onSwitch,
  onChanged,
  onMoved
}: GroupsPanelProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [armDelete, setArmDelete] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // true while a card drag is in flight anywhere in the window — every group
  // row then presents itself as a drop target
  const [dragActive, setDragActive] = useState(false);
  const draftRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  // close on outside clicks; during an HTML5 drag no click fires, so the
  // panel stays open and cards can be dropped onto group rows
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      // a click can detach its own target before this listener runs (React
      // swaps the button for an input on the same event) — such a click was
      // on our UI, so the panel must stay open
      if (!el.isConnected) return;
      if (el.closest("[data-groups-panel]") || el.closest("[data-groups-trigger]")) return;
      onClose();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setDraftName("");
      setEditingId(null);
      setArmDelete(null);
      setDragOverId(null);
      setDragActive(false);
    }
  }, [open]);

  // card drags anywhere in the window switch the rows into drop-target mode;
  // not gated on `open` so the very first drag (which auto-opens the panel
  // from App) still highlights the rows
  useEffect(() => {
    const onStart = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes(CARD_DRAG_TYPE)) {
        setDragActive(true);
      }
    };
    const onEnd = () => {
      setDragActive(false);
      setDragOverId(null);
    };
    window.addEventListener("dragstart", onStart);
    window.addEventListener("dragend", onEnd);
    window.addEventListener("drop", onEnd);
    return () => {
      window.removeEventListener("dragstart", onStart);
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
    };
  }, []);

  useEffect(() => {
    if (creating) window.setTimeout(() => draftRef.current?.focus(), 40);
  }, [creating]);

  useEffect(() => {
    if (editingId) window.setTimeout(() => editRef.current?.focus(), 40);
  }, [editingId]);

  const createGroup = async () => {
    const name = draftName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    try {
      await api.createGroup(name);
      toast(t("toast.groupCreated"));
      setDraftName("");
      setCreating(false);
      onChanged();
    } catch (e) {
      const msg = String(e);
      toast(msg.includes("GROUP_NAME") ? t("editor.error.prompt") : t("toast.error"), "error");
    }
  };

  const commitRename = async (id: string) => {
    const name = editName.trim();
    setEditingId(null);
    if (!name) return;
    try {
      await api.renameGroup(id, name);
      toast(t("toast.groupRenamed"));
      onChanged();
    } catch {
      toast(t("toast.error"), "error");
    }
  };

  const removeGroup = async (group: GroupInfo) => {
    if (armDelete !== group.id) {
      setArmDelete(group.id);
      window.setTimeout(() => setArmDelete((cur) => (cur === group.id ? null : cur)), 3200);
      return;
    }
    setArmDelete(null);
    try {
      await api.deleteGroup(group.id);
      toast(t("toast.groupDeleted"));
      onChanged();
      onClose();
    } catch {
      toast(t("toast.error"), "error");
    }
  };

  const moveHere = (group: GroupInfo, ids: string[]) => {
    if (ids.length === 0) return;
    onMoved(group, ids);
  };

  const onDrop = (group: GroupInfo, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverId(null);
    try {
      const raw = e.dataTransfer.getData(CARD_DRAG_TYPE);
      if (!raw) return;
      const ids = JSON.parse(raw) as string[];
      if (Array.isArray(ids) && ids.length > 0) moveHere(group, ids);
    } catch {
      /* ignore malformed payloads */
    }
  };

  if (!open) return null;

  return (
    <div
      data-groups-panel
      className={`anim-panel fixed top-14 right-3 z-[75] flex max-h-[calc(100vh-72px)] w-[320px] flex-col overflow-hidden rounded-panel border border-hairline bg-card shadow-panel transition-shadow duration-200 ${
        dragActive ? "ring-2 ring-emerald-200/80" : ""
      }`}
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        {dragActive ? (
          <span className="anim-fade min-w-0 truncate text-[13px] font-semibold text-emerald-700">
            {t("groups.dropHint")}
          </span>
        ) : (
          <h3 className="t-display text-[14.5px] text-ink">{t("groups.title")}</h3>
        )}
        <button type="button" className="btn-icon press -mr-1.5 cursor-pointer" aria-label={t("action.close")} onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      {selection.length > 0 && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-[10px] bg-emerald-50 px-3 py-2 text-[11.5px] leading-snug text-emerald-800">
          <span className="font-semibold whitespace-nowrap">{t("groups.selected", { n: selection.length })}</span>
          <span className="min-w-0 truncate text-emerald-700/80">{t("groups.moveTip")}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((g) => {
          const current = g.id === currentGroupId;
          return (
            <div
              key={g.id}
              onClick={() => onSwitch(g.id)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverId(g.id);
              }}
              onDragLeave={() => setDragOverId((cur) => (cur === g.id ? null : cur))}
              onDrop={(e) => onDrop(g, e)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSwitch(g.id);
                }
              }}
              className={`group relative flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-2.5 py-2 transition-[background-color,border-color,color] duration-150 ${
                dragActive
                  ? current
                    ? dragOverId === g.id
                      ? "border-emerald-500 bg-emerald-100 text-emerald-900"
                      : "border-dashed border-emerald-300/80 bg-emerald-50/70 text-emerald-800"
                    : dragOverId === g.id
                      ? "border-emerald-500 bg-emerald-100 text-emerald-900"
                      : "border-dashed border-emerald-300/70 bg-emerald-50/50 text-emerald-900/80"
                  : current
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-transparent text-body hover:bg-parchment"
              }`}
            >
              <span
                aria-hidden
                className={`flex h-6 w-6 shrink-0 items-center justify-center ${
                  current ? "text-emerald-600" : "text-zinc-400"
                }`}
              >
                {g.is_default ? <Home size={14.5} /> : <span className="h-2 w-2 rounded-full bg-current" />}
              </span>

              {editingId === g.id ? (
                <input
                  ref={editRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitRename(g.id);
                    } else if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditingId(null);
                    }
                  }}
                  onBlur={() => void commitRename(g.id)}
                  maxLength={48}
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-md border border-emerald-300 bg-white px-2 py-1 text-[13px] text-ink outline-none"
                />
              ) : (
                <span className={`min-w-0 flex-1 truncate text-[13.5px] font-medium ${current ? "text-emerald-800" : ""}`}>
                  {g.name}
                </span>
              )}

              {!editingId && (
                <>
                  <span className={`shrink-0 text-[11px] tabular-nums ${current ? "text-emerald-600/80" : "text-faint"}`}>
                    {g.count}
                  </span>

                  {dragActive && (
                    <CornerDownRight
                      size={13}
                      className={`shrink-0 text-emerald-500 transition-transform duration-150 ${
                        dragOverId === g.id ? "scale-125 opacity-100" : "opacity-55"
                      }`}
                    />
                  )}

                  {selection.length > 0 && !dragActive && (
                    <button
                      type="button"
                      aria-label={t("groups.moveHere")}
                      title={t("groups.moveHere")}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveHere(g, selection);
                      }}
                      className="press flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-white/80"
                    >
                      <CornerDownRight size={13} />
                    </button>
                  )}

                  {!g.is_default && !dragActive && (
                    <span
                      className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <button
                        type="button"
                        aria-label={t("action.edit")}
                        title={t("action.edit")}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditName(g.name);
                          setEditingId(g.id);
                        }}
                        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-white/80 hover:text-ink"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label={t("action.delete")}
                        title={armDelete === g.id ? t("groups.deleteHint", { name: groupNameOf(groups) }) : t("action.delete")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeGroup(g);
                        }}
                        className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors ${
                          armDelete === g.id
                            ? "bg-red-600 text-white"
                            : "text-muted hover:bg-white/80 hover:text-destructive"
                        }`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-line-soft px-2 py-2">
        {creating ? (
          <input
            ref={draftRef}
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createGroup();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setCreating(false);
                setDraftName("");
              }
            }}
            onBlur={() => void createGroup()}
            placeholder={t("groups.new.placeholder")}
            maxLength={48}
            spellCheck={false}
            className="w-full rounded-md border border-hairline bg-parchment px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint"
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="press flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-parchment hover:text-ink"
          >
            <Plus size={14.5} />
            {t("groups.new")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Name of the default group for the delete hint. */
function groupNameOf(groups: GroupInfo[]): string {
  return groups.find((g) => g.is_default)?.name ?? "";
}
