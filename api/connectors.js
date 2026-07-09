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
import { adminDb, applyCors, verifyAuth, encryptSecret, decryptSecret } from "./_lib/secure.js";

const APP_URL = process.env.APP_URL || "https://hernest-v2.vercel.app";

// ── Signed OAuth state — prevents binding a provider account to someone
//    else's uid (previously state was a raw, unauthenticated uid).
function stateKey() { return process.env.CREDENTIALS_ENCRYPTION_KEY || "missing-key"; }
function signState(provider, uid) {
  const sig = crypto.createHmac("sha256", stateKey()).update(`${provider}:${uid}`).digest("hex").slice(0, 24);
  return `${provider}:${uid}:${sig}`;
}
function verifyState(state) {
  const [provider, uid, sig] = String(state || "").split(":");
  if (!provider || !uid || !sig) return null;
  const expect = crypto.createHmac("sha256", stateKey()).update(`${provider}:${uid}`).digest("hex").slice(0, 24);
  return sig === expect ? { provider, uid } : null;
}

async function writeMeta(uid, doc, meta) {
  try {
    await adminDb.doc(`users/${uid}/integrations/${doc}`).set(meta, { merge: true });
  } catch (e) { console.error("[Connectors] meta write failed:", e?.message); }
}

// ── Google token refresh (shared: calendar + gmail) ────────────────
async function freshGoogleToken(uid, doc) {
  const snap = await adminDb.doc(`users/${uid}/integrations/${doc}`).get();
  if (!snap.exists) return { error: "not_connected" };
  let { accessToken, refreshToken, expiresAt } = snap.data();
  if (Date.now() > (expiresAt || 0) - 60000 && refreshToken) {
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
    if (!refreshed.access_token) {
      console.error("[Connectors] google refresh failed:", r.status);
      return { error: "reauth_required" };
    }
    accessToken = refreshed.access_token;
    expiresAt = Date.now() + (refreshed.expires_in || 3600) * 1000;
    await adminDb.doc(`users/${uid}/integrations/${doc}`).update({ accessToken, expiresAt });
  }
  return { accessToken };
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

  if (provider === "google" || provider === "gmail") {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: "google_not_configured" });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${APP_URL}/api/auth/google/callback`,
      response_type: "code",
      scope: OAUTH[provider].scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      state: signState(provider, uid),
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
      state: signState("outlook", uid),
    });
    return res.json({ url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}` });
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
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
        connectedAt: Date.now(),
      });
      return res.redirect(`${APP_URL}?calendar_connected=${OAUTH[provider].done}`);
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
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
        connectedAt: Date.now(),
      });
      return res.redirect(`${APP_URL}?calendar_connected=outlook`);
    }

    return res.redirect(`${APP_URL}?calendar_error=unknown_provider`);
  } catch (e) {
    console.error("[Connectors] callback error:", e?.message);
    return res.redirect(`${APP_URL}?calendar_error=oauth_failed`);
  }
}

// ═══ SYNC: GOOGLE CALENDAR ══════════════════════════════════════════

