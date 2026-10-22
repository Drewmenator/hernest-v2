// ─── Her events for the next few days ──────────────────────────────
// One flat list from everything the app already stores: events she added,
// synced calendars (Google/Outlook/iCloud), school dates, and on the iPhone
// the phone's own calendars. Used by Wellness (how busy is today) and Style
// (what to wear, what's coming up).
import { loadData } from "./firebase";
import { todayLocal } from "./dateAwareness";

export interface SimpleEvent {
  id: string;
  title: string;
  date: string;   // local YYYY-MM-DD
  time?: string;  // HH:MM, absent for all-day
  location?: string;
}

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return todayLocal(new Date(y, m - 1, d + n));
};

// Pure: dedupe, keep [from, from+days), sort by date then time.
export function eventsInWindow(raw: unknown[], from: string, days: number): SimpleEvent[] {
  const end = addDays(from, days);
  const seen = new Set<string>();
  const out: SimpleEvent[] = [];
  for (const item of raw) {
    const r = item as Record<string, unknown> | null;
    if (!r || typeof r.date !== "string" || typeof r.title !== "string") continue;
    const date = r.date.slice(0, 10);
    if (date < from || date >= end) continue;
    const time = typeof r.time === "string" && /^\d{1,2}:\d{2}/.test(r.time) ? r.time.slice(0, 5).padStart(5, "0") : undefined;
    const key = `${date}|${time || ""}|${r.title.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: String(r.id || key), title: r.title.trim(), date, ...(time ? { time } : {}), ...(r.location ? { location: String(r.location) } : {}) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
}

export async function loadUpcomingEvents(uid: string, days = 7): Promise<SimpleEvent[]> {
  const [cal, synced, school] = await Promise.all([
    loadData(uid, "calendar").catch(() => null),
    loadData(uid, "calendar_synced").catch(() => null),
    loadData(uid, "school").catch(() => null),
  ]);
  const raw: unknown[] = [
    ...((cal?.events as unknown[]) || []),
    ...((synced?.events as unknown[]) || []),
    ...((school?.events as unknown[]) || []),
  ];
  try {
    const dc = await import("./deviceCalendar");
    if (dc.deviceCalendarSupported()) raw.push(...(await dc.fetchDeviceEvents()));
  } catch { /* no phone calendar */ }
  return eventsInWindow(raw, todayLocal(), days);
}
