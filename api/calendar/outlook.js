import { adminDb, applyCors, verifyAuth } from "../_lib/secure.js";

export default async function handler(req, res) {
  if (applyCors(req, res, "GET, OPTIONS")) return;

  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

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
