/** Session-level memo for translated prompt pages.
 *
 * A translation costs a network round-trip, and the card offers a one-click
 * toggle back to the original — the same page is often re-opened, flipped to
 * and away from several times while the detail panel stays up. The cache makes
 * every one of those free.
 *
 * Entries are validated against the source text, so editing a prompt never
 * resurrects a stale translation; the map is insertion-ordered and bounded, so
 * a long browsing session forgets its oldest pages instead of growing forever.
 */
interface CachedTranslation {
  source: string;
  text: string;
}

const LIMIT = 48;
const cache = new Map<string, CachedTranslation>();

const keyOf = (cardId: string, idx: number, lang: string) => `${cardId}\u0000${idx}\u0000${lang}`;

export function readCachedTranslation(
  cardId: string,
  idx: number,
  lang: string,
  source: string
): string | null {
  const hit = cache.get(keyOf(cardId, idx, lang));
  return hit && hit.source === source ? hit.text : null;
}

export function writeCachedTranslation(
  cardId: string,
  idx: number,
  lang: string,
  source: string,
  text: string
): void {
  const key = keyOf(cardId, idx, lang);
  cache.delete(key);
  cache.set(key, { source, text });
  if (cache.size > LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Drops the page's entry after an edit — the next translate is fresh. */
export function forgetCachedTranslation(cardId: string, idx: number): void {
  const prefix = `${cardId}\u0000${idx}\u0000`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
