import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import crypto from "crypto";

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

  const { fromUid, fromName, toEmail, shareCategories } = req.body || {};
  if (!fromUid || !toEmail) return res.status(400).json({ error: "Missing required fields" });

  try {
    // Generate unique invite token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    // Save invite to Firestore
    await adminDb.doc(`invites/${token}`).set({
      fromUid,
      fromName: fromName || "Your partner",
      toEmail,
      shareCategories: shareCategories || ["tasks", "calendar", "budget"],
      status: "pending",
      createdAt: Date.now(),
      expiresAt,
    });

    // Also save to user's record
    await adminDb.doc(`users/${fromUid}/data/partner_invite`).set({
      toEmail,
      token,
      status: "pending",
      sentAt: Date.now(),
    });

    // Send email via Resend
    const acceptUrl = `https://hernest-v2.vercel.app?invite=${token}`;
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      },
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
              HerNest is your household's AI chief of staff — helping you manage finances, schedules, and family life together. Once you join, you'll have visibility into your shared household without any of the mental load.
            </p>

            <div style="text-align: center; margin-bottom: 32px;">
              <a href="${acceptUrl}" style="background: #2C1810; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-family: sans-serif; font-size: 15px; font-weight: 600; display: inline-block;">
                Join HerNest ✦
              </a>
            </div>
            
            <p style="color: #9B8B7E; font-size: 12px; text-align: center; line-height: 1.6;">
              This invite expires in 7 days.<br>
              If you didn't expect this, you can safely ignore it.
            </p>
          </div>
        `,
      }),
    });

    const emailData = await emailRes.json();
    if (!emailRes.ok) {
      console.error("[Invite] Resend error:", emailData);
      return res.status(500).json({ error: "Failed to send email", detail: emailData });
    }

    console.log("[Invite] Sent to:", toEmail, "token:", token.slice(0, 8) + "...");
    res.json({ success: true, token: token.slice(0, 8) + "..." });
  } catch (e) {
    console.error("[Invite] Error:", e);
    res.status(500).json({ error: "Failed to send invite", detail: e.message });
  }
}
