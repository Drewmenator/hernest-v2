// ─── Unified connector hub ─────────────────────────────────────────
// One function for every external-data provider (Vercel Hobby caps
// deployments at 12 functions — this replaces 7 of them).
//
// Routes (via vercel.json rewrites, old URLs keep working):
//   GET  /api/auth/{google|gmail|outlook}        → action=auth      (Bearer required; returns {url})
//   GET  /api/auth/google/callback               → action=callback  (provider read from signed state)
//   GET  /api/auth/outlook/callback              → action=callback
//   POST /api/auth/apple                         → provider=apple&action=auth (CalDAV credential check)
//   GET  /api/calendar/{google|apple|outlook}    → action=sync      (Bearer required)
//   GET  /api/connectors?provider=gmail&action=sync
//
// Every sync writes health metadata (lastSyncedAt, itemCount, lastError)
// to users/{uid}/integrations/{doc} so the app can show freshness.
import crypto from "crypto";
import { adminDb, applyCors, verifyAuth, encryptSecret, decryptSecret, openToken, isSealed } from "./_lib/secure.js";
import { pickMainSleep, resolveSleepScore, sleepHours, buildOuraHistory, ouraRange } from "./_lib/oura.js";
import { freshGoogleToken } from "./_lib/googleToken.js";
import { scanFamilyMail } from "./_lib/familyMail.js";
import { localParts } from "./_lib/localTime.js";
import { fetchGoogleEvents, mapOutlookEvent, outlookHeaders, parseICSEvents, zoneOr, zonedMidnight, localDate } from "./_lib/calendarEvents.js";

const APP_URL = process.env.APP_URL || "https://hernest-v2.vercel.app";

// ── Signed OAuth state — prevents binding a provider account to someone
//    else's uid (previously state was a raw, unauthenticated uid).
function stateKey() {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!key) throw new Error("CREDENTIALS_ENCRYPTION_KEY not set");
  return key;
}
function signState(provider, uid, native) {
  const n = native ? "1" : "0";
  const sig = crypto.createHmac("sha256", stateKey()).update(`${provider}:${uid}:${n}`).digest("hex").slice(0, 24);
  return `${provider}:${uid}:${n}:${sig}`;
}
function verifyState(state) {
  const [provider, uid, n, sig] = String(state || "").split(":");
  if (!provider || !uid || n === undefined || !sig) return null;
  const expect = crypto.createHmac("sha256", stateKey()).update(`${provider}:${uid}:${n}`).digest("hex").slice(0, 24);
  return sig === expect ? { provider, uid, native: n === "1" } : null;
}

async function writeMeta(uid, doc, meta) {
  try {
    await adminDb.doc(`users/${uid}/integrations/${doc}`).set(meta, { merge: true });
  } catch (e) { console.error("[Connectors] meta write failed:", e?.message); }
}

// ═══ AUTH ═══════════════════════════════════════════════════════════

const OAUTH = {
  google: {
    scopes: ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events.readonly"],
    doc: "google_calendar", done: "google",
  },
  gmail: {
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    doc: "gmail", done: "gmail",
  },
};

async function handleAuth(req, res, provider) {
  if (provider === "apple") return handleAppleAuth(req, res);

  // Bearer-authenticated: client fetches this, then navigates to the returned URL.
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  // Native shell opens this in an in-app browser; the callback must return to a
  // static "connected" page (not the SPA, which would demand its own login).
  const native = req.query?.native === "1";

  if (provider === "google" || provider === "gmail") {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: "google_not_configured" });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${APP_URL}/api/auth/google/callback`,
      response_type: "code",
      scope: OAUTH[provider].scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      state: signState(provider, uid, native),
    });
    return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }

  if (provider === "outlook") {
    if (!process.env.OUTLOOK_CLIENT_ID) return res.status(503).json({ error: "outlook_not_configured" });
    const tenant = process.env.OUTLOOK_TENANT_ID || "common";
    const params = new URLSearchParams({
      client_id: process.env.OUTLOOK_CLIENT_ID,
      redirect_uri: `${APP_URL}/api/auth/outlook/callback`,
      response_type: "code",
      scope: "https://graph.microsoft.com/Calendars.Read offline_access",
      state: signState("outlook", uid, native),
    });
    return res.json({ url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}` });
  }

  if (provider === "oura") {
    if (!process.env.OURA_CLIENT_ID) return res.status(503).json({ error: "oura_not_configured" });
    const params = new URLSearchParams({
      client_id: process.env.OURA_CLIENT_ID,
      redirect_uri: `${APP_URL}/api/auth/oura/callback`,
      response_type: "code",
      scope: "daily personal",
      state: signState("oura", uid, native),
    });
    return res.json({ url: `https://cloud.ouraring.com/oauth/authorize?${params}` });
  }

  return res.status(400).json({ error: "unknown_provider" });
}

