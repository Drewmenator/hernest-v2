// ─── Push notifications endpoint ───────────────────────────────────
// POST /api/push?action=test → send a test notification to the caller's own
// devices (used to verify the APNs → FCM → device chain end-to-end).
// Real notifications are sent server-side from cron/event handlers via
// api/_lib/push.js sendPushToUser().
import { applyCors, verifyAuth } from "./_lib/secure.js";
import { sendPushToUser } from "./_lib/push.js";

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
    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    console.error("[Push]", action, "error:", e?.message);
    return res.status(500).json({ error: "push_failed" });
  }
}
