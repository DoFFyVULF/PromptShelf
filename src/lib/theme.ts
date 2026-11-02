import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Theme } from "./types";

/**
 * Theme plumbing: the `.dark` class on <html> flips the whole token set in
 * styles.css; "system" follows the macOS appearance. The native window chrome
 * (title bar, vibrancy) is kept in step via Window.setTheme, null = follow OS.
 */

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function isSystemDark(): boolean {
  return darkQuery.matches;
}

export function resolveDark(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && darkQuery.matches);
}

export function themeFromStorage(): Theme {
  const s = window.localStorage.getItem("ps-theme");
  return s === "light" || s === "dark" ? s : "system";
}

export function applyTheme(theme: Theme): void {
  const dark = resolveDark(theme);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  try {
    void getCurrentWindow().setTheme(theme === "system" ? null : theme).catch(() => undefined);
  } catch {
    /* outside a Tauri window (plain vite) — the class toggle above still works */
  }
}

/** Subscribe to macOS appearance changes while in the "system" mode. */
export function onSystemThemeChange(cb: () => void): () => void {
  darkQuery.addEventListener("change", cb);
  return () => darkQuery.removeEventListener("change", cb);
}
