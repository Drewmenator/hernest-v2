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
  const { uid } = req.query;
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

    const eventsRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await eventsRes.json();
    if (data.error) return res.status(401).json({ error: data.error.message });

    const events = (data.items || []).map(e => ({
      id:     `google_${e.id}`,
      title:  e.summary || "Event",
      date:   (e.start?.date || e.start?.dateTime || "").split("T")[0],
      time:   e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : undefined,
      source: "google",
      color:  "#4285F4",
      allDay: !!e.start?.date,
    }));

    res.json({ events });
  } catch (e) {
    console.error("[Google Calendar fetch]", e);
    res.status(500).json({ error: "Failed to fetch events" });
  }
}
