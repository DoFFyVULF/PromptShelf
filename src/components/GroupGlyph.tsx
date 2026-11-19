import type { ReactNode } from "react";
import { groupColorVar } from "../lib/groupStyle";
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
  const color = groupColorVar(group?.color ?? "");
  const meta = group?.icon ? groupIconMeta(group.icon) : undefined;

  if (meta) {
    const Icon = meta.icon;
    return <Icon size={size} style={color ? { color } : undefined} aria-hidden />;
  }
  if (color) {
    return <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />;
  }
  return <>{fallback ?? <span className="h-2 w-2 rounded-full bg-current" />}</>;
}
