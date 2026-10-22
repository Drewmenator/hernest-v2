// ─── Connector sync engine (Wave 1) ────────────────────────────────
// Background-refreshes every connected source on app open — the briefing
// and graph read calendar_synced, so freshness no longer depends on the
// user visiting the Calendar screen. Sync health (lastSyncedAt, itemCount,
// lastError) is written server-side to users/{uid}/integrations/{doc}.
import { auth, loadData, saveData, db } from "./firebase";
import { doc, getDoc } from "firebase/firestore";
import { bus } from "./events";

export interface ConnectorHealth {
  connected: boolean;
  lastSyncedAt?: number;
  itemCount?: number;
  lastError?: string | null;
  // Apple Health: connected, but the iPhone isn't sharing any data with us
  // (iOS never says whether permission was given, so we check for data).
  noData?: boolean;
}

const CALENDAR_PROVIDERS = [
  { provider: "google", doc: "google_calendar", field: "accessToken" },
  { provider: "apple", doc: "apple_calendar", field: "email" },
  { provider: "outlook", doc: "outlook_calendar", field: "accessToken" },
] as const;

async function idToken(): Promise<string | null> {
  try { return (await auth.currentUser?.getIdToken()) || null; } catch { return null; }
}

const SOURCE_OF: Record<string, string> = { google: "google", outlook: "work", apple: "apple" };

export interface SyncMeta { complete?: boolean; range?: { from: string; to: string } | null }

// Merge provider events into calendar_synced (same shape CalendarScreen uses).
// calendar_synced is shared with the household, so each event records who
// synced it. When the server says it sent the full list for a date range,
// events this user synced earlier in that range that are no longer there
// (cancelled or moved) are dropped. Other people's events are never touched.
export interface SyncedEvent { id?: string; date?: string; source?: string; syncedBy?: string }

export function mergeSyncedEvents(existing: SyncedEvent[], events: SyncedEvent[], uid: string, provider: string, meta: SyncMeta = {}, cutoff = ""): SyncedEvent[] {
  const source = SOURCE_OF[provider];
  const range = meta.complete ? meta.range : null;
  const inRange = (e: SyncedEvent) => !!range && !!e.date && e.date >= range.from && e.date < range.to;
  const kept = range && source
    ? existing.filter(e => !(e?.source === source && e?.syncedBy === uid && inRange(e)))
    : existing;
  const byId = new Map<string, SyncedEvent>();
  kept.forEach(e => { if (e?.id) byId.set(e.id, e); });
  events.forEach(e => { if (e?.id) byId.set(e.id, { ...e, syncedBy: uid }); });
  return [...byId.values()].filter(e => !e.date || e.date >= cutoff);
}

// Saves the merge and returns the ids of events it removed (so an open
// calendar can take them off the screen too).
export async function saveSyncedEvents(uid: string, provider: string, events: SyncedEvent[], meta: SyncMeta = {}): Promise<Set<string>> {
  if (!events.length && !(meta.complete && meta.range)) return new Set();
  const existing = ((await loadData(uid, "calendar_synced"))?.events as SyncedEvent[]) || [];
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const merged = mergeSyncedEvents(existing, events, uid, provider, meta, cutoff);
  await saveData(uid, "calendar_synced", { events: merged });
  const kept = new Set(merged.map(e => e.id));
  return new Set(existing.map(e => e?.id).filter((id): id is string => !!id && !kept.has(id)));
}

async function isConnected(uid: string, docName: string, field: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, "users", uid, "integrations", docName));
    return snap.exists() && !!snap.data()?.[field];
  } catch { return false; }
}

