// ─── /api/claude request policy ────────────────────────────────────
// The server, not the client, decides which model runs, how many tokens it
// may produce, which tools it may call and how big a request may be. Before
// this, any signed-in user could pick any model (including the most expensive)
// and send arbitrary tools — an open proxy on our Anthropic bill.

// Current model IDs. Change here only; the client sends a tier, never an ID.
export const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
};

// Every feature the app uses, with its default tier and output cap.
export const FEATURES = {
  cleo_chat:         { tier: "sonnet", maxTokens: 2000 },
  morning_briefing:  { tier: "sonnet", maxTokens: 2000 },
  style_stylist:     { tier: "sonnet", maxTokens: 2000 },
  trip_planner:      { tier: "sonnet", maxTokens: 2000 },
  trip_planner_v2:   { tier: "sonnet", maxTokens: 2000 },
  sunday_reset:      { tier: "sonnet", maxTokens: 2000 },
  household_cfo:     { tier: "sonnet", maxTokens: 2000 },
  cleo_household:    { tier: "sonnet", maxTokens: 2000 },
  school_calendar:   { tier: "sonnet", maxTokens: 2000, attachments: true },
  receipt_scanner:   { tier: "haiku",  maxTokens: 1000, attachments: true },
  meal_plan:         { tier: "haiku",  maxTokens: 2000 },
  wellness_coach:    { tier: "haiku",  maxTokens: 2000 },
  wellness_coach_v2: { tier: "haiku",  maxTokens: 2000 },
  budget_coach:      { tier: "haiku",  maxTokens: 1000 },
  wellness_score:    { tier: "haiku",  maxTokens: 1000 },
  csv_import:        { tier: "haiku",  maxTokens: 1000 },
  gift_advisor:      { tier: "haiku",  maxTokens: 1000 },
  briefing_ask:      { tier: "haiku",  maxTokens: 1000 },
  travel_brief:      { tier: "haiku",  maxTokens: 1000 },
  circle_match:      { tier: "haiku",  maxTokens: 1000 },
  circle_companion:  { tier: "haiku",  maxTokens: 1000 },
  debrief:           { tier: "haiku",  maxTokens: 1000 },
  gmail_extract:     { tier: "haiku",  maxTokens: 1000 },
  cleo_checkin:      { tier: "haiku",  maxTokens: 1000 },
};

// Tools the Cleo agent may call (src/core/cleoAgent.ts TOOLS). Only cleo_chat
// may send tools at all.
export const ALLOWED_TOOLS = ["add_task", "complete_task", "add_calendar_event"];

// Text budget for system + messages, in characters (~15k tokens).
export const MAX_TEXT_CHARS = 60000;
// Base64 attachment budget (Vercel caps request bodies at 4.5 MB).
export const MAX_ATTACHMENT_CHARS = 4_000_000;
const ATTACHMENT_TYPES = ["image", "document"];

// The client may ask for the cheaper or the stronger tier (the orchestrator
// routes light chat to haiku). Anything else, including a raw model ID such as
// an Opus one, falls back to the feature default.
export function resolveModel(feature, requested) {
  const r = String(requested || "").toLowerCase();
  const tier = r.includes("haiku") ? "haiku" : r.includes("sonnet") ? "sonnet" : FEATURES[feature].tier;
  return MODELS[tier];
}

function contentSize(content, allowAttachments) {
  if (typeof content === "string") return { text: content.length, attach: 0 };
  if (!Array.isArray(content)) throw new Error("bad_content");
  let text = 0, attach = 0;
  for (const b of content) {
    if (!b || typeof b !== "object") throw new Error("bad_content");
    if (ATTACHMENT_TYPES.includes(b.type)) {
      if (!allowAttachments) throw new Error("attachments_not_allowed");
      attach += String(b.source?.data || "").length;
    } else {
      // text, tool_use, tool_result: count their serialised size as text
      text += JSON.stringify(b).length;
    }
  }
  return { text, attach };
}

// Validates the client body and returns the upstream Anthropic body, or
// { error, status } for a client-safe rejection.
export function buildUpstreamBody(body) {
  const { prompt, system, feature, model, messages, tools, stream, max_tokens } = body || {};

  const spec = FEATURES[feature];
  if (!spec) return { error: "invalid_feature", status: 400 };
  if (!prompt && !messages) return { error: "missing_prompt", status: 400 };
  if (system !== undefined && typeof system !== "string") return { error: "bad_request", status: 400 };
  if (prompt !== undefined && typeof prompt !== "string") return { error: "bad_request", status: 400 };

  const msgs = messages ?? [{ role: "user", content: prompt }];
  if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > 60) return { error: "bad_request", status: 400 };

  let text = (system || "").length, attach = 0;
  try {
    for (const m of msgs) {
      if (!m || (m.role !== "user" && m.role !== "assistant")) throw new Error("bad_role");
      const s = contentSize(m.content, !!spec.attachments);
      text += s.text; attach += s.attach;
    }
  } catch (e) {
    return { error: e.message === "attachments_not_allowed" ? "attachments_not_allowed" : "bad_request", status: 400 };
  }
  if (text > MAX_TEXT_CHARS || attach > MAX_ATTACHMENT_CHARS) return { error: "request_too_large", status: 413 };

  let safeTools;
  if (Array.isArray(tools) && tools.length) {
    if (feature !== "cleo_chat") return { error: "tools_not_allowed", status: 400 };
    if (!tools.every(t => t && ALLOWED_TOOLS.includes(t.name))) return { error: "tools_not_allowed", status: 400 };
    // Rebuild each tool so nothing beyond the expected fields is forwarded.
    safeTools = tools.map(t => ({ name: t.name, description: String(t.description || ""), input_schema: t.input_schema }));
  }

  const requestedMax = Number(max_tokens) || spec.maxTokens;
  return {
    upstream: {
      model: resolveModel(feature, model),
      max_tokens: Math.min(Math.max(requestedMax, 1), spec.maxTokens),
      // Prompt-cache the system prompt: it carries the large household context
      // and is re-sent every turn (and every agent-loop iteration).
      system: system ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : undefined,
      messages: msgs,
      ...(safeTools ? { tools: safeTools } : {}),
      ...(stream ? { stream: true } : {}),
    },
  };
}
