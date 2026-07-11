// ─── Push sender (server) ──────────────────────────────────────────
// Sends FCM notifications to a user's registered devices and prunes tokens
// FCM reports as dead. Import from cron/event handlers; not a route itself.
import { getMessaging } from "firebase-admin/messaging";
import { adminDb } from "./secure.js";

// Send one notification to every device registered under users/{uid}/devices.
// Returns { sent, pruned }. Safe to call when the user has no devices.
export async function sendPushToUser(uid, { title, body, data = {} }) {
  const snap = await adminDb.collection(`users/${uid}/devices`).get();
  const tokens = snap.docs.map(d => d.id).filter(Boolean);
  if (!tokens.length) return { sent: 0, pruned: 0 };

  // FCM data payload values must be strings.
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: stringData,
    apns: { payload: { aps: { sound: "default" } } },
  });

  // Remove tokens FCM says are no longer valid so we don't keep retrying them.
  let pruned = 0;
  await Promise.all(res.responses.map(async (r, i) => {
    if (r.success) return;
    const code = r.error?.code || "";
    if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
      pruned++;
      await adminDb.doc(`users/${uid}/devices/${tokens[i]}`).delete().catch(() => {});
    }
  }));

  return { sent: res.successCount, pruned };
}
