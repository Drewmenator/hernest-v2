// ─── Overnight sync cron (Wave 1 follow-on) ────────────────────────
// Vercel Cron hits this daily (vercel.json → crons). Refreshes every
// user's Google Calendar server-side and persists events to their
// calendar_synced doc, so the morning briefing is fresh BEFORE the app is
// opened. Also clears the cached briefing so it regenerates on next open.
//
// ?mode=hourly (called by GitHub Actions every hour) skips the calendar
// refresh and only sends morning briefings to users whose local time is 7am.
//
// Auth: Vercel adds `Authorization: Bearer $CRON_SECRET` when CRON_SECRET
// is set; the GitHub workflow sends the same header. We reject anything else.
import { adminDb, encryptSecret, openToken } from "./_lib/secure.js";
import { sendDailyPushesTo } from "./_lib/push.js";
import { morningDue, localParts, wallClockNow, userTimeZones, hourlyTriggerAlive, claimMorning } from "./_lib/localTime.js";

async function refreshGoogle(uid, data) {
  let accessToken = openToken(data.accessToken);
  const refreshToken = openToken(data.refreshToken);
  if (!refreshToken) return null;
  if (Date.now() > (data.expiresAt || 0) - 60000) {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const refreshed = await r.json().catch(() => ({}));
    if (!refreshed.access_token) return null;
    accessToken = refreshed.access_token;
    await adminDb.doc(`users/${uid}/integrations/google_calendar`).update({
      accessToken: encryptSecret(accessToken),
      refreshToken: encryptSecret(refreshToken),
      expiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000,
    });
  }
  return accessToken;
}

