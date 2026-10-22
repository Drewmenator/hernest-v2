// ─── School calendar import (pure, testable) ───────────────────────
// A school's year calendar comes in as an .ics file, a CSV, or a photo or
// PDF that Cleo reads. Each date becomes a calendar event for one child,
// saved with the household's other events so Plan → Week, the month view,
// Today and Cleo all see it. Uploading again for the same child replaces
// that child's earlier school calendar (re-imports never double up).
import type { CalEvent } from "./useCalendarEvents";

export interface SchoolDate { title: string; date: string; endDate?: string | null }

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

// "20261103" or "20261103T080000Z" → "2026-11-03"
function icsDate(v: string): string | null {
  const c = v.replace(/T.*/, "").replace(/[^0-9]/g, "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}` : null;
}

// Unfold continuation lines, then read each VEVENT's SUMMARY and dates.
// DTEND for all-day events is exclusive in iCal, so it moves back a day.
export function parseIcs(text: string): SchoolDate[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const out: SchoolDate[] = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const get = (key: string) => block.match(new RegExp(`(?:^|\\n)${key}[^:\\n]*:([^\\r\\n]+)`))?.[1]?.trim() ?? "";
    const title = get("SUMMARY").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").trim();
    const start = icsDate(get("DTSTART"));
    if (!title || !start) continue;
    const endRaw = get("DTEND");
    let end = endRaw ? icsDate(endRaw) : null;
    const allDay = !/T\d/.test(get("DTSTART"));
    if (end && allDay) end = addDays(end, -1);
    out.push({ title, date: start, endDate: end && end > start ? end : null });
  }
  return out;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One event per day; multi-day breaks (up to two weeks) fill each day so
// "no school" shows on every day it covers.
export function toSchoolEvents(dates: SchoolDate[], child: { name: string; color?: string }): CalEvent[] {
  const out: CalEvent[] = [];
  const key = child.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  for (const d of dates) {
    if (!d?.title || !isoDay.test(d.date)) continue;
    const last = d.endDate && isoDay.test(d.endDate) && d.endDate > d.date ? d.endDate : d.date;
    for (let day = d.date, i = 0; day <= last && i < 14; day = addDays(day, 1), i++) {
      const slug = d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
      out.push({ id: `school_${key}_${day}_${slug}`, title: d.title, date: day, source: "school", child: child.name, allDay: true, ...(child.color ? { color: child.color } : {}) });
    }
  }
  const seen = new Set<string>();
  return out.filter(e => !seen.has(e.id) && seen.add(e.id)).sort((a, b) => a.date.localeCompare(b.date));
}

// Keep everything else; swap this child's school calendar for the new one.
export function replaceChildSchool(existing: CalEvent[], childName: string, incoming: CalEvent[]): CalEvent[] {
  const keep = existing.filter(e => !(e?.source === "school" && e.child === childName));
  return [...keep, ...incoming];
}

export const SCHOOL_CALENDAR_SYSTEM =
  "You read school year calendars. List every dated item: holidays, breaks, no-school days, early dismissals, exams, events. "
  + "Dates are YYYY-MM-DD; use the school year shown to pick the year. endDate is null unless the item spans several days. "
  + "Return an empty list if you find no dates. Never invent dates.";
