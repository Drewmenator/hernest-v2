// ─── HerNest AI Client ────────────────────────────────────────────
import { auth } from "./firebase";
import type { JsonSchema } from "./aiSchema";

export type Feature =
  | "cleo_chat" | "morning_briefing" | "style_stylist"
  | "budget_coach" | "wellness_coach" | "meal_plan"
  | "trip_planner" | "school_calendar" | "receipt_scanner"
  | "csv_import" | "gift_advisor" | "briefing_ask"
  | "sunday_reset" | "travel_brief" | "wellness_score"
  | "circle_match" | "debrief" | "household_cfo" | "gmail_extract" | "cleo_checkin";

// Model choice and output limits live on the server (api/_lib/claudeRequest.js),
// keyed by feature. The client only says which feature it is.

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

export interface AIOptions {
  // A fixed answer shape (JSON schema, object at the root). The API then
  // guarantees the reply is valid JSON in that shape — no more cutting JSON out
  // of free text. Build one with the helpers in ./aiSchema.
  schema?: JsonSchema;
}

export async function ai(
  system: string,
  prompt: string,
  feature: Feature = "cleo_chat",
  history: Array<{ role: string; content: string }> = [],
  opts: AIOptions = {}
): Promise<AIResult> {
  const idToken = await getIdToken();
  if (!idToken) return { text: "", error: "Not authenticated", code: "unauthenticated" };

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
        messages,
        ...(opts.schema ? { schema: opts.schema } : {}),
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

// Convenience: parse JSON from AI response. Pass a schema to get a guaranteed
// shape (structured outputs); without one the reply is parsed best-effort.
export async function aiJSON<T>(
  system: string,
  prompt: string,
  feature: Feature,
  fallback: T,
  schema?: JsonSchema
): Promise<T> {
  const result = await ai(system, prompt, feature, [], { schema });
  if (result.error) return fallback;
  try {
    return JSON.parse(result.text.replace(/```json|```/g, "").trim()) as T;
  } catch {
    return fallback;
  }
}
