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

// Plaid retired the "development" environment — only sandbox and production
// remain. Live bank data requires PLAID_ENV=production AND production Plaid
// credentials (client_id/secret) set in the environment, plus Plaid having
// approved the app for production access.
const PLAID_HOST = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

function isProd() {
  return (process.env.PLAID_ENV || "sandbox").toLowerCase() === "production";
}

function plaidBase() {
  return isProd() ? PLAID_HOST.production : PLAID_HOST.sandbox;
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
      const { public_token, institution } = req.body || {};
      if (!public_token) return res.status(400).json({ error: "missing_public_token" });
      const data = await plaid("/item/public_token/exchange", { public_token });
      // Each Plaid Item = one bank login. Store one doc per bank so connecting a
      // second bank never overwrites the first. Keyed by item_id (idempotent:
      // re-linking the same bank updates in place rather than duplicating).
      await adminDb.doc(`users/${uid}/integrations/plaid/items/${data.item_id}`).set({
        accessToken: encryptSecret(data.access_token),
        itemId: data.item_id,
        institutionName: (institution && String(institution).slice(0, 80)) || "Bank",
        cursor: null,
        connectedAt: Date.now(),
        lastError: null,
      }, { merge: true });
      await writeSummary(uid);
      return res.json({ success: true });
    }

    if (action === "sync") {
      const items = await getItems(uid);
      if (!items.length) return res.status(404).json({ error: "Not connected" });

      let added = [];
      let anyReauth = false;
      for (const item of items) {
        const access_token = decryptSecret(item.accessToken);
        let nextCursor = item.cursor || null;
        let hasMore = true;
        try {
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
          await adminDb.doc(`users/${uid}/integrations/plaid/items/${item.itemId}`).set({
            cursor: nextCursor, lastSyncedAt: Date.now(), lastError: null,
          }, { merge: true });
        } catch (e) {
          // One bank failing (e.g. needs re-login) must not block the others.
          const reauth = String(e?.message).includes("ITEM_LOGIN_REQUIRED");
          if (reauth) anyReauth = true;
          await adminDb.doc(`users/${uid}/integrations/plaid/items/${item.itemId}`).set({
            lastError: reauth ? "reauth_required" : "sync_failed",
          }, { merge: true });
          console.error("[Plaid] sync item", item.itemId, "error:", e?.message);
        }
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

      await writeSummary(uid);
      // Surface reauth as a soft flag (not a hard 401) since other banks may
      // have synced fine — the client shows a "reconnect X" nudge.
      return res.json({ transactions, reauthRequired: anyReauth });
    }

    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    console.error("[Plaid]", action, "error:", e?.message);
    return res.status(500).json({ error: "plaid_request_failed" });
  }
}

// ── Multi-bank helpers ─────────────────────────────────────────────
// Read every connected bank. Migrates a pre-multi-bank single `plaid` doc
// into the collection on first read so existing connections keep working.
async function getItems(uid) {
  const col = await adminDb.collection(`users/${uid}/integrations/plaid/items`).get();
  if (!col.empty) return col.docs.map(d => d.data());

  const legacy = await adminDb.doc(`users/${uid}/integrations/plaid`).get();
  if (legacy.exists && legacy.data()?.accessToken && legacy.data()?.itemId) {
    const d = legacy.data();
    const migrated = {
      accessToken: d.accessToken, itemId: d.itemId,
      institutionName: "Bank", cursor: d.cursor || null,
      connectedAt: d.connectedAt || Date.now(), lastError: null,
    };
    await adminDb.doc(`users/${uid}/integrations/plaid/items/${d.itemId}`).set(migrated, { merge: true });
    return [migrated];
  }
  return [];
}

// Maintain a secret-free summary doc at integrations/plaid so the client and
// the connections screen can read connection state without touching tokens.
async function writeSummary(uid) {
  const items = await getItems(uid);
  await adminDb.doc(`users/${uid}/integrations/plaid`).set({
    connected: items.length > 0,
    bankCount: items.length,
    banks: items.map(i => ({
      itemId: i.itemId,
      institutionName: i.institutionName || "Bank",
      lastError: i.lastError || null,
    })),
    lastSyncedAt: Date.now(),
    // No secrets here — this doc is client-readable. Full replace (no merge) so a
    // migrated legacy doc's encrypted accessToken/itemId fields are cleared out.
  });
}
