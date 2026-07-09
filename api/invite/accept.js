import { adminDb, applyCors, verifyAuth } from "../_lib/secure.js";

export default async function handler(req, res) {
  if (applyCors(req, res, "POST, OPTIONS")) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const partnerUid = await verifyAuth(req);
  if (!partnerUid) return res.status(401).json({ error: "Unauthorized" });

  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "Missing token" });

  try {
    const inviteDoc = await adminDb.doc(`invites/${token}`).get();
    if (!inviteDoc.exists) return res.status(404).json({ error: "Invite not found" });

    const invite = inviteDoc.data();
    if (invite.status !== "pending") return res.status(400).json({ error: "Invite already used" });
    if (invite.expiresAt < Date.now()) return res.status(400).json({ error: "Invite expired" });

    const { fromUid, shareCategories, fromName } = invite;

    // Link partner to household
    await adminDb.doc(`users/${partnerUid}/data/household_link`).set({
      primaryUid: fromUid,
      primaryName: fromName,
      shareCategories,
      linkedAt: Date.now(),
      role: "partner",
    });

    // Update primary user's record
    await adminDb.doc(`users/${fromUid}/data/partner_invite`).update({
      status: "accepted",
      partnerUid,
      acceptedAt: Date.now(),
    });

    // Mark invite used
    await adminDb.doc(`invites/${token}`).update({
      status: "accepted",
      partnerUid,
      acceptedAt: Date.now(),
    });

    res.json({ success: true, primaryUid: fromUid, shareCategories });
  } catch (e) {
    console.error("[Accept] Error:", e);
    res.status(500).json({ error: "Failed to accept invite", detail: e.message });
  }
}
