import type { GroupInfo } from "./types";

/**
 * "All groups" is a view, not a row in the database. The backend already
 * treats a missing `group_id` as "every group", so the shelf only needs a
 * sentinel that survives restarts in localStorage.
 */
export const ALL_GROUPS = "__all__";

export const isAllGroups = (id: string | null | undefined): boolean =>
  id === ALL_GROUPS;

/** The value handed to `list_cards` / `list_loras`. */
export function groupFilterId(id: string): string | null {
  if (!id || isAllGroups(id)) return null;
  return id;
}

/** Every card on the shelf lives in exactly one group, so the counters add up
 * to the "All cards" total without another request. */
export function allGroupsCount(groups: GroupInfo[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}
