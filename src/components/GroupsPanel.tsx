import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CornerDownRight, Home, Layers, Palette, Pencil, Plus, Trash2, X } from "lucide-react";
import { useI18n, type DictKey } from "../i18n";
import { api } from "../lib/api";
import { ALL_GROUPS, allGroupsCount } from "../lib/groups";
import { groupColorVar } from "../lib/groupStyle";
import type { GroupInfo } from "../lib/types";
import { GroupAppearance } from "./GroupAppearance";
import { GroupGlyph } from "./GroupGlyph";
import { CARD_DRAG_TYPE } from "./Grid";
import { useToast } from "./Toasts";

/** Group management calls, one set per shelf. */
const cardGroupApi = {
  create: (name: string) => api.createGroup(name),
  style: (id: string, color: string, icon: string) => api.setGroupStyle(id, color, icon),
  rename: (id: string, name: string) => api.renameGroup(id, name),
  remove: (id: string) => api.deleteGroup(id)
};
const loraGroupApi = {
  create: (name: string) => api.createLoraGroup(name),
  style: (id: string, color: string, icon: string) => api.setLoraGroupStyle(id, color, icon),
  rename: (id: string, name: string) => api.renameLoraGroup(id, name),
  remove: (id: string) => api.deleteLoraGroup(id)
};

/** Backend errors are stable machine strings; the panel owns their wording. */
function groupErrorKey(error: unknown): DictKey {
  const message = String(error);
  if (message.includes("GROUP_NAME_REQUIRED")) return "groups.nameRequired";
  if (message.includes("GROUP_NAME_TOO_LONG")) return "groups.nameTooLong";
  if (message.includes("GROUP_NAME_EXISTS")) return "groups.nameExists";
  return "toast.error";
}

interface GroupsPanelProps {
  open: boolean;
  onClose: () => void;
  groups: GroupInfo[];
  currentGroupId: string;
  selection: string[];
  onSwitch: (id: string) => void;
  onChanged: () => void;
  onMoved: (toGroup: GroupInfo, ids: string[]) => void;
  /** Lora shelf: the panel stays identical, the group APIs differ. */
  lora?: boolean;
}

