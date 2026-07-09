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
}

const CALENDAR_PROVIDERS = [
  { provider: "google", doc: "google_calendar", field: "accessToken" },
  { provider: "apple", doc: "apple_calendar", field: "email" },
  { provider: "outlook", doc: "outlook_calendar", field: "accessToken" },
] as const;

async function idToken(): Promise<string | null> {
  try { return (await auth.currentUser?.getIdToken()) || null; } catch { return null; }
}

// Merge provider events into calendar_synced (same shape CalendarScreen uses)
async function persistEvents(uid: string, events: any[]): Promise<void> {
  if (!events.length) return;
  const existing = ((await loadData(uid, "calendar_synced"))?.events as any[]) || [];
  const byId = new Map<string, any>();
  [...existing, ...events].forEach((e: any) => { if (e?.id) byId.set(e.id, e); });
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const merged = [...byId.values()].filter((e: any) => !e.date || e.date >= cutoff);
  await saveData(uid, "calendar_synced", { events: merged });
}

async function isConnected(uid: string, docName: string, field: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, "users", uid, "integrations", docName));
    return snap.exists() && !!snap.data()?.[field];
  } catch { return false; }
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
      if (data.events?.length) {
        await persistEvents(uid, data.events);
        bus.publish("calendar.synced", { source: provider, count: data.events.length }, { userId: uid, source: "connectorSync" }).catch(() => {});
      }
    } catch (e) {
      console.warn("[ConnectorSync]", provider, "failed:", e);
    }
  }));

  // Oura: refresh sleep/readiness server-side, then auto-log wellness so
  // Thrive/briefing see it without the user ever opening a form.
  if (await isConnected(uid, "oura", "accessToken")) {
    try {
      await fetch("/api/connectors?provider=oura&action=sync", { headers: { Authorization: `Bearer ${token}` } });
    } catch { /* health written server-side */ }
  }
  import("./wellnessAutoTrack").then(m => m.autoTrackWellness(uid)).catch(() => {});
}

// ── OAuth connect: fetch the signed auth URL with a Bearer token, then
//    navigate. (The old flow put a raw uid in the redirect — hijackable.) ──
export async function connectOAuth(provider: "google" | "gmail" | "outlook" | "oura"): Promise<boolean> {
  const token = await idToken();
  if (!token) return false;
  try {
    const res = await fetch(`/api/auth/${provider}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.url) { window.location.href = data.url; return true; }
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
