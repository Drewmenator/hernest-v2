// ─── HerNest AI Client ────────────────────────────────────────────
import { auth } from "./firebase";
import { AI } from "../config";

export type Feature =
  | "nora_chat" | "morning_briefing" | "style_stylist"
  | "budget_coach" | "wellness_coach" | "meal_plan"
  | "trip_planner" | "school_calendar" | "receipt_scanner"
  | "csv_import" | "gift_advisor" | "briefing_ask"
  | "sunday_reset" | "travel_brief" | "wellness_score"
  | "circle_match" | "debrief" | "household_cfo";

const MODEL_MAP: Record<Feature, string> = {
  morning_briefing: AI.SONNET,
  nora_chat:        AI.SONNET,
  trip_planner:     AI.SONNET,
  style_stylist:    AI.SONNET,
  school_calendar:  AI.HAIKU,
  meal_plan:        AI.HAIKU,
  budget_coach:     AI.HAIKU,
  wellness_coach:   AI.HAIKU,
  wellness_score:   AI.HAIKU,
  receipt_scanner:  AI.HAIKU,
  csv_import:       AI.HAIKU,
  gift_advisor:     AI.HAIKU,
  briefing_ask:     AI.HAIKU,
  sunday_reset:     AI.SONNET,
  travel_brief:     AI.HAIKU,
  circle_match:     AI.HAIKU,
  debrief:          AI.HAIKU,
  household_cfo:    AI.SONNET,
};

async function getIdToken(): Promise<string | null> {
  try {
    // Wait for auth to initialize if currentUser is null
    let user = auth.currentUser;
    if (!user) {
      user = await new Promise((resolve) => {
        const unsub = auth.onAuthStateChanged((u) => { unsub(); resolve(u); });
        setTimeout(() => resolve(null), 3000);
      });
    }
    if (!user) return null;
    return await user.getIdToken();
  } catch { return null; }
}

export interface AIResponse {
  text: string;
  error?: never;
}

export interface AIError {
  text?: never;
  error: string;
  code: string;
}

export type AIResult = AIResponse | AIError;

export async function ai(
  system: string,
  prompt: string,
  feature: Feature = "nora_chat",
  history: Array<{ role: string; content: string }> = []
): Promise<AIResult> {
  const idToken = await getIdToken();
  console.log("[AI] idToken:", idToken ? "got token" : "NULL - not authenticated");
  if (!idToken) return { error: "Not authenticated", code: "unauthenticated" };

  const model = MODEL_MAP[feature] || AI.HAIKU;
  const resolvedTokens = 2000;

  const attemptFetch = async (attempt: number): Promise<AIResult> => {
    try {
    console.log("[AI] calling /api/claude for feature:", feature, attempt > 1 ? `(retry ${attempt-1})` : "");
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        system,
        prompt,
        feature,
        model,
        messages: history.length > 0 ? history : undefined,
        max_tokens: resolvedTokens,
      }),
    });

    if (res.status === 429) {
      window.dispatchEvent(new CustomEvent("hn_limit_reached"));
      // Trigger upgrade prompt
    window.dispatchEvent(new CustomEvent("hernest:limit-reached"));
    return { error: "Daily limit reached. Upgrade to Pro for unlimited Nora.", code: "daily_limit_reached" };
    }

    console.log("[AI] response status:", res.status);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[AI] error response:", err);
      return { error: err.message || `HTTP ${res.status}`, code: `http_${res.status}` };
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    // Cost tracking per blueprint 6.8
    const inputTokens  = data.usage?.input_tokens  || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    const rates: Record<string,number> = { "claude-sonnet-4-5":0.000015, "claude-haiku-4-5":0.000004 };
    const cost = inputTokens * 0.000003 + outputTokens * (rates[model||""] || 0.000004);
    if (cost > 0.05) console.warn(`[HerNest] High cost: $${cost.toFixed(4)} for ${feature}`);
    return { text };
  } catch (e) {
    console.error("[AI] network error:", e);
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 1000));
      return attemptFetch(attempt + 1);
    }
    return { error: "Connection problem — please try again", code: "network_error" };
  }
  };
  return attemptFetch(1);
}

// Convenience: parse JSON from AI response
export async function aiJSON<T>(
  system: string,
  prompt: string,
  feature: Feature,
  fallback: T
): Promise<T> {
  const result = await ai(system, prompt, feature);
  if (result.error) return fallback;
  try {
    return JSON.parse(result.text.replace(/```json|```/g, "").trim()) as T;
  } catch {
    return fallback;
  }
}
