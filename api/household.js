// ─── Household membership: invites + partner data ─────────────────
// One function (Hobby 12-function limit). Routed via vercel.json:
//   POST /api/invite/send   → ?action=invite_send
//   POST /api/invite/accept → ?action=invite_accept
//   GET  /api/partner/data  → ?action=partner_data
import crypto from "crypto";
import { adminDb, applyCors, verifyAuthClaims } from "./_lib/secure.js";

const APP_URL = process.env.APP_URL || "https://hernest-v2.vercel.app";

async function inviteSend(req, res, fromUid) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { fromName, toEmail, shareCategories } = req.body || {};
  if (!toEmail) return res.status(400).json({ error: "Missing required fields" });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

  await adminDb.doc(`invites/${token}`).set({
    fromUid, fromName: fromName || "Your partner", toEmail,
    shareCategories: shareCategories || ["tasks", "calendar", "budget"],
    status: "pending", createdAt: Date.now(), expiresAt,
  });
  await adminDb.doc(`users/${fromUid}/data/partner_invite`).set({
    toEmail, token, status: "pending", sentAt: Date.now(),
  });

  const acceptUrl = `${APP_URL}?invite=${token}`;
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: "HerNest <onboarding@resend.dev>",
      to: [toEmail],
      subject: `${fromName || "Your partner"} invited you to HerNest`,
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFBF7;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 28px; color: #2C1810; font-style: italic; margin: 0;">HerNest</h1>
            <p style="color: #9B8B7E; font-family: sans-serif; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;">Household Intelligence</p>
          </div>
          <p style="color: #2C1810; font-size: 16px; line-height: 1.7; margin-bottom: 16px;">
            <strong>${fromName || "Your partner"}</strong> has invited you to join their HerNest household.
          </p>
          <p style="color: #6B5B52; font-size: 14px; line-height: 1.7; margin-bottom: 32px;">
            HerNest is your household's AI chief of staff — helping you manage finances, schedules, and family life together.
          </p>
          <div style="text-align: center; margin-bottom: 32px;">
            <a href="${acceptUrl}" style="background: #2C1810; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-family: sans-serif; font-size: 15px; font-weight: 600; display: inline-block;">
              Join HerNest ✦
            </a>
          </div>
          <p style="color: #9B8B7E; font-size: 12px; text-align: center; line-height: 1.6;">
            This invite expires in 7 days.<br>If you didn't expect this, you can safely ignore it.
          </p>
        </div>`,
    }),
  });
  const emailData = await emailRes.json();
  if (!emailRes.ok) {
    console.error("[Household] Resend error:", emailData?.message || emailRes.status);
    return res.status(500).json({ error: "Failed to send email" });
  }
  res.json({ success: true });
}

async function inviteAccept(req, res, claims) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const partnerUid = claims.uid;
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "Missing token" });

  const inviteDoc = await adminDb.doc(`invites/${token}`).get();
  if (!inviteDoc.exists) return res.status(404).json({ error: "Invite not found" });
  const invite = inviteDoc.data();
  if (invite.status !== "pending") return res.status(400).json({ error: "Invite already used" });
  if (invite.expiresAt < Date.now()) return res.status(400).json({ error: "Invite expired" });

  // Bind the invite to its recipient: the accepting user's verified email must
  // match the address it was sent to. Stops a forwarded/leaked link from letting
  // anyone join the household and read its shared data.
  const invitedEmail = (invite.toEmail || "").toLowerCase();
  if (!claims.email || !claims.emailVerified || claims.email !== invitedEmail) {
    return res.status(403).json({ error: "This invite was sent to a different email address." });
  }

  const { fromUid, shareCategories, fromName } = invite;
  await adminDb.doc(`users/${partnerUid}/data/household_link`).set({
    primaryUid: fromUid, primaryName: fromName, shareCategories,
    linkedAt: Date.now(), role: "partner",
  });
  await adminDb.doc(`users/${fromUid}/data/partner_invite`).update({
    status: "accepted", partnerUid, acceptedAt: Date.now(),
  });
  await adminDb.doc(`invites/${token}`).update({
    status: "accepted", partnerUid, acceptedAt: Date.now(),
  });
  res.json({ success: true, primaryUid: fromUid, shareCategories });
}

async function partnerData(req, res, uid) {
  const linkDoc = await adminDb.doc(`users/${uid}/data/household_link`).get();
  if (!linkDoc.exists) return res.status(404).json({ error: "Not linked to a household" });
  const { primaryUid, shareCategories } = linkDoc.data();
  const sharedData = {};
  await Promise.all((shareCategories || []).map(async (cat) => {
    try {
      const doc = await adminDb.doc(`users/${primaryUid}/data/${cat}`).get();
      if (doc.exists) sharedData[cat] = doc.data();
    } catch (e) { console.warn("[Household] partner category read failed:", cat); }
  }));
  res.json({ primaryUid, shareCategories, data: sharedData });
}

export default async function handler(req, res) {
  if (applyCors(req, res, "GET, POST, OPTIONS")) return;

  const claims = await verifyAuthClaims(req);
  if (!claims?.uid) return res.status(401).json({ error: "Unauthorized" });
  const uid = claims.uid;

  const action = req.query?.action;
  try {
    if (action === "invite_send") return await inviteSend(req, res, uid);
    if (action === "invite_accept") return await inviteAccept(req, res, claims);
    if (action === "partner_data") return await partnerData(req, res, uid);
  } catch (e) {
    console.error("[Household]", action, "error:", e?.message);
    return res.status(500).json({ error: "request_failed" });
  }
  return res.status(400).json({ error: "unknown_action" });
}
