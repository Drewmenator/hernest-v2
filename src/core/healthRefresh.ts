// ─── Keep Apple Health / Oura numbers fresh ────────────────────────
// iPhone apps usually resume instead of starting over, so "sync on app
// open" alone left last night's sleep missing until HerNest was fully
// closed. This re-reads Oura and Apple Health whenever the app comes back to the
// front (at most every 10 minutes), then tells open screens to update
// (window event HEALTH_UPDATED). Screens re-read the saved numbers on that
// event; they don't sync themselves, so there's no loop.
export const HEALTH_UPDATED = "hn-health-updated";
const MIN_GAP_MS = 10 * 60 * 1000;

let lastRun = 0;
let running: Promise<void> | null = null;

export function refreshHealth(uid: string, force = false): Promise<void> {
  if (running) return running;
  if (!force && Date.now() - lastRun < MIN_GAP_MS) return Promise.resolve();
  lastRun = Date.now();
  // Oura first (the server pulls last night from Oura), then Apple Health
  // on the phone, then the shared wellness auto-log.
  running = import("./connectorSync")
    .then(c => c.syncOuraNow(uid))
    .then(() => import("./wellnessAutoTrack"))
    .then(m => m.autoTrackWellness(uid))
    .then(() => { window.dispatchEvent(new Event(HEALTH_UPDATED)); })
    .catch(() => {})
    .finally(() => { running = null; });
  return running;
}

// Call once after sign-in.
let listening = false;
export function startHealthRefreshOnResume(getUid: () => string | null | undefined) {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    const uid = getUid();
    if (document.visibilityState === "visible" && uid) refreshHealth(uid);
  });
}

// For screens: run `fn` when fresh numbers arrive. Returns the unsubscribe.
export function onHealthUpdated(fn: () => void): () => void {
  window.addEventListener(HEALTH_UPDATED, fn);
  return () => window.removeEventListener(HEALTH_UPDATED, fn);
}
