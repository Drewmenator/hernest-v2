// Create a Stripe Checkout session for HerNest Pro.
// Env: STRIPE_SECRET_KEY, STRIPE_PRICE_ID (recurring price), APP_URL (optional)
import Stripe from "stripe";
import { applyCors, verifyAuth } from "../_lib/secure.js";

export default async function handler(req, res) {
  if (applyCors(req, res, "POST, OPTIONS")) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    return res.status(503).json({ error: "payments_not_configured" });
  }

  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const appUrl = process.env.APP_URL || "https://hernest-v2.vercel.app";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: uid,
      success_url: `${appUrl}?upgraded=1`,
      cancel_url: `${appUrl}?upgrade_cancelled=1`,
      allow_promotion_codes: true,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("[Stripe checkout]", e?.message);
    res.status(500).json({ error: "checkout_failed" });
  }
}
