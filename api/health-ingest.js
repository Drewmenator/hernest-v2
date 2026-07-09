// ─── Apple Health ingest (Wave 4) ──────────────────────────────────
// Web apps can't read Apple Health, so the user runs an iOS Shortcut that
// POSTs sleep/steps here on a schedule. Auth is a per-user opaque token
// (Shortcuts can't do Firebase auth) — the token IS the credential, so
// CORS "*" is intentional and safe (no cookies, no ambient authority).
//
// Body: { token, sleepHours?, steps?, date? }
import { adminDb } from "./_lib/secure.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { token, sleepHours, steps, date } = req.body || {};
  if (!token) return res.status(400).json({ error: "missing_token" });

  try {
    const tokDoc = await adminDb.doc(`health_tokens/${token}`).get();
    if (!tokDoc.exists) return res.status(401).json({ error: "invalid_token" });
    const uid = tokDoc.data().uid;

    const today = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : new Date().toISOString().split("T")[0];
    const update = { date: today, receivedAt: Date.now(), lastError: null };
    if (sleepHours != null && !isNaN(Number(sleepHours))) update.lastSleepHours = Math.round(Number(sleepHours) * 10) / 10;
    if (steps != null && !isNaN(Number(steps))) update.lastSteps = Math.round(Number(steps));

    await adminDb.doc(`users/${uid}/integrations/apple_health`).set(update, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error("[HealthIngest]", e?.message);
    res.status(500).json({ error: "ingest_failed" });
  }
}
