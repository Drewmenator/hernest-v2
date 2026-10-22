// Loads everything that belongs on the calendar: events added in HerNest,
// connected calendars (Google / Outlook / Apple), trips and family birthdays.
// Moved here from the old Calendar screen so Plan → Week is the one calendar
// view. Connecting calendars happens in Connections; this only reads.
import { useState, useEffect, useCallback, useRef } from "react";
import { loadData, db, auth } from "../../core/firebase";
import { bus } from "../../core/events";
import { saveSyncedEvents, type SyncMeta } from "../../core/connectorSync";
import { deviceCalendarSupported, deviceCalendarConnected, readDeviceCalendar } from "../../core/deviceCalendar";
import { birthdayEvents } from "./planHelpers";
import type { Person } from "../../core/familyPeople";

export interface CalEvent {
  id: string; title: string; date: string; time?: string;
  source: string; child?: string; color?: string; allDay?: boolean; location?: string; notes?: string;
}

const onDevice = deviceCalendarSupported();

async function collectEvents(uid: string, people: Person[]): Promise<CalEvent[]> {
  const all: CalEvent[] = [];
  const [cal, synced, trips] = await Promise.all([loadData(uid, "calendar"), loadData(uid, "calendar_synced"), loadData(uid, "trips")]);
  if (cal?.events) all.push(...(cal.events as CalEvent[]));
  if (synced?.events) all.push(...(synced.events as CalEvent[]));
  for (const t of ((trips?.trips as Array<{ id: string; dest?: string; date?: string }>) || [])) {
    if (t?.date) all.push({ id: `trip-${t.id}`, title: `${t.dest || "Trip"}`, date: t.date, source: "trip", allDay: true });
  }
  all.push(...(birthdayEvents(people, new Date().getFullYear()) as CalEvent[]));
  const seen = new Set<string>();
  return all.filter(e => e?.id && !seen.has(e.id) && seen.add(e.id));
}

// Put fresh events over the ones on screen, matched by id: a renamed or moved
// event replaces its old copy (incoming wins), new ones are added at the end.
export function mergeEventsById(prev: CalEvent[], incoming: CalEvent[]): CalEvent[] {
  const fresh = new Map<string, CalEvent>();
  for (const e of incoming) if (e?.id) fresh.set(e.id, e);
  const out = prev.map(e => {
    const f = fresh.get(e.id);
    if (!f) return e;
    fresh.delete(e.id);
    return f;
  });
  return [...out, ...fresh.values()];
}

// Re-read events when the app comes back to the front, at most this often.
const RESUME_GAP_MS = 5 * 60 * 1000;

export function useCalendarEvents(uid: string | undefined, people: Person[]) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [connected, setConnected] = useState({ google: false, outlook: false, apple: false, checked: false });


  // Bumped when the app comes back to the front, so saved and connected
  // calendars are read again (an event edited elsewhere shows its new version).
  const [resumeTick, setResumeTick] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined") return;
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < RESUME_GAP_MS) return;
      last = Date.now();
      setResumeTick(t => t + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Latest versions fetched from connected calendars in this pull. The saved
  // copy can be read before a pull saves, so it must not put old versions back.
  const pulled = useRef(new Map<string, CalEvent>());

  const reload = useCallback(async () => {
    if (uid) { const all = await collectEvents(uid, people); setEvents(all.map(e => pulled.current.get(e.id) ?? e)); }
  }, [uid, people]);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    collectEvents(uid, people).then(all => { if (alive) setEvents(all.map(e => pulled.current.get(e.id) ?? e)); });
    return () => { alive = false; };
  }, [uid, people, resumeTick]);

  // Which calendars are connected (set up in Connections).
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    (async () => {
      const { doc, getDoc } = await import("firebase/firestore");
      const has = async (name: string, field: string) => {
        try { const s = await getDoc(doc(db, "users", uid, "integrations", name)); return s.exists() && !!(s.data()?.[field] || s.data()?.connectedAt); }
        catch { return false; }
      };
      const [google, outlook, apple] = await Promise.all([
        has("google_calendar", "connected"),
        has("outlook_calendar", "connected"),
        onDevice ? deviceCalendarConnected().catch(() => false) : has("apple_calendar", "email"),
      ]);
      if (alive) setConnected({ google, outlook, apple, checked: true });
    })();
    return () => { alive = false; };
  }, [uid]);

  // Pull fresh events from connected calendars and keep a saved copy
  // (calendar_synced) so they show instantly next time and Cleo can see them.
  useEffect(() => {
    if (!uid || !connected.checked) return;
    const merge = async (provider: string, incoming: CalEvent[], meta: SyncMeta = {}) => {
      if (!incoming?.length && !(meta.complete && meta.range)) return;
      if (incoming.length) bus.publish("calendar.synced", { source: provider, count: incoming.length }, { userId: uid, source: "calendar" }).catch(() => {});
      for (const e of incoming) if (e?.id) pulled.current.set(e.id, e);
      setEvents(prev => mergeEventsById(prev, incoming));
      try {
        // Same merge as the background sync: when the server sent the full
        // list, events cancelled at the provider are removed (yours only).
        const removed = await saveSyncedEvents(uid, provider, incoming, meta);
        if (removed.size) setEvents(prev => prev.filter(e => !removed.has(e.id)));
      } catch (err) { console.warn("[Week] saving synced events failed:", err); }
    };
    const fetchFrom = async (provider: string) => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) return;
        const res = await fetch(`/api/calendar/${provider}?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, { headers: { Authorization: `Bearer ${idToken}` } });
        if (!res.ok) return;
        const data = (await res.json()) as { events?: CalEvent[]; complete?: boolean; range?: SyncMeta["range"] };
        await merge(provider, Array.isArray(data?.events) ? data.events : [], { complete: data?.complete === true, range: data?.range });
      } catch (e) { console.warn("[Week] calendar fetch failed:", provider, e); }
    };
    pulled.current = new Map();
    // One after another: all of them write the same calendar_synced doc.
    (async () => {
      if (connected.google) await fetchFrom("google");
      if (connected.outlook) await fetchFrom("outlook");
      if (connected.apple && onDevice) {
        // Only the chosen iPhone calendars; the full list, so events from
        // unticked or removed calendars are cleared.
        const r = await readDeviceCalendar(uid).catch(() => null);
        if (r) await merge("device", r.events as CalEvent[], { complete: true, range: r.range });
      }
      else if (connected.apple) await fetchFrom("apple");
    })();
  }, [uid, connected, resumeTick]);

  const anyConnected = connected.google || connected.outlook || connected.apple;
  return { events, reload, anyConnected, connectionChecked: connected.checked };
}
