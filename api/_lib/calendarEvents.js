// ─── Calendar event mapping + merge (pure, tested) ─────────────────
// One place that turns Google / Outlook / Apple (ICS) events into the app's
// shape { id, title, date: "YYYY-MM-DD", time?: "HH:MM" (24h), source, color,
// allDay }, with date and time on the USER's wall clock (the server runs in
// UTC, so an 8pm Chicago event must not land on tomorrow). Used by the
// on-demand sync (connectors.js) and the nightly cron (cron.js) so both write
// the same shape and the cron no longer strips times.
import { localParts, isValidTimeZone } from "./localTime.js";

export const DEFAULT_TZ = "America/Chicago"; // US pilot

export const zoneOr = (tz, fallback = DEFAULT_TZ) => (isValidTimeZone(tz) ? tz : fallback);

// The user's local date at `now`, or the UTC date when no valid zone.
export function localDate(now, tz) {
  return (isValidTimeZone(tz) && localParts(now, tz)?.date) || now.toISOString().slice(0, 10);
}

// The instant at which `date` (YYYY-MM-DD) starts on the wall clock in `tz`.
// Two passes so a DST change near midnight still lands on the right hour.
export function zonedMidnight(date, tz) {
  const [y, m, d] = date.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  if (!isValidTimeZone(tz)) return new Date(base);
  let guess = base;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    const [py, pm, pd] = p.date.split("-").map(Number);
    const wall = Date.UTC(py, pm - 1, pd, p.hour, p.minute, p.second);
    guess = base - (wall - guess);
  }
  return new Date(guess);
}

const pad = (n) => String(n).padStart(2, "0");

// { date, time } on the user's wall clock for an absolute instant.
// Without a valid zone, read the wall clock literally from the string (Google
// sends it in the calendar's own offset, which is the best guess left).
export function wallClock(iso, tz) {
  if (!iso) return { date: "", time: undefined };
  if (isValidTimeZone(tz)) {
    const at = new Date(iso);
    if (!isNaN(at.getTime())) {
      const p = localParts(at, tz);
      return { date: p.date, time: `${pad(p.hour)}:${pad(p.minute)}` };
    }
  }
  return { date: iso.slice(0, 10), time: /T\d{2}:\d{2}/.test(iso) ? iso.slice(11, 16) : undefined };
}

// ── Google ──────────────────────────────────────────────────────────
export function mapGoogleEvent(e, cal = {}, tz) {
  const allDay = !!e?.start?.date;
  const { date, time } = allDay ? { date: e.start.date, time: undefined } : wallClock(e?.start?.dateTime, tz);
  return {
    id: `google_${e.id}`,
    title: e.summary || "Event",
    date,
    ...(time ? { time } : {}),
    source: "google", color: cal.backgroundColor || "#4285F4",
    allDay, ...(cal.summary ? { calendar: cal.summary } : {}),
  };
}

