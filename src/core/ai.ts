// ─── HerNest AI Client ────────────────────────────────────────────
import { auth } from "./firebase";
import { AI } from "../config";

export type Feature =
  | "cleo_chat" | "morning_briefing" | "style_stylist"
  | "budget_coach" | "wellness_coach" | "meal_plan"
  | "trip_planner" | "school_calendar" | "receipt_scanner"
  | "csv_import" | "gift_advisor" | "briefing_ask"
  | "sunday_reset" | "travel_brief" | "wellness_score"
  | "circle_match" | "debrief" | "household_cfo" | "gmail_extract" | "cleo_checkin";

const MODEL_MAP: Record<Feature, string> = {
  morning_briefing: AI.SONNET,
  cleo_chat:        AI.SONNET,
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
  gmail_extract:    AI.HAIKU,
  cleo_checkin:     AI.HAIKU,
};

async function getIdToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch { return null; }
}

export interface AIResponse {
  text: string;
  error?: never;
}

export interface AIError {
  text: string; // always "" on error — lets callers use .text without narrowing
  error: string;
  code: string;
}

export type AIResult = AIResponse | AIError;

export async function ai(
  system: string,
  prompt: string,
  feature: Feature = "cleo_chat",
  history: Array<{ role: string; content: string }> = []
): Promise<AIResult> {
  const idToken = await getIdToken();
  if (!idToken) return { text: "", error: "Not authenticated", code: "unauthenticated" };

  const model = MODEL_MAP[feature] || AI.HAIKU;

  // Build a valid messages array. It MUST start with a "user" turn and MUST end
  // with the current message — previously only `history` was sent, so once a
  // conversation existed the current message was dropped and the model was asked
  // to answer a transcript ending in its own turn (→ empty/garbled reply). This
  // is why chat failed but history-less features like the briefing worked.
  const safeHistory = history.filter(
    (m) => m && (m.role === "user" || m.role === "assistant") && m.content
  );
  while (safeHistory.length && safeHistory[0].role !== "user") safeHistory.shift();
  const messages = [...safeHistory, { role: "user", content: prompt }];

  try {
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
        messages,
        max_tokens: ["morning_briefing", "trip_planner", "meal_plan", "style_stylist", "cleo_chat", "household_cfo", "wellness_coach", "sunday_reset"].includes(feature) ? 2000 : 1000,
      }),
    });

    if (res.status === 429) {
      window.dispatchEvent(new CustomEvent("hn_limit_reached"));
      return { text: "", error: "Daily limit reached", code: "daily_limit_reached" };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { text: "", error: err.message || `HTTP ${res.status}`, code: `http_${res.status}` };
    }

    const data = await res.json();
    const text =
      (Array.isArray(data.content)
        ? data.content.find((b: any) => b?.type === "text")?.text
        : undefined) ||
      data.content?.[0]?.text ||
      "";
    // An empty reply becomes a soft fallback rather than a hard "having a moment".
    if (!text) return { text: "", error: "Empty response from model", code: "empty_response" };
    return { text };
  } catch (e) {
    return { text: "", error: "Network error", code: "network_error" };
  }
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
