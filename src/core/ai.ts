// ─── HerNest AI Client ────────────────────────────────────────────
import { auth } from "./firebase";
import type { JsonSchema } from "./aiSchema";
import { guardUserText, showCrisisSheet } from "./crisis";

export type Feature =
  | "cleo_chat" | "morning_briefing" | "style_stylist"
  | "wellness_coach" | "meal_plan" | "trip_planner" | "school_calendar"
  | "gift_advisor" | "household_cfo" | "gmail_extract" | "cleo_checkin"
  | "bill_scan" | "bill_parse";

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
  // The person's own words in this request (a typed line, a pasted
  // newsletter). Checked for distress first: on a match the AI is not called,
  // the crisis sheet opens and the result has code "crisis_detected".
  userText?: string;
}

const CRISIS_RESULT: AIError = { text: "", error: "Crisis language detected", code: "crisis_detected" };

// A 429 from /api/claude: the household's daily limit or the per-minute
// limit. Tells the app to show the server's friendly message.
export async function limitReached(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  const code = body?.error === "burst_limit_reached" ? "burst_limit_reached" : "daily_limit_reached";
  window.dispatchEvent(new CustomEvent("hn_limit_reached", { detail: { code, message: body?.message } }));
  return code;
}

export async function ai(
  system: string,
  prompt: string,
  feature: Feature = "cleo_chat",
  history: Array<{ role: string; content: string }> = [],
  opts: AIOptions = {}
): Promise<AIResult> {
  if (guardUserText(opts.userText)) return CRISIS_RESULT;
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
  return send(idToken, { system, prompt, feature, messages, ...(opts.schema ? { schema: opts.schema } : {}) }, opts.userText !== undefined);
}

// An image the model should read (base64, no data: prefix).
export interface AIImage { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string; }

// One user turn made of images plus an instruction. Only features the server
// allows attachments for will accept this (e.g. bill_scan).
export async function aiWithImages(
  system: string,
  images: AIImage[],
  instruction: string,
  feature: Feature
): Promise<AIResult> {
  const idToken = await getIdToken();
  if (!idToken) return { text: "", error: "Not authenticated", code: "unauthenticated" };
  const content = [
    ...images.map(img => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
    { type: "text", text: instruction },
  ];
  return send(idToken, { system, feature, messages: [{ role: "user", content }] });
}

// showCrisis: the request carries the person's own words, so a server-side
// crisis match should open the crisis sheet (not just fail quietly).
async function send(idToken: string, body: Record<string, unknown>, showCrisis = false): Promise<AIResult> {
  try {
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const code = await limitReached(res);
      return { text: "", error: "AI limit reached", code };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { text: "", error: err.message || `HTTP ${res.status}`, code: `http_${res.status}` };
    }

    const data = await res.json();
    // The server's backstop crisis check matched: the model was not called.
    if (data?.crisis) {
      if (showCrisis) showCrisisSheet();
      return CRISIS_RESULT;
    }
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
