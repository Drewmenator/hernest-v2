// Stripe: checkout session creation + webhook, in one function
// (Hobby plan allows max 12 serverless functions — these two share one).
// Routed via vercel.json rewrites:
//   /api/stripe/checkout → /api/stripe?action=checkout
//   /api/stripe/webhook  → /api/stripe?action=webhook
// Env: STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET, APP_URL
import Stripe from "stripe";
import { adminDb, applyCors, verifyAuth } from "./_lib/secure.js";

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function handleCheckout(req, res, stripe) {
  if (applyCors(req, res, "POST, OPTIONS")) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STRIPE_PRICE_ID) return res.status(503).json({ error: "payments_not_configured" });

  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

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

async function handleWebhook(req, res, stripe) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: "payments_not_configured" });

  let event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[Stripe webhook] signature verification failed:", e?.message);
    return res.status(400).json({ error: "invalid_signature" });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.client_reference_id;
      if (uid) {
        await adminDb.doc(`users/${uid}/data/subscription`).set({
          status: "active",
          plan: "pro",
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          activatedAt: Date.now(),
        }, { merge: true });
        console.log("[Stripe] Pro activated for", uid);
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const snap = await adminDb.collectionGroup("data")
        .where("stripeSubscriptionId", "==", sub.id).limit(1).get();
      if (!snap.empty) {
        const active = sub.status === "active" || sub.status === "trialing";
        await snap.docs[0].ref.set({
          status: active ? "active" : "canceled",
          currentPeriodEnd: (sub.current_period_end || 0) * 1000,
        }, { merge: true });
        console.log("[Stripe] subscription", sub.id, "→", sub.status);
      }
    }

    res.json({ received: true });
  } catch (e) {
    console.error("[Stripe webhook] handler error:", e?.message);
    res.status(500).json({ error: "webhook_failed" });
  }
}

export default async function handler(req, res) {
  if (!process.env.STRIPE_SECRET_KEY) {
    if (applyCors(req, res, "POST, OPTIONS")) return;
    return res.status(503).json({ error: "payments_not_configured" });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const action = req.query?.action || "";
  if (action === "webhook") return handleWebhook(req, res, stripe);
  return handleCheckout(req, res, stripe);
}
