// ─── iPhone calendars (EventKit) ─────────────────────────────────────
// On the native app, read the calendars already on the phone (iCloud, Google,
// Exchange, anything added in iOS Settings) instead of asking for an iCloud
// app-specific password and fetching over CalDAV. The web app keeps CalDAV.
import { Capacitor } from "@capacitor/core";

export interface DeviceEvent {
  id: string;
  title: string;
  date: string;          // local YYYY-MM-DD
  time?: string;         // local HH:MM, absent for all-day
  source: "apple";
  color: string;
  allDay: boolean;
  location?: string;
  calendarId?: string;
}

const DAYS_BACK = 1;
const DAYS_AHEAD = 60;

export function deviceCalendarSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

// Wrapped in an object: a Capacitor plugin returned straight from an async
// function is mistaken for a promise and hangs forever (see appleHealth.ts).
async function plugin() {
  const { CapacitorCalendar } = await import("@ebarooni/capacitor-calendar");
  return { CapacitorCalendar };
}

// Granted already? (No prompt.)
export async function deviceCalendarConnected(): Promise<boolean> {
  if (!deviceCalendarSupported()) return false;
  try {
    const { result } = await (await plugin()).CapacitorCalendar.checkAllPermissions();
    return result.readCalendar === "granted";
  } catch { return false; }
}

// Shows iOS's calendar permission prompt. iOS only asks once; after a "Don't
// Allow" the person has to turn it on in Settings.
export async function connectDeviceCalendar(): Promise<boolean> {
  if (!deviceCalendarSupported()) return false;
  try {
    const { result } = await (await plugin()).CapacitorCalendar.requestFullCalendarAccess();
    return result === "granted";
  } catch { return false; }
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function toDeviceEvent(e: { id: string; title: string; startDate: number; isAllDay: boolean; color: string | null; location: string | null; calendarId?: string | null }): DeviceEvent {
  const start = new Date(e.startDate);
  return {
    // Recurring events share an id, so the start time keeps each one distinct.
    id: `device_${e.id}_${e.startDate}`,
    title: e.title || "Event",
    date: localDate(start),
    ...(e.isAllDay ? {} : { time: `${pad(start.getHours())}:${pad(start.getMinutes())}` }),
    source: "apple",
    color: e.color || "#6E6E73",
    allDay: e.isAllDay,
    ...(e.location ? { location: e.location } : {}),
    ...(e.calendarId ? { calendarId: e.calendarId } : {}),
  };
}

// ── Which calendars ──
// Calendars on the phone, for Choose calendars. "own" = the default answer:
// ones the person can add events to. Read-only calendars (usually shared by
// a colleague), subscriptions (holidays, sports) and Birthdays start unticked.
export interface DeviceCalendarInfo { id: string; name: string; color: string; account: string; own: boolean }

const SUBSCRIPTION = 3, BIRTHDAY = 4; // the plugin's CalendarType values

export function isOwnDeviceCalendar(c: { allowsContentModifications?: boolean | null; isSubscribed?: boolean | null; type?: number | null }): boolean {
  return c.allowsContentModifications !== false && !c.isSubscribed && c.type !== SUBSCRIPTION && c.type !== BIRTHDAY;
}

export async function listDeviceCalendars(): Promise<DeviceCalendarInfo[] | null> {
  if (!(await deviceCalendarConnected())) return null;
  try {
    const { result } = await (await plugin()).CapacitorCalendar.listCalendars();
    return result.map(c => ({
      id: c.id, name: c.title || "Calendar", color: c.color || "#6E6E73",
      account: c.source?.title || c.accountName || "", own: isOwnDeviceCalendar(c),
    }));
  } catch { return null; }
}

// The chosen calendars' events, as the full list for [range.from, range.to)
// (so events from unticked or removed calendars can be cleared). Null when
// the calendars can't be read: then nothing is cleared.
export async function readDeviceCalendar(uid?: string): Promise<{ events: DeviceEvent[]; range: { from: string; to: string } } | null> {
  const calendars = await listDeviceCalendars();
  if (!calendars) return null;
  const { loadCalendarChoice, isPicked } = await import("./calendarChoice");
  const choice = uid ? (await loadCalendarChoice(uid)).device : undefined;
  const chosen = new Set(calendars.filter(c => isPicked(c.id, c.own, choice)).map(c => c.id));
  const now = Date.now();
  try {
    const { result } = await (await plugin()).CapacitorCalendar.listEventsInRange({
      from: now - DAYS_BACK * 86400000,
      to: now + DAYS_AHEAD * 86400000,
    });
    return {
      events: result.filter(e => !e.calendarId || chosen.has(e.calendarId)).map(toDeviceEvent),
      range: { from: localDate(new Date(now)), to: localDate(new Date(now + DAYS_AHEAD * 86400000)) },
    };
  } catch { return null; }
}

export async function fetchDeviceEvents(): Promise<DeviceEvent[]> {
  const { auth } = await import("./firebase");
  return (await readDeviceCalendar(auth.currentUser?.uid))?.events || [];
}
