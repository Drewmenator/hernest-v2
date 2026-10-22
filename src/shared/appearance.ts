// ─── Appearance: Wisteria Glow or Midnight Wisteria ────────────────
// "Automatic" (the default) follows the iPhone's Light/Dark setting; the
// person can pin one in Settings. Never switches by time of day. Kept on
// this device only (localStorage), like other display preferences.
import { Capacitor } from "@capacitor/core";
import { PALETTES } from "../config/theme";

export type Appearance = "auto" | "light" | "dark";
const KEY = "hn_appearance";

export function getAppearance(): Appearance {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch { return "auto"; }
}

function systemDark(): boolean {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
}

export function isDark(pref: Appearance = getAppearance()): boolean {
  return pref === "dark" || (pref === "auto" && systemDark());
}

// Light text in the status bar on Midnight, dark text on Glow.
function syncChrome(dark: boolean) {
  const bg = dark ? PALETTES.dark.bg : PALETTES.light.bg;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  try {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("StatusBar")) return;
  } catch { return; }
  import("@capacitor/status-bar")
    .then(({ StatusBar, Style }) => StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }))
    .catch(() => {});
}

export function applyAppearance(pref: Appearance = getAppearance()) {
  const root = document.documentElement;
  if (pref === "auto") delete root.dataset.theme;
  else root.dataset.theme = pref;
  syncChrome(isDark(pref));
}

export function setAppearance(pref: Appearance) {
  try {
    if (pref === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* private mode */ }
  applyAppearance(pref);
}

// Call once at start: applies the saved choice and follows the phone
// when it switches between light and dark.
let started = false;
export function startAppearance() {
  applyAppearance();
  if (started) return;
  started = true;
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (getAppearance() === "auto") applyAppearance("auto");
    });
  } catch { /* old WebView */ }
}

// Which tab's light the page shows (Today, Plan, Cleo, Bills, Me).
export function setPageTab(tab: string) {
  document.documentElement.dataset.tab = tab;
}
