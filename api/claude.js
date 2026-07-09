import { adminDb, adminAuth, applyCors } from "./_lib/secure.js";

const FREE_LIMIT = 500; // Increased for testing

const ALLOWED = ["cleo_chat","morning_briefing","style_stylist","budget_coach","wellness_coach","meal_plan","trip_planner","school_calendar","receipt_scanner","csv_import","gift_advisor","briefing_ask","sunday_reset","travel_brief","wellness_score","circle_match","debrief","household_cfo","cleo_household","wellness_coach_v2","trip_planner_v2","circle_companion"];

export default async function handler(req, res) {
  if (applyCors(req, res, "POST, OPTIONS")) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompt, system, feature, model, messages, tools, stream, max_tokens = 1000 } = req.body || {};
  const effectiveMaxTokens = max_tokens < 2000 ? Math.max(max_tokens, 2000) : max_tokens;

  if (prompt && prompt.length > 12000) return res.status(400).json({ error: "Message too long" });
  if (feature && !ALLOWED.includes(feature)) return res.status(400).json({ error: "Invalid feature" });
  if (max_tokens > 8000) return res.status(400).json({ error: "max_tokens too large" });
  if (!prompt && !messages) return res.status(400).json({ error: "Missing prompt" });

  const idToken = req.headers["authorization"]?.split("Bearer ")[1];
  if (!idToken) return res.status(401).json({ error: "Unauthorized" });

  let uid;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch { return res.status(401).json({ error: "Invalid token" }); }

  const today = new Date().toISOString().split("T")[0];
  const usageRef = adminDb.doc(`users/${uid}/usage/${today}`);
  try {
    const [snap, subSnap] = await Promise.all([
      usageRef.get(),
      adminDb.doc(`users/${uid}/data/subscription`).get(),
    ]);
    const isPro = subSnap.exists && subSnap.data()?.status === "active";
    const count = snap.exists ? (snap.data()?.count || 0) : 0;
    if (!isPro && count >= FREE_LIMIT) return res.status(429).json({ error: "daily_limit_reached", message: "Daily limit reached. Upgrade to Pro for unlimited access." });
    usageRef.set({ count: count + 1, date: today }, { merge: true }).catch(() => {});
  } catch (e) { console.error("[HerNest] Usage check failed:", e?.message); }

  const upstreamBody = {
    model: model || "claude-haiku-4-5-20251001",
    max_tokens,
    // Prompt-cache the system prompt: it carries the large household context
    // and is re-sent every turn (and every agent-loop iteration), so caching
    // it cuts latency + cost on repeat calls within the cache window.
    system: system ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : undefined,
    messages: messages || [{ role: "user", content: prompt }],
    // Cleo v2 agent: forward tool definitions so the model can request actions.
    ...(Array.isArray(tools) && tools.length ? { tools } : {}),
    ...(stream ? { stream: true } : {}),
  };

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
      const err = await response.json().catch(() => ({}));
      console.error("[HerNest API] Anthropic error:", response.status, JSON.stringify(err));
      return res.status(response.status).json({ error: err });
    }

    // ── Streaming: pipe Anthropic's SSE straight through to the client ──
    if (stream && response.body) {
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
    return res.status(500).json({ error: "Internal server error", detail: err?.message });
  }
}
