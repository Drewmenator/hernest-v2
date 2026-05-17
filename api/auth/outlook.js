export default function handler(req, res) {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const tenantId = process.env.OUTLOOK_TENANT_ID || "common";
  const redirectUri = "https://hernest-v2.vercel.app/api/auth/outlook/callback";
  const scope = "https://graph.microsoft.com/Calendars.Read offline_access";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state: req.query.uid || "",
  });
  res.redirect(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`);
}