export function GroupsPanel({
  open,
  onClose,
  groups,
  currentGroupId,
  selection,
  onSwitch,
  onChanged,
  onMoved,
  lora
}: GroupsPanelProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const apiGroup = lora ? loraGroupApi : cardGroupApi;

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [armDelete, setArmDelete] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // true while a card drag is in flight anywhere in the window — every group
  // row then presents itself as a drop target
  const [dragActive, setDragActive] = useState(false);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [styleDraft, setStyleDraft] = useState({ color: "", icon: "" });
  const [styleDirty, setStyleDirty] = useState(false);
  const draftRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  const allLabel = t(lora ? "groups.all.lora" : "groups.all");
  const allCount = allGroupsCount(groups);
  const allCurrent = currentGroupId === ALL_GROUPS;

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
      setStyleId(null);
      setStyleDirty(false);
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
      const created = await apiGroup.create(name);
      toast(t("toast.groupCreated"));
      setDraftName("");
      setCreating(false);
      onChanged();
      // Reveal the appearance editor right away so the new feature is
      // discoverable — Done closes it without any extra confirmation.
      setStyleId(created.id);
      setStyleDraft({ color: created.color, icon: created.icon });
      setStyleDirty(false);
    } catch (e) {
      toast(t(groupErrorKey(e)), "error");
    }
  };

  const commitRename = async (id: string) => {
    const name = editName.trim();
    setEditingId(null);
    if (!name) return;
    try {
      await apiGroup.rename(id, name);
      toast(t("toast.groupRenamed"));
      onChanged();
    } catch (e) {
      toast(t(groupErrorKey(e)), "error");
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
      await apiGroup.remove(group.id);
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

  const openStyle = (group: GroupInfo) => {
    setStyleId(group.id);
    setStyleDraft({ color: group.color, icon: group.icon });
    setStyleDirty(false);
  };

  const closeStyle = () => {
    if (styleDirty) toast(t("toast.groupStyled"));
    setStyleId(null);
    setStyleDirty(false);
  };

  const pickStyle = async (id: string, next: { color: string; icon: string }) => {
    setStyleDraft(next);
    setStyleDirty(true);
    try {
      await apiGroup.style(id, next.color, next.icon);
      onChanged();
    } catch {
      toast(t("toast.error"), "error");
    }
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
    <motion.div
      data-groups-panel
      initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.985 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { type: "spring", visualDuration: 0.24, bounce: 0.08 }
      }
      className={`fixed top-14 right-3 z-[75] flex max-h-[calc(100vh-72px)] w-[320px] flex-col overflow-hidden rounded-panel border border-hairline bg-card shadow-panel transition-shadow duration-200 ${
        dragActive ? "ring-2 ring-leaf-edge/80" : ""
      }`}
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <AnimatePresence mode="wait" initial={false}>
          {dragActive ? (
            <motion.span
              key="drag"
              initial={reduceMotion ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: reduceMotion ? 0 : 0.14 }}
              className="min-w-0 truncate text-[13px] font-semibold text-leaf"
            >
              {t("groups.dropHint")}
            </motion.span>
          ) : (
            <motion.h3
              key="title"
              initial={reduceMotion ? false : { opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 3 }}
              transition={{ duration: reduceMotion ? 0 : 0.14 }}
              className="t-display text-[14.5px] text-ink"
            >
              {t("groups.title")}
            </motion.h3>
          )}
        </AnimatePresence>
        <button type="button" className="btn-icon press -mr-1.5 cursor-pointer" aria-label={t("action.close")} onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {selection.length > 0 && !dragActive && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: "auto", marginBottom: 8 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
            className="mx-3 overflow-hidden"
          >
            <div className="flex items-center gap-2 rounded-[10px] bg-leaf-soft px-3 py-2 text-[11.5px] leading-snug text-leaf">
              <span className="font-semibold whitespace-nowrap">{t("groups.selected", { n: selection.length })}</span>
              <span className="min-w-0 truncate text-leaf/80">{t("groups.moveTip")}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The shelf-wide scope is pinned above the rolling list so it never
          scrolls away, and it is deliberately not a drop target — "all
          groups" is a view, not a destination. */}
      <div className="px-2">
        <div
          className={`group relative flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2.5 transition-[background-color,border-color,color,opacity] duration-150 ${
            allCurrent
              ? "border-leaf-edge bg-leaf-soft text-leaf"
              : "border-transparent text-body hover:bg-parchment"
          } ${dragActive ? "pointer-events-none opacity-40" : ""}`}
        >
          <button
            type="button"
            onClick={() => onSwitch(ALL_GROUPS)}
            aria-current={allCurrent ? "true" : undefined}
            aria-label={`${allLabel}, ${allCount}`}
            className="absolute inset-0 z-0 cursor-pointer rounded-[10px] outline-none focus-visible:shadow-focus"
          />
          <span
            aria-hidden
            className={`pointer-events-none relative z-10 flex h-6 w-6 shrink-0 items-center justify-center ${
              allCurrent ? "text-leaf-icon" : "text-faint"
            }`}
          >
            <Layers size={14.5} />
          </span>
          <span
            className={`pointer-events-none relative z-10 min-w-0 flex-1 truncate text-[13.5px] font-medium ${
              allCurrent ? "text-leaf" : ""
            }`}
          >
            {allLabel}
          </span>
          <span
            aria-hidden
            className={`pointer-events-none relative z-10 shrink-0 text-[11px] tabular-nums ${
              allCurrent ? "text-leaf-icon/80" : "text-faint"
            }`}
          >
            {allCount}
          </span>
          {allCurrent && !dragActive && (
            <Check size={12.5} className="relative z-10 shrink-0 text-leaf-icon" aria-hidden />
          )}
        </div>
      </div>

      <div className="mx-4 my-1.5 h-px shrink-0 bg-line-soft" aria-hidden />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((g) => {
          const current = g.id === currentGroupId;
          // with an active selection a row click moves the cards instead of
          // switching the view — switching would silently drop the selection
          // and look like "nothing happened"
          const moveActive = selection.length > 0 && !dragActive;
          const rowLabel = moveActive && !current
            ? `${t("groups.moveHere")} — ${g.name}`
            : `${g.name}, ${g.count}`;
          return (
            <div key={g.id}>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverId(g.id);
                }}
                onDragLeave={() => setDragOverId((cur) => (cur === g.id ? null : cur))}
                onDrop={(e) => onDrop(g, e)}
                className={`group relative flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2.5 transition-[background-color,border-color,color] duration-150 ${
                  dragActive
                    ? current
                      ? dragOverId === g.id
                        ? "border-leaf-icon bg-leaf-target text-leaf-strong"
                        : "border-dashed border-leaf-edge/80 bg-leaf-soft/70 text-leaf"
                      : dragOverId === g.id
                        ? "border-leaf-icon bg-leaf-target text-leaf-strong"
                        : "border-dashed border-leaf-edge/70 bg-leaf-soft/50 text-leaf/80"
                    : current
                      ? "border-leaf-edge bg-leaf-soft text-leaf"
                      : moveActive
                        ? "border-transparent text-body hover:border-leaf-edge hover:bg-leaf-soft/60"
                        : "border-transparent text-body hover:bg-parchment"
                }`}
              >
                {editingId !== g.id && (
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    aria-label={rowLabel}
                    onClick={() => {
                      if (moveActive) {
                        if (!current) moveHere(g, selection);
                        return;
                      }
                      onSwitch(g.id);
                    }}
                    className="absolute inset-0 z-0 cursor-pointer rounded-[10px] outline-none focus-visible:shadow-focus"
                  />
                )}

                <span
                  aria-hidden
                  className={`pointer-events-none relative z-10 flex h-6 w-6 shrink-0 items-center justify-center ${
                    current ? "text-leaf-icon" : "text-faint"
                  }`}
                >
                  <GroupGlyph
                    group={g}
                    size={14.5}
                    fallback={g.is_default ? <Home size={14.5} /> : <span className="h-2 w-2 rounded-full bg-current" />}
                  />
                </span>

                {editingId === g.id ? (
                  <input
                    ref={editRef}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
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
                    aria-label={t("groups.rename")}
                    className="relative z-10 min-w-0 flex-1 rounded-md border border-leaf-edge bg-card px-2 py-1 text-[13px] text-ink outline-none focus:shadow-focus"
                  />
                ) : (
                  <span
                    className={`pointer-events-none relative z-10 min-w-0 flex-1 truncate text-[13.5px] font-medium ${
                      current ? "text-leaf" : ""
                    }`}
                    style={!current && g.color ? { color: groupColorVar(g.color) } : undefined}
                  >
                    {g.name}
                  </span>
                )}

                {editingId !== g.id && (
                  <>
                    <span
                      aria-hidden
                      className={`pointer-events-none relative z-10 shrink-0 text-[11px] tabular-nums ${
                        current ? "text-leaf-icon/80" : "text-faint"
                      }`}
                    >
                      {g.count}
                    </span>

                    {dragActive && (
                      <CornerDownRight
                        size={13}
                        aria-hidden
                        className={`pointer-events-none relative z-10 shrink-0 text-leaf-icon transition-transform duration-150 ${
                          dragOverId === g.id ? "scale-125 opacity-100" : "opacity-55"
                        }`}
                      />
                    )}

                    {selection.length > 0 && !dragActive && (
                      <button
                        type="button"
                        aria-label={`${t("groups.moveHere")} — ${g.name}`}
                        title={t("groups.moveHere")}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveHere(g, selection);
                        }}
                        className="press relative z-10 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-leaf-icon transition-colors hover:bg-parchment"
                      >
                        <CornerDownRight size={13} />
                      </button>
                    )}

                    {!g.is_default && !dragActive && (
                      <span className="relative z-10 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <button
                          type="button"
                          aria-label={t("groups.style")}
                          title={t("groups.style")}
                          onClick={(e) => {
                            e.stopPropagation();
                            openStyle(g);
                          }}
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-parchment hover:text-ink"
                        >
                          <Palette size={12} />
                        </button>
                        <button
                          type="button"
                          aria-label={t("action.edit")}
                          title={t("action.edit")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditName(g.name);
                            setEditingId(g.id);
                          }}
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-parchment hover:text-ink"
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
                              ? "bg-destructive text-on-ink"
                              : "text-muted hover:bg-parchment hover:text-destructive"
                          }`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    )}
                  </>
                )}
              </div>
              {styleId === g.id && (
                <GroupAppearance
                  color={styleDraft.color}
                  icon={styleDraft.icon}
                  onPick={(next) => void pickStyle(g.id, next)}
                  onClose={closeStyle}
                />
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
            aria-label={t("groups.new")}
            className="w-full rounded-md border border-hairline bg-parchment px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint focus:shadow-focus"
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
    </motion.div>
  );
}

/** Name of the default group for the delete hint. */
function groupNameOf(groups: GroupInfo[]): string {
  return groups.find((g) => g.is_default)?.name ?? "";
}
