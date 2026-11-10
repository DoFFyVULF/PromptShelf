export const isMac =
  typeof navigator !== "undefined" &&
  (/Mac|iPhone|iPad/.test(navigator.userAgent) || navigator.platform?.startsWith?.("Mac"));

export const modKey = isMac ? "⌘" : "Ctrl+";

/**
 * Lowercase key used for shortcut matching that survives non-Latin layouts.
 * With a Russian layout Ctrl+C reports e.key === "с", so letter shortcuts
 * fall back to the layout-independent physical key (e.code "KeyC" -> "c").
 * Latin e.key wins when present so Dvorak-style remaps keep working.
 */
export function shortcutKey(e: { key: string; code?: string }): string {
  const key = e.key.toLowerCase();
  if (/^[a-z0-9]$/.test(key)) return key;
  const code = e.code ?? "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (code === "Comma") return ",";
  return key;
}
