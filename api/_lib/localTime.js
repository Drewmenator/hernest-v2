// ─── Local-morning timing for the briefing push ────────────────────
// Each device stores its IANA time zone (e.g. "America/New_York") when it
// registers for push. An hourly trigger asks, per user: is it morning where
// they are, and have they already had today's briefing? Pure functions only,
// so the rules are unit-tested without Firestore.

// Briefing goes out at the first hourly run from 7:00 local. The window runs
// to 10:00 so a late or skipped run (GitHub's hourly schedule can slip by tens
// of minutes) still delivers; the per-date dedupe keeps it to one per day.
export const MORNING_HOUR = 7;
export const MORNING_WINDOW_END = 10;

export function isValidTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

// { date: "YYYY-MM-DD", hour: 0-23, minute, second } as seen on a wall clock in
// `tz` at the instant `now`. Null for an unknown zone.
export function localParts(now, tz) {
  if (!isValidTimeZone(tz)) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// A Date whose clock reads the user's local wall time. The digest builders
// (todayISO, birthdays, bill due days) read "today" from the Date they're
// given; on the server (UTC) this makes them see the user's own date, so a
// Sydney user's 7am briefing lists Tuesday's events, not Monday's.
export function wallClockNow(now, tz) {
  const p = localParts(now, tz);
  if (!p) return now;
  const [y, m, d] = p.date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, p.hour, p.minute, p.second));
}

// The zone to use for a user: from their most recently updated device that
// has a valid one. `devices` is [{ timeZone, updatedAt }]. Null if none.
export function pickTimeZone(devices) {
  let best = null;
  for (const d of devices || []) {
    if (!isValidTimeZone(d?.timeZone)) continue;
    if (!best || (d.updatedAt || 0) > (best.updatedAt || 0)) best = d;
  }
  return best ? best.timeZone : null;
}

// Should this user get the briefing on this run? `lastSentDate` is the local
// date (YYYY-MM-DD) of the last briefing we sent them. Returns
// { send, localDate } so the caller can record localDate after sending.
export function morningDue({ timeZone, now, lastSentDate }) {
  const p = localParts(now, timeZone);
  if (!p) return { send: false, localDate: null };
  const inWindow = p.hour >= MORNING_HOUR && p.hour < MORNING_WINDOW_END;
  return { send: inWindow && lastSentDate !== p.date, localDate: p.date };
}

// Group device rows ({ uid, timeZone, updatedAt }) into Map uid -> zone|null.
export function userTimeZones(rows) {
  const byUid = new Map();
  for (const r of rows || []) {
    if (!r?.uid) continue;
    if (!byUid.has(r.uid)) byUid.set(r.uid, []);
    byUid.get(r.uid).push(r);
  }
  return new Map([...byUid].map(([uid, devices]) => [uid, pickTimeZone(devices)]));
}

// The hourly trigger counts as running if it was seen in the last 3 hours.
export const HOURLY_STALE_MS = 3 * 60 * 60 * 1000;
export function hourlyTriggerAlive(lastHourlyAt, nowMs) {
  return typeof lastHourlyAt === "number" && nowMs - lastHourlyAt < HOURLY_STALE_MS;
}

// Claim today's briefing for this user BEFORE sending, in a transaction, so two
// overlapping runs can't both send. Stored as users/{uid}/data/push_state
// .morningSentDate (the user's local date). Returns the previous date (so the
// caller can roll back if the send throws), or undefined if already claimed.
export async function claimMorning(db, uid, localDate) {
  const ref = db.doc(`users/${uid}/data/push_state`);
  return db.runTransaction(async tx => {
    const prev = (await tx.get(ref)).data()?.morningSentDate ?? null;
    if (prev === localDate) return undefined;
    tx.set(ref, { morningSentDate: localDate }, { merge: true });
    return prev;
  });
}