// Ask the server to pull the latest Oura sleep, readiness and activity
// (no-op when Oura isn't connected). Also used when the app resumes.
export async function syncOuraNow(uid: string): Promise<void> {
  if (!(await isConnected(uid, "oura", "accessToken"))) return;
  const token = await idToken();
  if (!token) return;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await fetch(`/api/connectors?provider=oura&action=sync&tz=${encodeURIComponent(tz)}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch { /* health written server-side */ }
}

// ── Sync all connected calendar sources. Fire-and-forget from App boot. ──
let lastRun = 0;
export async function syncAllConnectors(uid: string): Promise<void> {
  if (Date.now() - lastRun < 10 * 60 * 1000) return; // at most every 10 min
  lastRun = Date.now();

  const token = await idToken();
  if (!token) return;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  await Promise.all(CALENDAR_PROVIDERS.map(async ({ provider, doc: docName, field }) => {
    if (!(await isConnected(uid, docName, field))) return;
    try {
      const res = await fetch(`/api/calendar/${provider}?tz=${encodeURIComponent(tz)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return; // health written server-side (incl. reauth_required)
      const data = await res.json();
      const events = Array.isArray(data.events) ? data.events : [];
      await saveSyncedEvents(uid, provider, events, { complete: data.complete === true, range: data.range });
      if (events.length) {
        bus.publish("calendar.synced", { source: provider, count: events.length }, { userId: uid, source: "connectorSync" }).catch(() => {});
      }
    } catch (e) {
      console.warn("[ConnectorSync]", provider, "failed:", e);
    }
  }));

  // Oura: refresh sleep/readiness server-side, then auto-log wellness so
  // Thrive/briefing see it without the user ever opening a form.
  await syncOuraNow(uid);
  import("./memory").then(m => m.maintainMemory(uid)).catch(() => {});
  import("./wellnessAutoTrack").then(async m => {
    await m.autoTrackWellness(uid);
    // Screens opened before the sync finished re-read the fresh numbers.
    import("./healthRefresh").then(h => window.dispatchEvent(new Event(h.HEALTH_UPDATED))).catch(() => {});
    // With fresh wearable data, deliver a wellness nudge as a local notification
    // if one applies right now (native only, deduped per type per day).
    import("./localNotifications").then(l => l.maybeScheduleWellnessNudge(uid)).catch(() => {});
  }).catch(() => {});
}

// ── Disconnect: the server cancels HerNest's access at the provider (best
//    effort) and deletes the stored sign-in, so Connect starts fresh. ──
export async function disconnectOAuth(provider: "google" | "gmail" | "outlook" | "oura"): Promise<boolean> {
  const token = await idToken();
  if (!token) return false;
  try {
    const res = await fetch(`/api/connectors?provider=${provider}&action=disconnect`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch { return false; }
}

// ── OAuth connect: fetch the signed auth URL with a Bearer token, then
//    navigate. (The old flow put a raw uid in the redirect — hijackable.) ──
export async function connectOAuth(provider: "google" | "gmail" | "outlook" | "oura"): Promise<boolean> {
  const token = await idToken();
  if (!token) return false;
  const native = !!(window as any).Capacitor?.isNativePlatform?.();
  try {
    const res = await fetch(`/api/auth/${provider}${native ? "?native=1" : ""}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!data.url) return false;

    // Native: open the provider sign-in in an in-app browser sheet so the app's
    // own webview isn't navigated away (which used to strand the user on the web
    // login screen). Resolve once they close the sheet; the caller re-reads health.
    if (native) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: data.url });
      await new Promise<void>((resolve) => {
        let handle: any;
        Browser.addListener("browserFinished", () => { handle?.remove?.(); resolve(); })
          .then((h) => { handle = h; });
      });
      return true;
    }

    // Web: full-page redirect returns to the SPA (same session) as before.
    window.location.href = data.url;
    return true;
  } catch (e) { console.warn("[ConnectorSync] auth start failed:", e); }
  return false;
}

// ── Read connector health for the Connections screen ──
export async function getConnectorHealth(uid: string, docName: string, field: string): Promise<ConnectorHealth> {
  try {
    const snap = await getDoc(doc(db, "users", uid, "integrations", docName));
    if (!snap.exists()) return { connected: false };
    const d = snap.data();
    return {
      connected: !!d?.[field],
      lastSyncedAt: d?.lastSyncedAt,
      itemCount: d?.itemCount,
      lastError: d?.lastError || null,
    };
  } catch { return { connected: false }; }
}