async function handleAppleAuth(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing credentials" });

  const testRes = await fetch("https://caldav.icloud.com/", {
    method: "PROPFIND",
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString("base64")}`,
      "Content-Type": "application/xml", Depth: "0",
    },
    body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`,
  }).catch(() => null);

  if (!testRes || (!testRes.ok && testRes.status !== 207)) {
    return res.status(401).json({ error: "Invalid credentials — check your app-specific password" });
  }
  await adminDb.doc(`users/${uid}/integrations/apple_calendar`).set({
    email, password: encryptSecret(password), connectedAt: Date.now(),
  });
  res.json({ success: true });
}

async function handleCallback(req, res) {
  const { code, state } = req.query;
  const parsed = verifyState(state);
  const isNative = parsed?.native;
  // Native opened this in an in-app browser sheet → land on a static success
  // page that says "return to HerNest" instead of the SPA (which would show a
  // login screen). Web keeps returning to the SPA so its toast fires.
  const okUrl = (name) => isNative ? `${APP_URL}/connected.html?provider=${name}` : `${APP_URL}?calendar_connected=${name}`;
  const errUrl = (e) => isNative ? `${APP_URL}/connected.html?error=${e}` : `${APP_URL}?calendar_error=${e}`;

  if (!code || !parsed) return res.redirect(`${APP_URL}?calendar_error=missing_params`);
  const { provider, uid } = parsed;

  try {
    if (provider === "google" || provider === "gmail") {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${APP_URL}/api/auth/google/callback`,
          grant_type: "authorization_code",
        }).toString(),
      });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) throw new Error("no access token");
      await adminDb.doc(`users/${uid}/integrations/${OAUTH[provider].doc}`).set({
        accessToken: encryptSecret(tokens.access_token),
        refreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
        connected: true,
        expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
        connectedAt: Date.now(),
      });
      return res.redirect(okUrl(OAUTH[provider].done));
    }

    if (provider === "outlook") {
      const tenant = process.env.OUTLOOK_TENANT_ID || "common";
      const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.OUTLOOK_CLIENT_ID,
          client_secret: process.env.OUTLOOK_CLIENT_SECRET,
          redirect_uri: `${APP_URL}/api/auth/outlook/callback`,
          grant_type: "authorization_code",
          scope: "https://graph.microsoft.com/Calendars.Read offline_access",
        }).toString(),
      });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) throw new Error("no access token");
      await adminDb.doc(`users/${uid}/integrations/outlook_calendar`).set({
        accessToken: encryptSecret(tokens.access_token),
        refreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
        connected: true,
        expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
        connectedAt: Date.now(),
      });
      return res.redirect(okUrl("outlook"));
    }

    if (provider === "oura") {
      const tokenRes = await fetch("https://api.ouraring.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${APP_URL}/api/auth/oura/callback`,
          client_id: process.env.OURA_CLIENT_ID,
          client_secret: process.env.OURA_CLIENT_SECRET,
        }).toString(),
      });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) throw new Error("no access token");
      await adminDb.doc(`users/${uid}/integrations/oura`).set({
        accessToken: encryptSecret(tokens.access_token),
        refreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
        expiresAt: Date.now() + (tokens.expires_in || 86400) * 1000,
        connectedAt: Date.now(),
      });
      return res.redirect(okUrl("oura"));
    }

    return res.redirect(errUrl("unknown_provider"));
  } catch (e) {
    console.error("[Connectors] callback error:", e?.message);
    return res.redirect(errUrl("oauth_failed"));
  }
}

