import { useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown, Folder, Home } from "lucide-react";
import { useI18n } from "../i18n";
import { groupColorStyle } from "../lib/groupStyle";
import type { GroupInfo } from "../lib/types";
import { GroupGlyph } from "./GroupGlyph";

interface GroupPickerProps {
  groups: GroupInfo[];
  /** The card's own group, not the shelf scope — a card opened from
   * "All cards" may live anywhere. */
  currentGroupId: string;
  onPick: (group: GroupInfo) => void;
  /** The popover is owned by the detail view so its Esc handler can close it
   * before the panel itself. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A quiet pill in the detail header that files the open card into another
 * group. The menu is a small, keyboard-navigable list — the detail page never
 * needs to enter selection mode just to move one item.
 */
export function GroupPicker({
  groups,
  currentGroupId,
  onPick,
  open,
  onOpenChange,
}: GroupPickerProps) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const current =
    groups.find((g) => g.id === currentGroupId) ??
    groups.find((g) => g.is_default) ??
    null;

  const close = useCallback(
    (restoreFocus = false) => {
      onOpenChange(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [onOpenChange],
  );

  // click anywhere outside the pill/menu dismisses it
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  // opening moves focus into the menu at the current group, so arrow keys and
  // Enter work immediately
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
      if (!items?.length) return;
      const checked = Array.from(items).find((el) => el.getAttribute("aria-checked") === "true");
      (checked ?? items[0]).focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") {
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : e.key === "ArrowDown"
            ? (at + 1) % items.length
            : (at - 1 + items.length) % items.length;
    items[next].focus();
  };

  const label = current?.name ?? t("groups.default");
  // The checked group borrows its Appearance colour for the selection state;
  // untouched groups keep the emerald accent.
  const currentTint = groupColorStyle(current?.color ?? "");
  const openTinted = open && Boolean(currentTint);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("groups.moveTo")}: ${label}`}
        title={t("groups.moveTo")}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onOpenChange(true);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            close(true);
          }
        }}
        className={`press flex h-7 max-w-[168px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium outline-none transition-colors focus-visible:shadow-focus ${
          open
            ? openTinted
              ? "group-accent border-accent-edge bg-accent-soft text-accent-ink"
              : "border-leaf-edge bg-leaf-soft text-leaf"
            : "border-hairline bg-card text-muted hover:bg-parchment hover:text-ink"
        }`}
        style={openTinted ? currentTint : undefined}
      >
        <GroupGlyph
          group={current}
          size={11.5}
          fallback={current?.is_default ? <Home size={11.5} /> : <Folder size={11.5} />}
        />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown
          size={11}
          className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            role="menu"
            aria-label={t("groups.moveTo")}
            onKeyDown={onMenuKeyDown}
            initial={reduceMotion ? false : { opacity: 0, y: -4, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.985 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "spring", visualDuration: 0.18, bounce: 0.06 }
            }
            className="absolute top-[calc(100%+6px)] left-0 z-30 max-h-[268px] w-[232px] overflow-y-auto rounded-xl border border-hairline bg-card p-1 shadow-panel"
          >
            <p className="sticky top-0 z-10 bg-card px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.07em] text-faint uppercase select-none">
              {t("groups.moveTo")}
            </p>
            {groups.map((group) => {
              const active = group.id === (current?.id ?? currentGroupId);
              const tint = groupColorStyle(group.color);
              const activeTinted = active && Boolean(tint);
              return (
                <button
                  key={group.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    close(true);
                    if (!active) onPick(group);
                  }}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] outline-none transition-colors focus-visible:shadow-focus ${
                    active
                      ? activeTinted
                        ? "group-accent bg-accent-soft text-accent-ink"
                        : "bg-leaf-soft text-leaf"
                      : "text-body hover:bg-parchment"
                  }`}
                  style={activeTinted ? tint : undefined}
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center ${
                      active ? (activeTinted ? "text-accent" : "text-leaf-icon") : "text-faint"
                    }`}
                  >
                    <GroupGlyph
                      group={group}
                      size={12.5}
                      fallback={group.is_default ? <Home size={12.5} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                  <span className={`shrink-0 text-[10.5px] tabular-nums ${
                    active ? (activeTinted ? "text-accent-ink" : "text-leaf-icon/80") : "text-faint"
                  }`}>
                    {group.count}
                  </span>
                  <span className="flex w-3.5 shrink-0 justify-end">
                    {active && (
                      <Check size={12} className={activeTinted ? "text-accent-ink" : "text-leaf-icon"} aria-hidden />
                    )}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
