// ─── Overnight sync cron (Wave 1 follow-on) ────────────────────────
// Vercel Cron hits this daily (vercel.json → crons). Refreshes every
// user's Google Calendar server-side and persists events to their
// calendar_synced doc, so the morning briefing is fresh BEFORE the app is
// opened. Also clears the cached briefing so it regenerates on next open.
//
// Auth: Vercel adds `Authorization: Bearer $CRON_SECRET` when CRON_SECRET
// is set. We reject anything else.
import { adminDb } from "./_lib/secure.js";

async function refreshGoogle(uid, data) {
  let { accessToken, refreshToken, expiresAt } = data;
  if (!refreshToken) return null;
  if (Date.now() > (expiresAt || 0) - 60000) {
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
    expiresAt = Date.now() + (refreshed.expires_in || 3600) * 1000;
    await adminDb.doc(`users/${uid}/integrations/google_calendar`).update({ accessToken, expiresAt });
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

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers["authorization"] !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
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
    console.log(`[Cron] refreshed ${refreshed}, failed ${failed}`);
    res.json({ refreshed, failed });
  } catch (e) {
    console.error("[Cron] fatal:", e?.message);
    res.status(500).json({ error: "cron_failed", refreshed, failed });
  }
}