// ═══ SYNC: GOOGLE CALENDAR ══════════════════════════════════════════

async function syncGoogle(req, res, uid) {
  const timezone = zoneOr(req.query.tz);
  const tok = await freshGoogleToken(uid, "google_calendar");
  if (tok.error === "not_connected") return res.status(404).json({ error: "Not connected" });
  if (tok.error) {
    await writeMeta(uid, "google_calendar", { lastError: "reauth_required", lastSyncedAt: Date.now() });
    return res.status(401).json({ error: "reauth_required" });
  }
  // From local midnight (not "now"), so events that already started today
  // are refreshed too. Times are HH:MM on the user's clock.
  const { events: allEvents, complete, from, to } = await fetchGoogleEvents(tok.accessToken, { tz: timezone });
  await writeMeta(uid, "google_calendar", { lastSyncedAt: Date.now(), itemCount: allEvents.length, lastError: null });
  // complete + range let the client replace this source's events in [from, to)
  // instead of merging, so cancelled events disappear.
  res.json({ events: allEvents, complete, range: { from, to } });
}

// ═══ SYNC: APPLE (CalDAV) ═══════════════════════════════════════════

async function getCalendarHomeUrl(authHeader) {
  const r1 = await fetch("https://caldav.icloud.com/.well-known/caldav", {
    method: "PROPFIND",
    headers: { Authorization: authHeader, "Content-Type": "application/xml", Depth: "0" },
    body: `<?xml version="1.0"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`,
    redirect: "follow",
  });
  const t1 = await r1.text();
  const m1 = t1.match(/<current-user-principal[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>/);
  if (!m1) return null;
  const principalUrl = m1[1].startsWith("http") ? m1[1] : `https://caldav.icloud.com${m1[1]}`;
  const r2 = await fetch(principalUrl, {
    method: "PROPFIND",
    headers: { Authorization: authHeader, "Content-Type": "application/xml", Depth: "0" },
    body: `<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><prop><c:calendar-home-set/></prop></propfind>`,
  });
  const t2 = await r2.text();
  const m2 = t2.match(/<calendar-home-set[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>/);
  if (!m2) return null;
  return m2[1].startsWith("http") ? m2[1] : `https://caldav.icloud.com${m2[1]}`;
}

async function syncApple(req, res, uid) {
  const tz = zoneOr(req.query.tz);
  const doc = await adminDb.doc(`users/${uid}/integrations/apple_calendar`).get();
  if (!doc.exists) return res.status(404).json({ error: "Not connected" });
  const { email, password } = doc.data();
  const authHeader = `Basic ${Buffer.from(`${email}:${decryptSecret(password)}`).toString("base64")}`;

  const homeUrl = await getCalendarHomeUrl(authHeader);
  if (!homeUrl) {
    await writeMeta(uid, "apple_calendar", { lastError: "discovery_failed", lastSyncedAt: Date.now() });
    return res.status(500).json({ error: "Could not discover calendar URL" });
  }

  const r3 = await fetch(homeUrl, {
    method: "PROPFIND",
    headers: { Authorization: authHeader, "Content-Type": "application/xml", Depth: "1" },
    body: `<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><prop><resourcetype/><displayname/><c:supported-calendar-component-set/></prop></propfind>`,
  });
  const t3 = await r3.text();
  const calUrls = [];
  const homeBase = homeUrl.replace(/\/+$/, "");
  const hostMatch = homeUrl.match(/^(https?:\/\/[^/]+)/);
  const homeHost = hostMatch ? hostMatch[1] : "https://caldav.icloud.com";
  for (const resp of t3.split(/<response[\s>]/i).slice(1)) {
    const hrefMatch = resp.match(/<href[^>]*>([^<]+)<\/href>/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1].trim();
    const url = href.startsWith("http") ? href : `${homeHost}${href.startsWith("/") ? "" : "/"}${href}`;
    if (url.endsWith("/") && url !== homeUrl && url !== homeBase + "/" && !calUrls.includes(url)) calUrls.push(url);
  }
  if (calUrls.length === 0) calUrls.push(homeUrl);

  const now = new Date();
  const start = new Date(now.getTime() - 30 * 86400000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const end = new Date(now.getTime() + 90 * 86400000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const reportBody = `<?xml version="1.0" encoding="utf-8"?>
<calendar-query xmlns="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:">
  <d:prop><d:getetag/><calendar-data/></d:prop>
  <filter><comp-filter name="VCALENDAR"><comp-filter name="VEVENT"><time-range start="${start}" end="${end}"/></comp-filter></comp-filter></filter>
</calendar-query>`;

  let allEvents = [];
  for (const calUrl of calUrls.slice(0, 5)) {
    try {
      const r = await fetch(calUrl, { method: "REPORT", headers: { Authorization: authHeader, "Content-Type": "application/xml", Depth: "1" }, body: reportBody });
      const xml = await r.text();
      const icsMatches = xml.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/g) || [];
      allEvents = allEvents.concat(icsMatches.flatMap(ics => parseICSEvents(ics, tz)).filter(Boolean));
    } catch (e) { console.error("[Connectors] apple REPORT:", e?.message); }
  }
  await writeMeta(uid, "apple_calendar", { lastSyncedAt: Date.now(), itemCount: allEvents.length, lastError: null });
  res.json({ events: allEvents });
}

// ═══ SYNC: OUTLOOK ══════════════════════════════════════════════════

async function syncOutlook(req, res, uid) {
  const doc = await adminDb.doc(`users/${uid}/integrations/outlook_calendar`).get();
  if (!doc.exists) return res.status(404).json({ error: "Not connected" });
  const stored = doc.data();
  const accessToken = openToken(stored.accessToken);
  if (!isSealed(stored.accessToken)) await sealLegacyTokens(uid, "outlook_calendar", stored);
  const tz = zoneOr(req.query.tz);
  const now = new Date();
  // From local midnight so today's earlier events are refreshed; Prefer header
  // makes Graph answer in the user's zone instead of UTC.
  const startIso = zonedMidnight(localDate(now, tz), tz).toISOString();
  const data = await (await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(new Date(now.getTime() + 60 * 86400000).toISOString())}&$orderby=start/dateTime&$top=50`,
    { headers: outlookHeaders(accessToken, tz) }
  )).json();
  const events = (data.value || []).map(e => mapOutlookEvent(e, tz));
  await writeMeta(uid, "outlook_calendar", { lastSyncedAt: Date.now(), itemCount: events.length, lastError: data.error ? "fetch_failed" : null });
  res.json({ events });
}

// ═══ SYNC: OURA (sleep / readiness / activity → Thrive) ═════════════

async function freshOuraToken(uid) {
  const snap = await adminDb.doc(`users/${uid}/integrations/oura`).get();
  if (!snap.exists) return { error: "not_connected" };
  let { accessToken, refreshToken, expiresAt } = snap.data();
  if (Date.now() > (expiresAt || 0) - 60000 && refreshToken) {
    const r = await fetch("https://api.ouraring.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptSecret(refreshToken),
        client_id: process.env.OURA_CLIENT_ID,
        client_secret: process.env.OURA_CLIENT_SECRET,
      }),
    });
    const refreshed = await r.json().catch(() => ({}));
    if (!refreshed.access_token) return { error: "reauth_required" };
    accessToken = encryptSecret(refreshed.access_token);
    expiresAt = Date.now() + (refreshed.expires_in || 86400) * 1000;
    await adminDb.doc(`users/${uid}/integrations/oura`).update({
      accessToken,
      refreshToken: refreshed.refresh_token ? encryptSecret(refreshed.refresh_token) : refreshToken,
      expiresAt,
    });
  }
  return { accessToken: decryptSecret(accessToken) };
}

async function syncOura(req, res, uid) {
  const tok = await freshOuraToken(uid);
  if (tok.error === "not_connected") return res.status(404).json({ error: "Not connected" });
  if (tok.error) {
    await writeMeta(uid, "oura", { lastError: "reauth_required", lastSyncedAt: Date.now() });
    return res.status(401).json({ error: "reauth_required" });
  }
  const headers = { Authorization: `Bearer ${tok.accessToken}` };
  // 14 days for the trends, through tomorrow so last night is included.
  // today is the user's local date when the app sends ?tz= (fallback for health.date).
  const { start, end, today } = ouraRange(new Date(), 14, req.query?.tz);
  const q = `start_date=${start}&end_date=${end}`;

  const [sleep, dailySleep, readiness, activity, stress] = await Promise.all([
    fetch(`https://api.ouraring.com/v2/usercollection/sleep?${q}`, { headers }).then(r => r.json()).catch(() => ({})),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?${q}`, { headers }).then(r => r.json()).catch(() => ({})),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?${q}`, { headers }).then(r => r.json()).catch(() => ({})),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?${q}`, { headers }).then(r => r.json()).catch(() => ({})),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_stress?${q}`, { headers }).then(r => r.json()).catch(() => ({})),
  ]);

  const newest = (arr) => (arr || []).sort((a, b) => (b.day || "").localeCompare(a.day || ""))[0];
  // Main night's sleep — longest long_sleep period, not the first fragment.
  const latestSleep = pickMainSleep(sleep.data);
  const latestReadiness = newest(readiness.data);
  const latestActivity = newest(activity.data);
  const latestStress = newest(stress.data);

  const health = {
    date: latestSleep?.day || today,
    lastSleepHours: sleepHours(latestSleep),
    // Score is on /daily_sleep, not /sleep — matched to the night's day.
    sleepScore: resolveSleepScore(dailySleep.data, latestSleep?.day),
    readinessScore: latestReadiness?.score ?? null,
    steps: latestActivity?.steps ?? null,
    // Tier 1: recovery + stress signals
    avgHrv: latestSleep?.average_hrv ?? null,
    restingHr: latestSleep?.lowest_heart_rate ?? null,
    readinessContributors: latestReadiness?.contributors ?? null,
    stressDay: latestStress?.day_summary ?? null,          // restored | normal | stressful
    stressHighMins: latestStress?.stress_high != null ? Math.round(latestStress.stress_high / 60) : null,
    recoveryHighMins: latestStress?.recovery_high != null ? Math.round(latestStress.recovery_high / 60) : null,
    stressDate: latestStress?.day ?? null,
    // Tier 2: richer activity
    activeCalories: latestActivity?.active_calories ?? null,
    sedentaryMins: latestActivity?.sedentary_time != null ? Math.round(latestActivity.sedentary_time / 60) : null,
    activityScore: latestActivity?.score ?? null,
    // 7-day trends for the dashboard (keep last 14, screen shows 7)
    history: buildOuraHistory(sleep.data, dailySleep.data, readiness.data, activity.data, stress.data).slice(-14),
    lastSyncedAt: Date.now(),
    lastError: null,
  };
  await writeMeta(uid, "oura", health);
  res.json({ health });
}

// ═══ SYNC: GMAIL ("Scan now": family email → calendar + tasks) ════
// The scan itself lives in _lib/familyMail.js (the nightly cron runs it too).

async function syncGmail(req, res, uid) {
  const tok = await freshGoogleToken(uid, "gmail");
  if (tok.error === "not_connected") return res.status(404).json({ error: "Not connected" });
  if (tok.error) {
    await writeMeta(uid, "gmail", { lastError: "reauth_required", lastSyncedAt: Date.now() });
    return res.status(401).json({ error: "reauth_required" });
  }
  const tz = String(req.query?.tz || "");
  const today = (tz && localParts(new Date(), tz)?.date) || new Date().toISOString().slice(0, 10);
  try {
    const r = await scanFamilyMail(adminDb, { uid, accessToken: tok.accessToken, today });
    if (r.error === "daily_limit_reached" || r.error === "burst_limit_reached") return res.status(429).json(r);
    await writeMeta(uid, "gmail", { lastSyncedAt: Date.now(), itemCount: r.scanned, lastError: r.error || null });
    return res.json(r);
  } catch (e) {
    if (e?.reauth) {
      await writeMeta(uid, "gmail", { lastError: "reauth_required", lastSyncedAt: Date.now() });
      return res.status(401).json({ error: "reauth_required" });
    }
    console.error("[Connectors] gmail scan failed:", e?.message);
    return res.status(500).json({ error: "scan_failed" });
  }
}

// ═══ DISCONNECT ═════════════════════════════════════════════════════
// Removes a connected service: asks the provider to cancel HerNest's access
// (best effort), then deletes the stored sign-in and synced data, so the next
// Connect starts fresh. Apple Health on the iPhone is handled in the app.
export const DISCONNECT_DOCS = { google: "google_calendar", gmail: "gmail", outlook: "outlook_calendar", oura: "oura" };

export async function revokeAtProvider(provider, stored, fetchImpl = fetch) {
  const token = openToken(stored?.refreshToken) || openToken(stored?.accessToken);
  if (!token) return false;
  try {
    if (provider === "google" || provider === "gmail") {
      const r = await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      return r.ok;
    }
    if (provider === "oura") {
      const access = openToken(stored?.accessToken);
      if (!access) return false;
      const r = await fetchImpl(`https://api.ouraring.com/oauth/revoke?access_token=${encodeURIComponent(access)}`, { method: "POST" });
      return r.ok;
    }
  } catch (e) {
    console.error("[Connectors] revoke failed:", provider, e?.message);
  }
  return false; // Outlook: no simple revoke; deleting our copy is enough
}

async function handleDisconnect(req, res, provider) {
  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });
  const docName = DISCONNECT_DOCS[provider];
  if (!docName) return res.status(400).json({ error: "unknown_provider" });
  try {
    const ref = adminDb.doc(`users/${uid}/integrations/${docName}`);
    const snap = await ref.get();
    const revoked = snap.exists ? await revokeAtProvider(provider, snap.data()) : false;
    await ref.delete();
    return res.json({ ok: true, revoked });
  } catch (e) {
    console.error("[Connectors] disconnect failed:", provider, e?.message);
    return res.status(500).json({ error: "disconnect_failed" });
  }
}

