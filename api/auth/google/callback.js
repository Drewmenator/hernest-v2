import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export default async function handler(req, res) {
  const { code, state: uid } = req.query;
  if (!code || !uid) return res.redirect("https://hernest-v2.vercel.app?calendar_error=missing_params");

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  "https://hernest-v2.vercel.app/api/auth/google/callback",
        grant_type:    "authorization_code",
      }).toString(),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("No access token: " + JSON.stringify(tokens));

    await admin.firestore().doc(`users/${uid}/integrations/google_calendar`).set({
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresAt:    Date.now() + (tokens.expires_in || 3600) * 1000,
      connectedAt:  Date.now(),
    });

    res.redirect("https://hernest-v2.vercel.app?calendar_connected=google");
  } catch (e) {
    console.error("[Google OAuth callback error]", e.message);
    res.redirect("https://hernest-v2.vercel.app?calendar_error=oauth_failed");
  }
};
