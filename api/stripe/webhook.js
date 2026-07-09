// Stripe webhook — keeps users/{uid}/data/subscription in sync.
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Configure in Stripe Dashboard → Webhooks → point at /api/stripe/webhook with
// events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
import Stripe from "stripe";
import { adminDb } from "../_lib/secure.js";

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: "payments_not_configured" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
      // Find the user by subscription id
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
