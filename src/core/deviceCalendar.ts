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
}

const DAYS_BACK = 1;
const DAYS_AHEAD = 60;

export function deviceCalendarSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

async function plugin() {
  const { CapacitorCalendar } = await import("@ebarooni/capacitor-calendar");
  return CapacitorCalendar;
}

// Granted already? (No prompt.)
export async function deviceCalendarConnected(): Promise<boolean> {
  if (!deviceCalendarSupported()) return false;
  try {
    const { result } = await (await plugin()).checkAllPermissions();
    return result.readCalendar === "granted";
  } catch { return false; }
}

// Shows iOS's calendar permission prompt. iOS only asks once; after a "Don't
// Allow" the person has to turn it on in Settings.
export async function connectDeviceCalendar(): Promise<boolean> {
  if (!deviceCalendarSupported()) return false;
  try {
    const { result } = await (await plugin()).requestFullCalendarAccess();
    return result === "granted";
  } catch { return false; }
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function toDeviceEvent(e: { id: string; title: string; startDate: number; isAllDay: boolean; color: string | null; location: string | null }): DeviceEvent {
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
  };
}

export async function fetchDeviceEvents(): Promise<DeviceEvent[]> {
  if (!(await deviceCalendarConnected())) return [];
  const now = Date.now();
  const { result } = await (await plugin()).listEventsInRange({
    from: now - DAYS_BACK * 86400000,
    to: now + DAYS_AHEAD * 86400000,
  });
  return result.map(toDeviceEvent);
}
