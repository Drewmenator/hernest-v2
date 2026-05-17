import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({ credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  })});
}

const adminDb = getFirestore();

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  try {
    const doc = await adminDb.doc(`users/${uid}/integrations/apple_calendar`).get();
    if (!doc.exists) return res.status(404).json({ error: "Not connected" });

    const { email, password } = doc.data();
    const decoded = Buffer.from(password, "base64").toString("utf-8");
    const auth = Buffer.from(`${email}:${decoded}`).toString("base64");

    const now = new Date();
    const start = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const end = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    const reportRes = await fetch("https://caldav.icloud.com/", {
      method: "REPORT",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/xml",
        Depth: "1",
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<calendar-query xmlns="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:">
  <d:prop><d:getetag/><calendar-data/></d:prop>
  <filter><comp-filter name="VCALENDAR">
    <comp-filter name="VEVENT">
      <time-range start="${start}" end="${end}"/>
    </comp-filter>
  </comp-filter></filter>
</calendar-query>`,
    });

    const xml = await reportRes.text();
    const icsMatches = xml.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/g) || [];
    const events = icsMatches.flatMap(parseICSEvents);

    res.json({ events });
  } catch (e) {
    console.error("[Apple Calendar fetch]", e);
    res.status(500).json({ error: "Failed to fetch events" });
  }
}
