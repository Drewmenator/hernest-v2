// ─── Plaid bank feed (Wave 3) ──────────────────────────────────────
// Live balances & transactions → the household CFO. One function.
// Routes (vercel.json rewrites):
//   POST /api/plaid?action=link_token  → create a Link token (Bearer)
//   POST /api/plaid?action=exchange    → public_token → access_token (stored encrypted)
//   GET  /api/plaid?action=sync        → incremental transactions (Bearer)
//
// Env: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox|development|production),
//      APP_URL. Unset → 503 (client falls back to "needs setup"), same as Stripe.
import { adminDb, applyCors, verifyAuth, encryptSecret, decryptSecret } from "./_lib/secure.js";

const PLAID_HOST = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

function plaidBase() {
  return PLAID_HOST[process.env.PLAID_ENV || "sandbox"] || PLAID_HOST.sandbox;
}

async function plaid(path, body) {
  const res = await fetch(`${plaidBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_code || `plaid_${res.status}`);
  return data;
}

// ── Plaid personal_finance_category → HerNest budget category ──────
const PFC_MAP = {
  FOOD_AND_DRINK: "dining",
  ENTERTAINMENT: "entertainment",
  GENERAL_MERCHANDISE: "shopping",
  MEDICAL: "medical",
  PERSONAL_CARE: "health",
  TRANSPORTATION: "transport",
  TRAVEL: "transport",
  RENT_AND_UTILITIES: "bills",
  LOAN_PAYMENTS: "bills",
  HOME_IMPROVEMENT: "other",
  GENERAL_SERVICES: "subscriptions",
  GOVERNMENT_AND_NON_PROFIT: "other",
  BANK_FEES: "bills",
};
function mapCategory(t) {
  const primary = t.personal_finance_category?.primary || "";
  const detailed = t.personal_finance_category?.detailed || "";
  if (detailed.includes("GROCERIES")) return "groceries";
  if (detailed.includes("CHILD") || detailed.includes("DAYCARE")) return "childcare";
  return PFC_MAP[primary] || "other";
}

export default async function handler(req, res) {
  if (applyCors(req, res, "GET, POST, OPTIONS")) return;

  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return res.status(503).json({ error: "plaid_not_configured" });
  }

  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const action = req.query?.action;
  try {
    if (action === "link_token") {
      const data = await plaid("/link/token/create", {
        user: { client_user_id: uid },
        client_name: "HerNest",
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
      });
      return res.json({ link_token: data.link_token });
    }

    if (action === "exchange") {
      const { public_token } = req.body || {};
      if (!public_token) return res.status(400).json({ error: "missing_public_token" });
      const data = await plaid("/item/public_token/exchange", { public_token });
      await adminDb.doc(`users/${uid}/integrations/plaid`).set({
        accessToken: encryptSecret(data.access_token),
        itemId: data.item_id,
        cursor: null,
        connectedAt: Date.now(),
      }, { merge: true });
      return res.json({ success: true });
    }

    if (action === "sync") {
      const snap = await adminDb.doc(`users/${uid}/integrations/plaid`).get();
      if (!snap.exists) return res.status(404).json({ error: "Not connected" });
      const { accessToken, cursor } = snap.data();
      const access_token = decryptSecret(accessToken);

      let added = [];
      let nextCursor = cursor || null;
      let hasMore = true;
      // Bound the loop — a fresh connection can page a few times.
      for (let i = 0; hasMore && i < 5; i++) {
        const data = await plaid("/transactions/sync", {
          access_token,
          cursor: nextCursor || undefined,
          count: 100,
        });
        added = added.concat(data.added || []);
        nextCursor = data.next_cursor;
        hasMore = data.has_more;
      }

      const transactions = added
        .filter(t => t.amount > 0) // money out = spending
        .map(t => ({
          id: `plaid_${t.transaction_id}`,
          merchant: t.merchant_name || t.name || "Transaction",
          amount: Math.abs(t.amount),
          category: mapCategory(t),
          date: t.date,
        }));

      await adminDb.doc(`users/${uid}/integrations/plaid`).set({
        cursor: nextCursor,
        lastSyncedAt: Date.now(),
        itemCount: transactions.length,
        lastError: null,
      }, { merge: true });

      return res.json({ transactions });
    }

    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    console.error("[Plaid]", action, "error:", e?.message);
    if (String(e?.message).includes("ITEM_LOGIN_REQUIRED")) {
      await adminDb.doc(`users/${uid}/integrations/plaid`).set({ lastError: "reauth_required" }, { merge: true });
      return res.status(401).json({ error: "reauth_required" });
    }
    return res.status(500).json({ error: "plaid_request_failed" });
  }
}
