import { useCallback, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";

/** What the UI needs to show an update: version + notes, plus the real
 * updater handle for the install. */
export interface UpdateAvailability {
  version: string;
  body: string;
  real: Update;
}

/** Once-per-launch update availability state, shared by the logo badge and
 * the settings dialog. The real network check never runs synchronously with
 * startup: it waits for the first idle frame after a grace period, so library
 * loading keeps the main thread.
 *
 * Dismissing ("cancel" in the update dialog) hides the badge until the next
 * launch — the settings note still shows the pending version. */
export function useUpdateCheck() {
  const [found, setFound] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const ranRef = useRef(false);

  const runBackgroundCheck = useCallback((enabled: boolean) => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (!enabled) return;
    const run = () => {
      void check()
        .then((update) => {
          if (update) setFound(update);
        })
        .catch(() => undefined);
    };
    // 2.5s grace period, then the first idle frame the browser is willing to give
    window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(run, { timeout: 5000 });
      } else {
        window.setTimeout(run, 400);
      }
    }, 2500);
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  /** The settings dialog runs its own manual check — feed a found update back
   * so the badge and the settings note stay in sync. */
  const adoptFound = useCallback((a: UpdateAvailability | null) => {
    if (a) setFound(a.real);
  }, []);

  const available: UpdateAvailability | null = dismissed
    ? null
    : found
      ? { version: found.version, body: found.body ?? "", real: found }
      : null;

  // The same availability ignoring a dismissal — the settings note's "open"
  // button uses it, so the dialog still shows the known update after the
  // user once said no.
  const pending: UpdateAvailability | null = found
    ? { version: found.version, body: found.body ?? "", real: found }
    : null;

  // The settings note shows the pending version even after a dismissal —
  // no nagging in the header, but the user can still find the update.
  const hasUpdate = found !== null;
  const version = found?.version ?? null;

  return { available, pending, hasUpdate, version, dismiss, adoptFound, runBackgroundCheck };
}
