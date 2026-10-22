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
import { freshGoogleToken } from "./_lib/googleToken.js";
import { scanFamilyMail } from "./_lib/familyMail.js";
import { fetchGoogleEvents, mergeSyncedEvents, combineFetches } from "./_lib/calendarEvents.js";

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

// calendar_synced is a household-scoped collection: partners' data lives
// under the primary's uid. Resolve the owner before persisting.
async function ownerFor(uid) {
  try {
    const link = await adminDb.doc(`users/${uid}/data/household_link`).get();
    const primaryUid = link.exists ? link.data()?.primaryUid : null;
    return primaryUid || uid;
  } catch { return uid; }
}

// A complete fetch REPLACES the household's Google events from today (local)
// to the end of the fetched window, so events cancelled or deleted in Google
// disappear; past events are kept. An incomplete fetch (any member's calendar
// errored, was cut off, or couldn't be refreshed) only merges by id — a
// failed fetch never wipes anything.
async function persist(owner, { events, complete, from, to }) {
  if (!events.length && !complete) return;
  const existing = ((await adminDb.doc(`users/${owner}/data/calendar_synced`).get()).data()?.events) || [];
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const merged = mergeSyncedEvents(existing, events, {
    replace: complete ? { source: "google", from, to } : null,
    cutoff,
  });
  await adminDb.doc(`users/${owner}/data/calendar_synced`).set({ events: merged }, { merge: true });
}

// ── Family email scan ──────────────────────────────────────────────
// Every connected Gmail, once a night, before the morning push so its line
// can say what came in. One AI call per mailbox at most, and none when no new
// family mail arrived (each email is read once). Counts against the
// household's pilot AI limit. An expired Google sign-in (weekly while the
// Google app is in Testing) is flagged so the app shows "Reconnect Gmail".
async function scanAllGmail(integrationDocs, zones, now = new Date()) {
  let scanned = 0, needReconnect = 0;
  for (const d of integrationDocs.filter(x => x.ref.id === "gmail")) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    try {
      const tok = await freshGoogleToken(uid, "gmail");
      if (tok.error) {
        if (tok.error !== "not_connected") {
          needReconnect++;
          await d.ref.set({ lastError: "reauth_required", lastSyncedAt: Date.now() }, { merge: true });
        }
        continue;
      }
      const tz = zones.get(uid);
      const today = (tz && localParts(now, tz)?.date) || now.toISOString().slice(0, 10);
      const r = await scanFamilyMail(adminDb, { uid, accessToken: tok.accessToken, today });
      await d.ref.set({ lastSyncedAt: Date.now(), itemCount: r.scanned, lastError: r.error || null }, { merge: true });
      scanned++;
    } catch (e) {
      if (e?.reauth) {
        needReconnect++;
        await d.ref.set({ lastError: "reauth_required", lastSyncedAt: Date.now() }, { merge: true }).catch(() => {});
      } else console.error("[Cron] gmail scan failed:", e?.message);
    }
  }
  return { scanned, needReconnect };
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
    // Every google_calendar doc, grouped by household: calendar_synced is shared,
    // so one member's sync may only replace Google events when EVERY connected
    // member's calendar was fetched in full (else a partner's events vanish).
    const googleDocs = snap.docs.filter(d => d.ref.id === "google_calendar");
    // Each user's zone (from their devices) so dates and times are on their
    // clock. No zone → Google's own offset is read literally.
    let zones = new Map();
    try { zones = await deviceZonesByUser(); } catch (e) { console.error("[Cron] device zones failed:", e?.message); }

    const households = new Map();
    for (const d of googleDocs) {
      const uid = d.ref.parent.parent?.id;
      if (!uid) continue;
      const owner = await ownerFor(uid);
      if (!households.has(owner)) households.set(owner, []);
      households.get(owner).push({ uid, d });
    }

    for (const [owner, members] of households) {
      const parts = [];
      let allFetched = true;
      for (const { uid, d } of members) {
        if (!d.data()?.refreshToken) { allFetched = false; continue; }
        try {
          const token = await refreshGoogle(uid, d.data());
          if (!token) { failed++; allFetched = false; continue; }
          const fetched = await fetchGoogleEvents(token, { tz: zones.get(uid) });
          parts.push(fetched);
          await d.ref.set({ lastSyncedAt: Date.now(), itemCount: fetched.events.length, lastError: null }, { merge: true });
          refreshed++;
        } catch (e) {
          failed++;
          allFetched = false;
          console.error("[Cron] user sync failed:", e?.message);
        }
      }
      if (!parts.length) continue;
      try {
        await persist(owner, combineFetches(parts, allFetched));
      } catch (e) {
        console.error("[Cron] persist failed:", e?.message);
      }
    }
    // Family email → calendar + "From your email". Non-fatal.
    let mail = { scanned: 0, needReconnect: 0 };
    try {
      mail = await scanAllGmail(snap.docs, zones.size ? zones : await deviceZonesByUser());
    } catch (e) {
      console.error("[Cron] gmail pass failed:", e?.message);
    }
    // Morning briefing push — after the refresh so counts are fresh. Non-fatal.
    let pushed = 0;
    try {
      pushed = await sendMorningBriefings();
    } catch (e) {
      console.error("[Cron] morning push pass failed:", e?.message);
    }
    console.log(`[Cron] refreshed ${refreshed}, failed ${failed}, gmail ${mail.scanned} (${mail.needReconnect} need reconnect), pushed ${pushed}`);
    res.json({ refreshed, failed, pushed, gmail: mail });
  } catch (e) {
    console.error("[Cron] fatal:", e?.message);
    res.status(500).json({ error: "cron_failed", refreshed, failed });
  }
}