async function fetchEvents(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 60 * 86400000).toISOString();
  const listData = await (await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50", { headers })).json();
  const calendars = (listData.items || []).filter(c => c.accessRole !== "freeBusyReader");
  let events = [];
  for (const cal of calendars) {
    try {
      const evData = await (await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=50`,
        { headers }
      )).json();
      if (evData.error) continue;
      events = events.concat((evData.items || []).map(e => ({
        id: `google_${e.id}`,
        title: e.summary || "Event",
        date: e.start?.date || (e.start?.dateTime ? e.start.dateTime.split("T")[0] : ""),
        source: "google", color: cal.backgroundColor || "#4285F4",
        allDay: !!e.start?.date,
      })));
    } catch { /* skip a calendar */ }
  }
  const seen = new Set();
  return events.filter(e => e.id && !seen.has(e.id) && seen.add(e.id));
}

// calendar_synced is a household-scoped collection: partners' data lives
// under the primary's uid. Resolve the owner before persisting.
async function ownerFor(uid) {
  try {
    const link = await adminDb.doc(`users/${uid}/data/household_link`).get();
    const primaryUid = link.exists ? link.data()?.primaryUid : null;
    return primaryUid || uid;
  } catch { return uid; }
}

async function persist(uid, events) {
  if (!events.length) return;
  const owner = await ownerFor(uid);
  const existing = ((await adminDb.doc(`users/${owner}/data/calendar_synced`).get()).data()?.events) || [];
  const byId = new Map();
  [...existing, ...events].forEach(e => { if (e?.id) byId.set(e.id, e); });
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const merged = [...byId.values()].filter(e => !e.date || e.date >= cutoff);
  await adminDb.doc(`users/${owner}/data/calendar_synced`).set({ events: merged }, { merge: true });
}

// ── Morning briefing push ──────────────────────────────────────────
// One "good morning" nudge per user who has a device registered, lightly
// personalized with today's calendar count (built in _lib/push.js). Tapping it
// opens the briefing tab.
//
// Timing: devices store their time zone, and an hourly trigger (GitHub Actions,
// .github/workflows/morning-push.yml → ?mode=hourly) sends each such user their
// briefing at local 7am. Users with no stored zone (older app builds) keep the
// old behaviour: the daily 06:00 UTC run. If the hourly trigger has stopped
// (no run in 3h), the daily run covers everyone so nobody silently goes without.
const HOURLY_STATE = "ops/cron_state";

async function deviceZonesByUser() {
  const deviceSnap = await adminDb.collectionGroup("devices").limit(2000).get();
  return userTimeZones(deviceSnap.docs.map(d => ({ uid: d.ref.parent.parent?.id, ...d.data() })));
}

async function sendMorningTo(uid, timeZone, now, localDate) {
  if (localDate) {
    const prev = await claimMorning(adminDb, uid, localDate);
    if (prev === undefined) return false;
    try {
      const r = await sendDailyPushesTo(uid, timeZone ? wallClockNow(now, timeZone) : now);
      return r.digest > 0 || r.birthday > 0;
    } catch (e) {
      // Release the claim so the next hourly run retries.
      await adminDb.doc(`users/${uid}/data/push_state`).set({ morningSentDate: prev }, { merge: true }).catch(() => {});
      throw e;
    }
  }
  const r = await sendDailyPushesTo(uid, now);
  return r.digest > 0 || r.birthday > 0;
}

// Hourly: users whose local time is in the morning window and who haven't had
// today's briefing.
async function sendLocalMorningBriefings(now = new Date()) {
  await adminDb.doc(HOURLY_STATE).set({ lastHourlyAt: now.getTime() }, { merge: true });
  const zones = await deviceZonesByUser();
  let pushed = 0;
  for (const [uid, timeZone] of zones) {
    if (!timeZone) continue;
    try {
      // Cheap pre-check on the clock alone; claimMorning does the real dedupe.
      const { send, localDate } = morningDue({ timeZone, now, lastSentDate: null });
      if (send && await sendMorningTo(uid, timeZone, now, localDate)) pushed++;
    } catch (e) {
      console.error("[Cron] hourly push failed:", e?.message);
    }
  }
  return pushed;
}

// Daily (06:00 UTC): users with no stored zone, plus everyone if the hourly
// trigger looks dead. Zoned users are still deduped by their local date.
async function sendMorningBriefings(now = new Date()) {
  const zones = await deviceZonesByUser();
  const lastHourlyAt = (await adminDb.doc(HOURLY_STATE).get()).data()?.lastHourlyAt;
  const fallback = !hourlyTriggerAlive(lastHourlyAt, now.getTime());
  if (fallback) console.warn("[Cron] hourly trigger not seen in 3h; daily run sends to everyone");
  let pushed = 0;
  for (const [uid, timeZone] of zones) {
    if (timeZone && !fallback) continue;
    try {
      const localDate = timeZone ? localParts(now, timeZone)?.date : null;
      if (await sendMorningTo(uid, timeZone, now, localDate)) pushed++;
    } catch (e) {
      console.error("[Cron] daily push failed:", e?.message);
    }
  }
  return pushed;
}

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers["authorization"] !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.query?.mode === "hourly") {
    try {
      const pushed = await sendLocalMorningBriefings();
      console.log(`[Cron] hourly: pushed ${pushed}`);
      return res.json({ mode: "hourly", pushed });
    } catch (e) {
      console.error("[Cron] hourly fatal:", e?.message);
      return res.status(500).json({ error: "cron_failed" });
    }
  }

  let refreshed = 0, failed = 0;
  try {
    // All google_calendar integration docs across users
    const snap = await adminDb.collectionGroup("integrations").limit(500).get();
    const googleDocs = snap.docs.filter(d => d.ref.id === "google_calendar" && d.data()?.refreshToken);

    for (const d of googleDocs) {
      const uid = d.ref.parent.parent?.id;
      if (!uid) continue;
      try {
        const token = await refreshGoogle(uid, d.data());
        if (!token) { failed++; continue; }
        const events = await fetchEvents(token);
        await persist(uid, events);
        await d.ref.set({ lastSyncedAt: Date.now(), itemCount: events.length, lastError: null }, { merge: true });
        refreshed++;
      } catch (e) {
        failed++;
        console.error("[Cron] user sync failed:", e?.message);
      }
    }
    // Morning briefing push — after the refresh so counts are fresh. Non-fatal.
    let pushed = 0;
    try {
      pushed = await sendMorningBriefings();
    } catch (e) {
      console.error("[Cron] morning push pass failed:", e?.message);
    }
    console.log(`[Cron] refreshed ${refreshed}, failed ${failed}, pushed ${pushed}`);
    res.json({ refreshed, failed, pushed });
  } catch (e) {
    console.error("[Cron] fatal:", e?.message);
    res.status(500).json({ error: "cron_failed", refreshed, failed });
  }
}
