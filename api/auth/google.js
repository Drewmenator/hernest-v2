module.exports = function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: "GOOGLE_CLIENT_ID not configured" });

  const redirectUri = "https://hernest-v2.vercel.app/api/auth/google/callback";
  const scope = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
  ].join(" ");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    state: req.query.uid || "",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
