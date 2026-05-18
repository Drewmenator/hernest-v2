import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({ credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  })});
}

const adminDb = getFirestore();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { token, partnerUid } = req.body || {};
  if (!token || !partnerUid) return res.status(400).json({ error: "Missing token or partnerUid" });

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
