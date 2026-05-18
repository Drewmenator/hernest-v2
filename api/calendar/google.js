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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { uid, tz } = req.query;
  const timezone = tz || "America/Chicago";
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  try {
    const doc = await adminDb.doc(`users/${uid}/integrations/google_calendar`).get();
    if (!doc.exists) return res.status(404).json({ error: "Not connected" });

    let { accessToken, refreshToken, expiresAt } = doc.data();

    // Refresh token if expired
    if (Date.now() > expiresAt - 60000 && refreshToken) {
      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type:    "refresh_token",
        }),
      });
      const refreshed = await refreshRes.json();
      if (refreshed.access_token) {
        accessToken = refreshed.access_token;
        expiresAt = Date.now() + (refreshed.expires_in || 3600) * 1000;
        await adminDb.doc(`users/${uid}/integrations/google_calendar`).update({ accessToken, expiresAt });
      }
    }

    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const headers = { Authorization: `Bearer ${accessToken}` };

    // Step 1: Get all calendars
    const listRes = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50",
      { headers }
    );
    const listData = await listRes.json();
    const calendars = (listData.items || []).filter(c => c.accessRole !== "freeBusyReader");
    console.log("[Google] Found calendars:", calendars.map(c => c.summary));

    // Step 2: Fetch events from each calendar
    let allEvents = [];
    for (const cal of calendars) {
      try {
        const evRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=50`,
          { headers }
        );
        const evData = await evRes.json();
        if (evData.error) continue;
        const events = (evData.items || []).map(e => ({
          id:     `google_${e.id}`,
          title:  e.summary || "Event",
          date:   e.start?.date || (e.start?.dateTime ? new Date(e.start.dateTime).toLocaleDateString("en-CA", { timeZone: timezone }) : ""),
          time:   e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }) : undefined,
          source: "google",
          color:  cal.backgroundColor || "#4285F4",
          allDay: !!e.start?.date,
          calendar: cal.summary,
        }));
        allEvents = allEvents.concat(events);
      } catch (e) {
        console.error("[Google] Error fetching calendar:", cal.summary, e.message);
      }
    }

    // Deduplicate by id
    const seen = new Set();
    allEvents = allEvents.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    console.log("[Google Calendar] returning", allEvents.length, "events from", calendars.length, "calendars");
    res.json({ events: allEvents });
  } catch (e) {
    console.error("[Google Calendar fetch]", e);
    res.status(500).json({ error: "Failed to fetch events" });
  }
}
