export const isMac =
  typeof navigator !== "undefined" &&
  (/Mac|iPhone|iPad/.test(navigator.userAgent) || navigator.platform?.startsWith?.("Mac"));

export const modKey = isMac ? "⌘" : "Ctrl+";
