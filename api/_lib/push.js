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

// calendar_synced is household-scoped (partners' data under the primary uid).
async function ownerFor(uid) {
  try {
    const link = await adminDb.doc(`users/${uid}/data/household_link`).get();
    return (link.exists ? link.data()?.primaryUid : null) || uid;
  } catch { return uid; }
}

// One-line, lightly personalized morning briefing body.
export async function buildBriefingLine(uid) {
  const owner = await ownerFor(uid);
  const today = new Date().toISOString().split("T")[0];
  try {
    const events = ((await adminDb.doc(`users/${owner}/data/calendar_synced`).get()).data()?.events) || [];
    const todays = events.filter(e => e.date === today);
    if (todays.length === 0) return "A clear calendar today. Tap for your briefing.";
    if (todays.length === 1) return `1 thing today: ${todays[0].title}. Tap for your briefing.`;
    return `${todays.length} things on today. Tap for your briefing.`;
  } catch {
    return "Your morning briefing is ready.";
  }
}

// Send the morning briefing push to one user. Reused by the cron (all users)
// and by the manual self-test action.
export async function sendMorningBriefingTo(uid) {
  const body = await buildBriefingLine(uid);
  return sendPushToUser(uid, { title: "Good morning ☀️", body, data: { screen: "briefing" } });
}