async function syncGoogle(req, res, uid) {
  const timezone = req.query.tz || "America/Chicago";
  const tok = await freshGoogleToken(uid, "google_calendar");
  if (tok.error === "not_connected") return res.status(404).json({ error: "Not connected" });
  if (tok.error) {
    await writeMeta(uid, "google_calendar", { lastError: "reauth_required", lastSyncedAt: Date.now() });
    return res.status(401).json({ error: "reauth_required" });
  }
  const headers = { Authorization: `Bearer ${tok.accessToken}` };
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 60 * 86400000).toISOString();

  const listData = await (await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50", { headers })).json();
  const calendars = (listData.items || []).filter(c => c.accessRole !== "freeBusyReader");

  let allEvents = [];
  for (const cal of calendars) {
    try {
      const evData = await (await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=50`,
        { headers }
      )).json();
      if (evData.error) continue;
      allEvents = allEvents.concat((evData.items || []).map(e => ({
        id: `google_${e.id}`,
        title: e.summary || "Event",
        date: e.start?.date || (e.start?.dateTime ? new Date(e.start.dateTime).toLocaleDateString("en-CA", { timeZone: timezone }) : ""),
        time: e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }) : undefined,
        source: "google", color: cal.backgroundColor || "#4285F4",
        allDay: !!e.start?.date, calendar: cal.summary,
      })));
    } catch (e) { console.error("[Connectors] google calendar fetch:", e?.message); }
  }
  const seen = new Set();
  allEvents = allEvents.filter(e => !seen.has(e.id) && seen.add(e.id));
  await writeMeta(uid, "google_calendar", { lastSyncedAt: Date.now(), itemCount: allEvents.length, lastError: null });
  res.json({ events: allEvents });
}

// ═══ SYNC: APPLE (CalDAV) ═══════════════════════════════════════════

function parseICSEvents(icsText) {
  const events = [];
  const blocks = icsText.split("BEGIN:VEVENT");
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const get = (key) => {
      const match = block.match(new RegExp(`${key}[^:]*:([^\\r\\n]+)`));
      return match ? match[1].trim() : "";
    };
    const dtstart = get("DTSTART");
    const date = dtstart.replace(/T.*/, "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    if (!date) continue;
    events.push({
      id: `apple_${get("UID") || Math.random()}`,
      title: get("SUMMARY") || "Event",
      date, source: "apple", color: "#6E6E73",
      allDay: !dtstart.includes("T"),
    });
  }
  return events;
}

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
      allEvents = allEvents.concat(icsMatches.flatMap(parseICSEvents).filter(Boolean));
    } catch (e) { console.error("[Connectors] apple REPORT:", e?.message); }
  }
  await writeMeta(uid, "apple_calendar", { lastSyncedAt: Date.now(), itemCount: allEvents.length, lastError: null });
  res.json({ events: allEvents });
}

// ═══ SYNC: OUTLOOK ══════════════════════════════════════════════════

async function syncOutlook(req, res, uid) {
  const doc = await adminDb.doc(`users/${uid}/integrations/outlook_calendar`).get();
  if (!doc.exists) return res.status(404).json({ error: "Not connected" });
  const { accessToken } = doc.data();
  const now = new Date();
  const data = await (await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${now.toISOString()}&endDateTime=${new Date(now.getTime() + 60 * 86400000).toISOString()}&$orderby=start/dateTime&$top=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )).json();
  const events = (data.value || []).map(e => ({
    id: `outlook_${e.id}`, title: e.subject || "Event",
    date: (e.start?.dateTime || "").split("T")[0],
    source: "work", color: "#0078D4", allDay: e.isAllDay || false,
  }));
  await writeMeta(uid, "outlook_calendar", { lastSyncedAt: Date.now(), itemCount: events.length, lastError: data.error ? "fetch_failed" : null });
  res.json({ events });
}

// ═══ SYNC: GMAIL (read-only scan for receipts / school / travel) ════

const GMAIL_QUERIES = {
  receipt: "newer_than:14d {subject:receipt subject:order subject:invoice subject:\"payment confirmation\"}",
  school: "newer_than:14d {subject:school subject:PTA subject:\"permission slip\" subject:classroom subject:teacher}",
  travel: "newer_than:30d {subject:itinerary subject:booking subject:flight subject:reservation}",
};

async function syncGmail(req, res, uid) {
  const tok = await freshGoogleToken(uid, "gmail");
  if (tok.error === "not_connected") return res.status(404).json({ error: "Not connected" });
  if (tok.error) {
    await writeMeta(uid, "gmail", { lastError: "reauth_required", lastSyncedAt: Date.now() });
    return res.status(401).json({ error: "reauth_required" });
  }
  const headers = { Authorization: `Bearer ${tok.accessToken}` };
  const messages = [];

  for (const [category, q] of Object.entries(GMAIL_QUERIES)) {
    try {
      const list = await (await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=8`,
        { headers }
      )).json();
      for (const m of (list.messages || []).slice(0, 8)) {
        const msg = await (await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers }
        )).json();
        const h = Object.fromEntries((msg.payload?.headers || []).map(x => [x.name, x.value]));
        messages.push({
          id: m.id, category,
          subject: h.Subject || "", from: h.From || "", date: h.Date || "",
          snippet: msg.snippet || "",
        });
      }
    } catch (e) { console.error("[Connectors] gmail query failed:", category, e?.message); }
  }

  await writeMeta(uid, "gmail", { lastSyncedAt: Date.now(), itemCount: messages.length, lastError: null });
  res.json({ messages });
}

// ═══ ROUTER ═════════════════════════════════════════════════════════

export default async function handler(req, res) {
  const { provider, action } = req.query;

  // OAuth provider redirects (no Origin header, no auth possible)
  if (action === "callback") return handleCallback(req, res);

  if (applyCors(req, res, "GET, POST, OPTIONS")) return;

  if (action === "auth") return handleAuth(req, res, provider);

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
    } catch (e) {
      console.error("[Connectors] sync error:", provider, e?.message);
      return res.status(500).json({ error: "sync_failed" });
    }
  }

  return res.status(400).json({ error: "unknown_route" });
}
