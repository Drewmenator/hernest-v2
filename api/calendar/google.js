import { adminDb, applyCors, verifyAuth } from "../_lib/secure.js";

export default async function handler(req, res) {
  if (applyCors(req, res, "GET, OPTIONS")) return;

  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const { tz } = req.query;
  const timezone = tz || "America/Chicago";

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
      const refreshed = await refreshRes.json().catch(() => ({}));
      if (refreshed.access_token) {
        accessToken = refreshed.access_token;
        expiresAt = Date.now() + (refreshed.expires_in || 3600) * 1000;
        await adminDb.doc(`users/${uid}/integrations/google_calendar`).update({ accessToken, expiresAt });
      } else {
        console.error("[Google] token refresh failed:", refreshRes.status, refreshed.error || "");
        return res.status(401).json({ error: "reauth_required", detail: "Google token refresh failed — reconnect your calendar" });
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
    console.log("[Google] Found calendars:", calendars.length);

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
        console.error("[Google] Error fetching a calendar:", e.message);
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
