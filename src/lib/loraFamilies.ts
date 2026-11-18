import type { LoraSummary } from "./types";

/**
 * A "family" is one lora kept in several variants: another CivitAI version of
 * the same model, the same lora for another base model, or a manually added
 * twin. Only such sets get a deck tile — exact duplicates are left alone.
 */
export interface LoraFamily {
  /** Stable across reloads; derived from the model id (or the name for manual entries). */
  id: string;
  name: string;
  members: LoraSummary[];
  reason: "version" | "model";
  /** Member ids — used to tell a declined offer from a newly changed set. */
  signature: string;
}

export interface FamilyDismiss {
  id: string;
  signature: string;
}

/** What the lora detail page needs to offer grouping after a decline. */
export interface FamilyOffer {
  id: string;
  count: number;
  reason: LoraFamily["reason"];
}

const MODEL_URL = /civitai\.(?:com|red)\/models\/(\d+)/i;
const VERSION_PARAM = /[?&]modelVersionId=(\d+)/i;
/** A trailing "v2", "ver 1.5", "version 3" is a variant marker, not a new name. */
const VERSION_SUFFIX = /\s+(?:v|ver|version)?\s*\d+(?:\.\d+)*\s*$/i;

/** CivitAI origin pins the model and the exact version; manual loras have neither. */
export function loraSourceParts(lora: LoraSummary): {
  model: string | null;
  version: string | null;
} {
  return {
    model: lora.source_url?.match(MODEL_URL)?.[1] ?? null,
    version: lora.source_url?.match(VERSION_PARAM)?.[1] ?? null,
  };
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(VERSION_SUFFIX, "")
    .trim();
}

function displayName(members: LoraSummary[]): string {
  const oldest = [...members].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )[0];
  return oldest.name.replace(VERSION_SUFFIX, "").trim() || oldest.name;
}

/** One variant = one exact CivitAI version, or one model id, or one base model. */
function variantKey(lora: LoraSummary): string {
  const { model, version } = loraSourceParts(lora);
  if (version) return `v:${version}`;
  if (model) return `m:${model}`;
  return `b:${lora.base_model.trim().toLowerCase()}`;
}

/**
 * Two loras belong together when they share a name OR a CivitAI model id.
 * A set only becomes a family once its members are genuinely different
 * variants (different version / model / base model) — duplicates don't count.
 */
export function detectFamilies(loras: LoraSummary[]): LoraFamily[] {
  if (loras.length < 2) return [];

  const parent = loras.map((_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : (parent[x] = find(parent[x]));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const byName = new Map<string, number>();
  const byModel = new Map<string, number>();
  loras.forEach((lora, i) => {
    const name = normalizeName(lora.name);
    if (name) {
      const seen = byName.get(name);
      if (seen === undefined) byName.set(name, i);
      else union(seen, i);
    }
    const { model } = loraSourceParts(lora);
    if (model) {
      const seen = byModel.get(model);
      if (seen === undefined) byModel.set(model, i);
      else union(seen, i);
    }
  });

  const buckets = new Map<number, number[]>();
  loras.forEach((_, i) => {
    const root = find(i);
    const bucket = buckets.get(root) ?? [];
    bucket.push(i);
    buckets.set(root, bucket);
  });

  const families: LoraFamily[] = [];
  for (const indices of buckets.values()) {
    if (indices.length < 2) continue;
    const members = indices
      .map((i) => loras[i])
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (new Set(members.map(variantKey)).size < 2) continue;

    const models = new Set(
      members.map((m) => loraSourceParts(m).model).filter((m): m is string => !!m),
    );
    const name = displayName(members);
    families.push({
      id:
        models.size === 1
          ? `model:${[...models][0]}`
          : `name:${normalizeName(name)}`,
      name,
      members,
      reason: models.size === 1 ? "version" : "model",
      signature: members
        .map((m) => m.id)
        .sort()
        .join("|"),
    });
  }

  // Newest family first, mirroring the grid's "newest" rhythm.
  return families.sort((a, b) =>
    b.members[0].created_at.localeCompare(a.members[0].created_at),
  );
}

// ---------------------------------------------------------------- persistence

const GROUPED_KEY = "ps-lora-families";
const DISMISSED_KEY = "ps-lora-families-dismissed";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / full storage — grouping still works for this session */
  }
}

export const readGroupedFamilies = (): string[] => {
  const value = read<unknown>(GROUPED_KEY, []);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
};

export const writeGroupedFamilies = (ids: string[]) => write(GROUPED_KEY, ids);

export const readDismissedFamilies = (): FamilyDismiss[] => {
  const value = read<unknown>(DISMISSED_KEY, []);
  if (!Array.isArray(value)) return [];
  return value.filter(
    (d): d is FamilyDismiss =>
      !!d && typeof d.id === "string" && typeof d.signature === "string",
  );
};

export const writeDismissedFamilies = (list: FamilyDismiss[]) =>
  write(DISMISSED_KEY, list);

/** A decline covers exactly the set that was on screen; adding/removing a lora
 * invalidates it, so the offer can come back with the new variants. */
export function isFamilyDismissed(
  family: LoraFamily,
  dismissed: FamilyDismiss[],
): boolean {
  return dismissed.some(
    (d) => d.id === family.id && d.signature === family.signature,
  );
}
