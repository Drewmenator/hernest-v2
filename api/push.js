// ─── Push notifications endpoint ───────────────────────────────────
// POST /api/push?action=test → send a test notification to the caller's own
// devices (used to verify the APNs → FCM → device chain end-to-end).
// Real notifications are sent server-side from cron/event handlers via
// api/_lib/push.js sendPushToUser().
import { adminDb, applyCors, verifyAuth } from "./_lib/secure.js";
import { sendPushToUser, sendMorningBriefingTo, notifyHousehold } from "./_lib/push.js";

export default async function handler(req, res) {
  if (applyCors(req, res, "POST, OPTIONS")) return;

  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const action = req.query?.action;
  try {
    if (action === "test") {
      const result = await sendPushToUser(uid, {
        title: "HerNest",
        body: "Push notifications are working ✓",
        data: { screen: "home" },
      });
      return res.json({ success: true, ...result });
    }
    // Preview the real morning-briefing push on demand (same content the cron
    // sends at 6:00 UTC), so it can be verified without waiting for tomorrow.
    if (action === "briefing") {
      const result = await sendMorningBriefingTo(uid);
      return res.json({ success: true, ...result });
    }
    // Notify the OTHER household members of something the caller just did.
    // Body: { summary: "added a task: buy milk", screen?: "plan" }.
    if (action === "household") {
      const { summary, screen } = req.body || {};
      if (!summary) return res.status(400).json({ error: "missing_summary" });
      let name = "Someone";
      try {
        const p = (await adminDb.doc(`users/${uid}/data/profile`).get()).data();
        name = p?.name || name;
      } catch { /* default */ }
      const result = await notifyHousehold(uid, {
        title: name,
        body: String(summary).slice(0, 140),
        data: { screen: screen || "home" },
      });
      return res.json({ success: true, ...result });
    }
    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    console.error("[Push]", action, "error:", e?.message);
    return res.status(500).json({ error: "push_failed" });
  }
}
