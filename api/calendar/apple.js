import { adminDb, applyCors, verifyAuth, decryptSecret } from "../_lib/secure.js";

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
      id:     `apple_${get("UID") || Math.random()}`,
      title:  get("SUMMARY") || "Event",
      date,
      source: "apple",
      color:  "#000000",
      allDay: !dtstart.includes("T"),
    });
  }
  return events;
}

async function getCalendarHomeUrl(authHeader) {
  // Step 1: Get current-user-principal
  const r1 = await fetch("https://caldav.icloud.com/.well-known/caldav", {
    method: "PROPFIND",
    headers: { Authorization: authHeader, "Content-Type": "application/xml", Depth: "0" },
    body: `<?xml version="1.0"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`,
    redirect: "follow",
  });
  const t1 = await r1.text();
  console.log("[Apple] PROPFIND1 status:", r1.status);

  // Extract principal href
  const m1 = t1.match(/<current-user-principal[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>/);
  if (!m1) {
    console.log("[Apple] No principal found (status", r1.status + ")");
    return null;
  }
  const principalUrl = m1[1].startsWith("http") ? m1[1] : `https://caldav.icloud.com${m1[1]}`;

  // Step 2: Get calendar-home-set from principal
  const r2 = await fetch(principalUrl, {
    method: "PROPFIND",
    headers: { Authorization: authHeader, "Content-Type": "application/xml", Depth: "0" },
    body: `<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><prop><c:calendar-home-set/></prop></propfind>`,
  });
  const t2 = await r2.text();
  console.log("[Apple] PROPFIND2 status:", r2.status);

  const m2 = t2.match(/<calendar-home-set[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>/);
  if (!m2) {
    console.log("[Apple] No calendar-home found (status", r2.status + ")");
    return null;
  }
  return m2[1].startsWith("http") ? m2[1] : `https://caldav.icloud.com${m2[1]}`;
}

export default async function handler(req, res) {
  if (applyCors(req, res, "GET, OPTIONS")) return;

  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  try {
    const doc = await adminDb.doc(`users/${uid}/integrations/apple_calendar`).get();
    if (!doc.exists) return res.status(404).json({ error: "Not connected" });

    const { email, password } = doc.data();
    const decoded = decryptSecret(password);
    const authHeader = `Basic ${Buffer.from(`${email}:${decoded}`).toString("base64")}`;

    const homeUrl = await getCalendarHomeUrl(authHeader);
    if (!homeUrl) return res.status(500).json({ error: "Could not discover calendar URL" });

    // Step 3: List calendars
    const r3 = await fetch(homeUrl, {
      method: "PROPFIND",
      headers: { Authorization: authHeader, "Content-Type": "application/xml", Depth: "1" },
      body: `<?xml version="1.0"?><propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><prop><resourcetype/><displayname/><c:supported-calendar-component-set/></prop></propfind>`,
    });
    const t3 = await r3.text();
    console.log("[Apple] PROPFIND3 status:", r3.status);

    // Extract calendar URLs from PROPFIND3
    const calUrls = [];
    const homeBase = homeUrl.replace(/\/+$/, "");
    const hostMatch = homeUrl.match(/^(https?:\/\/[^/]+)/);
    const homeHost = hostMatch ? hostMatch[1] : "https://caldav.icloud.com";

    const responses = t3.split(/<response[\s>]/i).slice(1);
    for (const resp of responses) {
      const hrefMatch = resp.match(/<href[^>]*>([^<]+)<\/href>/i);
      if (!hrefMatch) continue;
      const href = hrefMatch[1].trim();
      const url = href.startsWith("http") ? href : `${homeHost}${href.startsWith("/") ? "" : "/"}${href}`;
      // Skip the home URL itself, only add sub-calendars
      if (url.endsWith("/") && url !== homeUrl && url !== homeBase + "/" && !calUrls.includes(url)) {
        calUrls.push(url);
      }
    }
    console.log("[Apple] Found calendars:", calUrls.length);

    if (calUrls.length === 0) {
      // No sub-calendars found — use home directly
      calUrls.push(homeUrl);
    }

    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    const reportBody = `<?xml version="1.0" encoding="utf-8"?>
<calendar-query xmlns="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:">
  <d:prop><d:getetag/><calendar-data/></d:prop>
  <filter><comp-filter name="VCALENDAR">
    <comp-filter name="VEVENT">
      <time-range start="${start}" end="${end}"/>
    </comp-filter>
  </comp-filter></filter>
</calendar-query>`;

    let allEvents = [];
    for (const calUrl of calUrls.slice(0, 5)) {
      try {
        const r = await fetch(calUrl, {
          method: "REPORT",
          headers: { Authorization: authHeader, "Content-Type": "application/xml", Depth: "1" },
          body: reportBody,
        });
        const xml = await r.text();
        console.log("[Apple] REPORT status:", r.status, "length:", xml.length);
        const icsMatches = xml.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/g) || [];
        const events = icsMatches.flatMap(parseICSEvents).filter(Boolean);
        allEvents = allEvents.concat(events);
      } catch (e) {
        console.error("[Apple] REPORT error:", e.message);
      }
    }

    console.log("[Apple Calendar] returning", allEvents.length, "events");
    res.json({ events: allEvents });
  } catch (e) {
    console.error("[Apple Calendar fetch]", e);
    res.status(500).json({ error: "Failed to fetch events", detail: e.message });
  }
}
