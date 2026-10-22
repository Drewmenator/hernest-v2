// Loads everything that belongs on the calendar: events added in HerNest,
// connected calendars (Google / Outlook / Apple), trips and family birthdays.
// Moved here from the old Calendar screen so Plan → Week is the one calendar
// view. Connecting calendars happens in Connections; this only reads.
import { useState, useEffect, useCallback } from "react";
import { loadData, saveData, db, auth } from "../../core/firebase";
import { bus } from "../../core/events";
import { deviceCalendarSupported, deviceCalendarConnected, fetchDeviceEvents } from "../../core/deviceCalendar";
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
    if (t?.date) all.push({ id: `trip-${t.id}`, title: `✈ ${t.dest || "Trip"}`, date: t.date, source: "trip", allDay: true });
  }
  all.push(...(birthdayEvents(people, new Date().getFullYear()) as CalEvent[]));
  const seen = new Set<string>();
  return all.filter(e => e?.id && !seen.has(e.id) && seen.add(e.id));
}

export function useCalendarEvents(uid: string | undefined, people: Person[]) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [connected, setConnected] = useState({ google: false, outlook: false, apple: false, checked: false });

  const reload = useCallback(async () => {
    if (uid) setEvents(await collectEvents(uid, people));
  }, [uid, people]);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    collectEvents(uid, people).then(all => { if (alive) setEvents(all); });
    return () => { alive = false; };
  }, [uid, people]);

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
    const merge = async (source: string, incoming: CalEvent[]) => {
      if (!incoming?.length) return;
      bus.publish("calendar.synced", { source, count: incoming.length }, { userId: uid, source: "calendar" }).catch(() => {});
      setEvents(prev => { const ids = new Set(prev.map(e => e.id)); return [...prev, ...incoming.filter(e => !ids.has(e.id))]; });
      try {
        const existing = ((await loadData(uid, "calendar_synced"))?.events as CalEvent[]) || [];
        const byId = new Map<string, CalEvent>();
        [...existing, ...incoming].forEach(e => { if (e?.id) byId.set(e.id, e); });
        const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
        await saveData(uid, "calendar_synced", { events: [...byId.values()].filter(e => !e.date || e.date >= cutoff) });
      } catch (err) { console.warn("[Week] saving synced events failed:", err); }
    };
    const fetchFrom = async (url: string) => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) return;
        const res = await fetch(`${url}?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, { headers: { Authorization: `Bearer ${idToken}` } });
        await merge(url, ((await res.json()) as { events?: CalEvent[] })?.events || []);
      } catch (e) { console.warn("[Week] calendar fetch failed:", url, e); }
    };
    // One after another: all of them write the same calendar_synced doc.
    (async () => {
      if (connected.google) await fetchFrom("/api/calendar/google");
      if (connected.outlook) await fetchFrom("/api/calendar/outlook");
      if (connected.apple && onDevice) await merge("device", (await fetchDeviceEvents().catch(() => [])) as CalEvent[]);
      else if (connected.apple) await fetchFrom("/api/calendar/apple");
    })();
  }, [uid, connected]);

  const anyConnected = connected.google || connected.outlook || connected.apple;
  return { events, reload, anyConnected, connectionChecked: connected.checked };
}
