import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminAuth, applyCors } from "./_lib/secure.js";
import { buildUpstreamBody } from "./_lib/claudeRequest.js";

const FREE_LIMIT = parseInt(process.env.FREE_DAILY_AI_LIMIT || "500", 10); // Pro users bypass (see usage check)

// Atomically checks the daily quota and counts this call. A transaction means
// parallel requests can't all read the same count and slip past the limit.
// Returns true if the call may proceed.
async function takeQuota(uid) {
  const today = new Date().toISOString().split("T")[0];
  const usageRef = adminDb.doc(`users/${uid}/usage/${today}`);
  const subRef = adminDb.doc(`users/${uid}/data/subscription`);
  return adminDb.runTransaction(async (tx) => {
    const [snap, subSnap] = await Promise.all([tx.get(usageRef), tx.get(subRef)]);
    const isPro = subSnap.exists && subSnap.data()?.status === "active";
    const count = snap.exists ? (snap.data()?.count || 0) : 0;
    if (!isPro && count >= FREE_LIMIT) return false;
    tx.set(usageRef, { count: FieldValue.increment(1), date: today }, { merge: true });
    return true;
  });
}

export default async function handler(req, res) {
  if (applyCors(req, res, "POST, OPTIONS")) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const built = buildUpstreamBody(req.body);
  if (built.error) return res.status(built.status).json({ error: built.error });
  const upstreamBody = built.upstream;

  const idToken = req.headers["authorization"]?.split("Bearer ")[1];
  if (!idToken) return res.status(401).json({ error: "Unauthorized" });

  let uid;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch { return res.status(401).json({ error: "Invalid token" }); }

  // Fail closed: if the quota can't be checked, don't spend money on the call.
  try {
    if (!(await takeQuota(uid))) {
      return res.status(429).json({ error: "daily_limit_reached", message: "Daily limit reached. Upgrade to Pro for unlimited access." });
    }
  } catch (e) {
    console.error("[HerNest] Usage check failed:", e?.message);
    return res.status(503).json({ error: "temporarily_unavailable" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(upstreamBody),
    });

    if (!response.ok) {
      // Log the detail server-side; the client only gets a generic error.
      const err = await response.json().catch(() => ({}));
      console.error("[HerNest API] Anthropic error:", response.status, JSON.stringify(err));
      const status = response.status === 429 || response.status === 529 ? 503 : 502;
      return res.status(status).json({ error: "ai_unavailable" });
    }

    // ── Streaming: pipe Anthropic's SSE straight through to the client ──
    if (upstreamBody.stream && response.body) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      try {
        for await (const chunk of response.body) {
          res.write(chunk);
        }
      } catch (e) {
        console.error("[HerNest API] stream relay error:", e?.message);
      }
      return res.end();
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("[HerNest API] Error:", err?.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
