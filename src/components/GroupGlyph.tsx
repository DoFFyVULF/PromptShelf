import type { ReactNode } from "react";
import { groupColorStyle } from "../lib/groupStyle";
import { groupIconMeta } from "../lib/groupIcons";
import type { GroupInfo } from "../lib/types";

interface GroupGlyphProps {
  group: GroupInfo | null;
  size?: number;
  /** Shown when the group has no custom icon or colour. */
  fallback?: ReactNode;
}

/**
 * A group's chosen icon/colour, with the caller's familiar glyph as the
 * fallback. Keeps Home/Folder/dot behaviour intact for untouched groups.
 */
export function GroupGlyph({ group, size = 14, fallback }: GroupGlyphProps) {
  const tint = groupColorStyle(group?.color ?? "");
  const meta = group?.icon ? groupIconMeta(group.icon) : undefined;

  if (meta) {
    const Icon = meta.icon;
    return <Icon size={size} className={tint ? "group-tint" : undefined} style={tint} aria-hidden />;
  }
  if (tint) {
    return <span className="group-tint-bg h-2 w-2 rounded-full" style={tint} aria-hidden />;
  }
  return <>{fallback ?? <span className="h-2 w-2 rounded-full bg-current" />}</>;
}
