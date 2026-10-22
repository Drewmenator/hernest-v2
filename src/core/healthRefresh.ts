// ─── Keep data fresh when the app comes back ───────────────────────
// iPhone apps usually resume instead of starting over, so "sync on app
// open" alone left last night's sleep and new calendar events missing until
// HerNest was fully closed. When the app comes back to the front this
// re-reads Oura and Apple Health and re-syncs connected calendars (each at
// most every 10 minutes), then tells open screens:
//   HEALTH_UPDATED: new wearable numbers are saved (re-read them)
//   APP_RESUMED:    the app is back; reload anything shown (and check the date)
// Screens only re-read on these events; they never sync themselves, so
// there's no loop. Every step has a time limit, so nothing hangs.
import { withTimeout } from "./timeout";

export const HEALTH_UPDATED = "hn-health-updated";
export const APP_RESUMED = "hn-app-resumed";
const MIN_GAP_MS = 10 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 30_000;

let lastRun = 0;
let running: Promise<void> | null = null;

export function refreshHealth(uid: string, force = false): Promise<void> {
  if (running && !force) return running;
  if (!force && Date.now() - lastRun < MIN_GAP_MS) return Promise.resolve();
  lastRun = Date.now();
  // Oura first (the server pulls last night from Oura), then Apple Health
  // on the phone, then the shared wellness auto-log.
  const chain = import("./connectorSync")
    .then(c => c.syncOuraNow(uid))
    .then(() => import("./wellnessAutoTrack"))
    .then(m => m.autoTrackWellness(uid))
    .catch(() => {});
  // Whatever happens, finish within the time limit and tell screens.
  const p = withTimeout(chain, HEALTH_TIMEOUT_MS)
    .then(() => { window.dispatchEvent(new Event(HEALTH_UPDATED)); })
    .finally(() => { if (running === p) running = null; });
  running = p;
  return p;
}

// Call once after sign-in.
let listening = false;
let lastResume = 0;
export function startHealthRefreshOnResume(getUid: () => string | null | undefined) {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    const uid = getUid();
    if (document.visibilityState !== "visible" || !uid) return;
    // A quick app switch (under a minute) doesn't need a full refresh.
    if (Date.now() - lastResume < 60_000) return;
    lastResume = Date.now();
    import("./firebase").then(f => f.clearDataCaches()).catch(() => {});
    refreshHealth(uid);
    import("./connectorSync").then(c => c.syncAllConnectors(uid)).catch(() => {});
    window.dispatchEvent(new Event(APP_RESUMED));
  });
}

// For screens: run `fn` when fresh wearable numbers arrive.
export function onHealthUpdated(fn: () => void): () => void {
  window.addEventListener(HEALTH_UPDATED, fn);
  return () => window.removeEventListener(HEALTH_UPDATED, fn);
}

// For screens: run `fn` when the app comes back to the front.
export function onAppResumed(fn: () => void): () => void {
  window.addEventListener(APP_RESUMED, fn);
  return () => window.removeEventListener(APP_RESUMED, fn);
}