// ═══ ROUTER ═════════════════════════════════════════════════════════

export default async function handler(req, res) {
  const { provider, action } = req.query;

  // OAuth provider redirects (no Origin header, no auth possible)
  if (action === "callback") return handleCallback(req, res);

  if (applyCors(req, res, "GET, POST, OPTIONS")) return;

  if (action === "auth") return handleAuth(req, res, provider);

  if (action === "disconnect") {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    return handleDisconnect(req, res, provider);
  }

  if (action === "health_token") {
    const uid = await verifyAuth(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    try {
      const existing = await adminDb.doc(`users/${uid}/integrations/apple_health`).get();
      let token = existing.exists ? existing.data()?.token : null;
      if (!token) {
        token = crypto.randomBytes(24).toString("hex");
        await adminDb.doc(`health_tokens/${token}`).set({ uid, createdAt: Date.now() });
        await adminDb.doc(`users/${uid}/integrations/apple_health`).set({ token, connectedAt: Date.now() }, { merge: true });
      }
      return res.json({ token, endpoint: `${APP_URL}/api/health-ingest` });
    } catch (e) {
      console.error("[Connectors] health_token error:", e?.message);
      return res.status(500).json({ error: "token_failed" });
    }
  }

  if (action === "sync") {
    const uid = await verifyAuth(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    try {
      if (provider === "google") return await syncGoogle(req, res, uid);
      if (provider === "apple") return await syncApple(req, res, uid);
      if (provider === "outlook") return await syncOutlook(req, res, uid);
      if (provider === "gmail") return await syncGmail(req, res, uid);
      if (provider === "oura") return await syncOura(req, res, uid);
    } catch (e) {
      console.error("[Connectors] sync error:", provider, e?.message);
      return res.status(500).json({ error: "sync_failed" });
    }
  }

  return res.status(400).json({ error: "unknown_route" });
}