// Pulls every readable calendar's events from local midnight today (so events
// that already started today are refreshed too) through `days` ahead.
// `complete` is false if anything failed or was cut off; callers must then
// merge only, never replace (a failed fetch must not wipe the calendar).
// `from` / `to` are the local dates covered: from inclusive, to exclusive.
export async function fetchGoogleEvents(accessToken, { tz, now = new Date(), days = 60, fetchImpl = fetch, maxPages = 4 } = {}) {
  const zone = isValidTimeZone(tz) ? tz : null;
  const from = localDate(now, zone);
  // No zone: start 14h before UTC midnight so nothing dated "today" anywhere is missed.
  const timeMin = zone ? zonedMidnight(from, zone) : new Date(zonedMidnight(from, null).getTime() - 14 * 3600000);
  const end = new Date(now.getTime() + days * 86400000);
  const to = localDate(end, zone);
  const headers = { Authorization: `Bearer ${accessToken}` };
  let complete = true;

  let calendars = [];
  try {
    const listData = await (await fetchImpl("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50", { headers })).json();
    if (listData?.error || !Array.isArray(listData?.items)) complete = false;
    calendars = (listData?.items || []).filter(c => c.accessRole !== "freeBusyReader");
    if (listData?.nextPageToken) complete = false;
  } catch { complete = false; }
  if (!calendars.length) complete = false; // never treat "no calendars" as "no events"

  let events = [];
  for (const cal of calendars) {
    let pageToken = "";
    let pages = 0;
    try {
      do {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events`
          + `?timeMin=${encodeURIComponent(timeMin.toISOString())}&timeMax=${encodeURIComponent(end.toISOString())}`
          + `&singleEvents=true&orderBy=startTime&maxResults=250${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
        const evData = await (await fetchImpl(url, { headers })).json();
        if (evData?.error) { complete = false; break; }
        events = events.concat((evData.items || []).map(e => mapGoogleEvent(e, cal, zone)));
        pageToken = evData.nextPageToken || "";
        pages++;
      } while (pageToken && pages < maxPages);
      if (pageToken) complete = false;
    } catch (e) {
      complete = false;
      console.error("[Calendar] google calendar fetch:", e?.message);
    }
  }
  const seen = new Set();
  events = events.filter(e => e.id && !seen.has(e.id) && seen.add(e.id));
  return { events, complete, from, to };
}

// ── Outlook (Microsoft Graph) ───────────────────────────────────────
// Ask Graph for times in the user's zone: Prefer: outlook.timezone="<IANA>".
export const outlookHeaders = (accessToken, tz) => ({
  Authorization: `Bearer ${accessToken}`,
  Prefer: `outlook.timezone="${zoneOr(tz)}"`,
});

// Graph returns start.dateTime without an offset plus start.timeZone. If the
// Prefer header was honoured that's already the user's wall clock; if it came
// back in UTC, convert it.
export function mapOutlookEvent(e, tz) {
  const raw = e?.start?.dateTime || "";
  const allDay = !!e?.isAllDay;
  let date = raw.slice(0, 10), time;
  if (!allDay && raw) {
    const zone = e?.start?.timeZone || "UTC";
    const isUtc = /^(utc|etc\/utc|gmt|coordinated universal time)$/i.test(zone) || /Z$/.test(raw);
    ({ date, time } = isUtc && isValidTimeZone(tz)
      ? wallClock(`${raw.replace(/Z$/, "").slice(0, 19)}Z`, tz)
      : wallClock(raw.slice(0, 19), null));
  }
  return {
    id: `outlook_${e.id}`, title: e.subject || "Event",
    date, ...(time ? { time } : {}),
    source: "work", color: "#0078D4", allDay,
  };
}

// ── Apple (CalDAV / ICS) ────────────────────────────────────────────
// DTSTART forms: 20261022 (all day), 20261022T190000Z (UTC → user's zone),
// 20261022T190000 with TZID (already a wall clock, kept as written).
export function parseICSEvents(icsText, tz) {
  const events = [];
  const blocks = String(icsText || "").split("BEGIN:VEVENT");
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const get = (key) => {
      const match = block.match(new RegExp(`${key}[^:]*:([^\\r\\n]+)`));
      return match ? match[1].trim() : "";
    };
    const dtstart = get("DTSTART");
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(dtstart);
    if (!m) continue;
    const [, y, mo, d, hh, mm, ss, z] = m;
    let date = `${y}-${mo}-${d}`, time;
    if (hh) {
      if (z && isValidTimeZone(tz)) ({ date, time } = wallClock(`${date}T${hh}:${mm}:${ss || "00"}Z`, tz));
      else time = `${hh}:${mm}`;
    }
    events.push({
      id: `apple_${get("UID") || Math.random()}`,
      title: get("SUMMARY") || "Event",
      date, ...(time ? { time } : {}),
      source: "apple", color: "#6E6E73",
      allDay: !hh,
    });
  }
  return events;
}

// ── Merging into calendar_synced ────────────────────────────────────
// Default: merge by id (fresh wins). With replace = { source, from, to }, the
// stored events of that source dated in [from, to) are dropped first, so
// events cancelled or deleted at the provider disappear. Pass replace only
// when the fetch was complete. Past events (before `from`) are always kept,
// trimmed at `cutoff`. A fresh timed event that came without a time keeps the
// stored copy's time.
export function mergeSyncedEvents(existing, fresh, { replace = null, cutoff = null } = {}) {
  const prior = (existing || []).filter(e => e?.id);
  const priorById = new Map(prior.map(e => [e.id, e]));
  const inReplaced = (e) => replace && e.source === replace.source && e.date
    && e.date >= replace.from && (!replace.to || e.date < replace.to);
  const byId = new Map();
  for (const e of prior) if (!inReplaced(e)) byId.set(e.id, e);
  for (const e of fresh || []) {
    if (!e?.id) continue;
    const old = priorById.get(e.id);
    byId.set(e.id, !e.time && !e.allDay && old?.time && old.date === e.date ? { ...e, time: old.time } : e);
  }
  return [...byId.values()].filter(e => !cutoff || !e.date || e.date >= cutoff);
}

// Several household members' fetches → one. Complete only if every part is
// (and `allFetched`, i.e. no member was skipped); the replace window is the
// span every part covered: latest `from`, earliest `to`.
export function combineFetches(parts, allFetched = true) {
  const list = (parts || []).filter(Boolean);
  const seen = new Set();
  const events = list.flatMap(p => p.events || []).filter(e => e?.id && !seen.has(e.id) && seen.add(e.id));
  const froms = list.map(p => p.from).filter(Boolean).sort();
  const tos = list.map(p => p.to).filter(Boolean).sort();
  const complete = allFetched && list.length > 0 && list.every(p => p.complete) && froms.length === list.length && tos.length === list.length;
  return { events, complete, from: froms[froms.length - 1] || null, to: tos[0] || null };
}
