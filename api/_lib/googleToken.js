// ─── Google access tokens (calendar + Gmail) ───────────────────────
// Shared by /api/connectors and the overnight /api/cron Gmail scan.
import { adminDb, encryptSecret, openToken, isSealed } from "./secure.js";

export async function freshGoogleToken(uid, doc) {
  const snap = await adminDb.doc(`users/${uid}/integrations/${doc}`).get();
  if (!snap.exists) return { error: "not_connected" };
  const stored = snap.data();
  let accessToken = openToken(stored.accessToken);
  const refreshToken = openToken(stored.refreshToken);
  if (Date.now() > (stored.expiresAt || 0) - 60000 && refreshToken) {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const refreshed = await r.json().catch(() => ({}));
    if (!refreshed.access_token) {
      console.error("[Connectors] google refresh failed:", r.status);
      return { error: "reauth_required" };
    }
    accessToken = refreshed.access_token;
    await adminDb.doc(`users/${uid}/integrations/${doc}`).update({
      accessToken: encryptSecret(accessToken),
      refreshToken: encryptSecret(refreshToken),
      expiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000,
    });
  } else if (!isSealed(stored.accessToken) || (stored.refreshToken && !isSealed(stored.refreshToken))) {
    await sealLegacyTokens(uid, doc, stored);
  }
  return { accessToken };
}

// Re-encrypt tokens saved in plaintext before encryption was added.
async function sealLegacyTokens(uid, doc, stored) {
  try {
    await adminDb.doc(`users/${uid}/integrations/${doc}`).update({
      accessToken: stored.accessToken ? encryptSecret(openToken(stored.accessToken)) : null,
      refreshToken: stored.refreshToken ? encryptSecret(openToken(stored.refreshToken)) : null,
      connected: true,
    });
  } catch (e) { console.error("[Connectors] token re-encrypt failed:", e?.message); }
}
