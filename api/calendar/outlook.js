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
    const doc = await adminDb.doc(`users/${uid}/integrations/outlook_calendar`).get();
    if (!doc.exists) return res.status(404).json({ error: "Not connected" });

    const { accessToken } = doc.data();
    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();

    const eventsRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${timeMin}&endDateTime=${timeMax}&$orderby=start/dateTime&$top=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await eventsRes.json();

    const events = (data.value || []).map(e => ({
      id:     `outlook_${e.id}`,
      title:  e.subject || "Event",
      date:   (e.start?.dateTime || "").split("T")[0],
      source: "work",
      color:  "#0078D4",
      allDay: e.isAllDay || false,
    }));

    res.json({ events });
  } catch (e) {
    console.error("[Outlook Calendar fetch]", e);
    res.status(500).json({ error: "Failed to fetch events" });
  }
}
