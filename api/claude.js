import { adminDb, adminAuth, applyCors } from "./_lib/secure.js";
import { buildUpstreamBody } from "./_lib/claudeRequest.js";
import { householdIdFor, takeQuota, recordUsage, normalizeUsage, sseUsageTracker, LIMIT_MESSAGES } from "./_lib/aiUsage.js";
import { needsCrisisResponse } from "./_lib/crisis.js";

export default async function handler(req, res) {
  if (applyCors(req, res, "POST, OPTIONS")) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const built = buildUpstreamBody(req.body);
  if (built.error) return res.status(built.status).json({ error: built.error });
  const upstreamBody = built.upstream;
  const feature = req.body.feature;

  const idToken = req.headers["authorization"]?.split("Bearer ")[1];
  if (!idToken) return res.status(401).json({ error: "Unauthorized" });

  let uid;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch { return res.status(401).json({ error: "Invalid token" }); }

  // Distress language never goes to the model. The app shows its crisis
  // screen (988 and 911) when it sees crisis: true. Doesn't use up a call.
  if (needsCrisisResponse(feature, upstreamBody.messages)) {
    return res.status(200).json({ crisis: true });
  }

  // Fail closed: if the limits can't be checked, don't spend money on the call.
  let householdId;
  try {
    householdId = await householdIdFor(adminDb, uid);
    const quota = await takeQuota(adminDb, { uid, householdId });
    if (!quota.ok) {
      return res.status(429).json({ error: quota.reason, message: LIMIT_MESSAGES[quota.reason] });
    }
  } catch (e) {
    console.error("[HerNest] Usage check failed:", e?.message);
    return res.status(503).json({ error: "temporarily_unavailable" });
  }

  const record = (usage) => recordUsage(adminDb, { householdId, uid, feature, model: upstreamBody.model, usage });

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

    // ── Streaming: pipe Anthropic's SSE straight through to the client,
    // reading the token counts out of it on the way ──
    if (upstreamBody.stream && response.body) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      const tracker = sseUsageTracker();
      try {
        for await (const chunk of response.body) {
          tracker.push(chunk);
          res.write(chunk);
        }
      } catch (e) {
        console.error("[HerNest API] stream relay error:", e?.message);
      }
      await record(tracker.usage());
      return res.end();
    }

    const data = await response.json();
    await record(normalizeUsage(data.usage));
    return res.status(200).json(data);
  } catch (err) {
    console.error("[HerNest API] Error:", err?.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
