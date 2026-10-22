// ─── Server-side crisis check ──────────────────────────────────────
// The app checks for distress language before it calls the AI
// (src/core/crisis.ts). This is the backstop: if a client bug skips that
// check, /api/claude still refuses to send the message to the model and
// tells the app to show the crisis screen instead.
// KEEP IN SYNC with CRISIS_PATTERNS in src/core/crisis.ts (a test checks).
export const CRISIS_PATTERNS = [
  /(kill|hurt|harm|cut) myself/i,
  /self[- ]?harm/i,
  /end (it all|my life|everything)/i,
  /take my (own )?life/i,
  /(want|wanna|going) to die/i,
  /(don'?t|do not) want to (live|be here|exist|wake up)/i,
  /suicid/i,
  /overdose/i,
  /(can'?t|cannot) (go on|do this anymore|keep going)/i,
  /better off (dead|without me)/i,
  /(no|nobody|no one) (would|will) miss me/i,
];

export const detectCrisis = (text) => CRISIS_PATTERNS.some((p) => p.test(String(text || "")));

// Features whose latest user turn is the person's own words (chat, a typed
// bill line, a pasted newsletter). Others carry app-built prompts (briefing
// context, meal-plan settings) where a match would not be the user speaking.
export const CRISIS_CHECKED_FEATURES = ["cleo_chat", "bill_parse", "school_calendar"];

// Text of the most recent user turn that has text. Agent-loop turns made only
// of tool results are skipped, so the check looks at what the person typed.
export function latestUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      const text = m.content.filter((b) => b?.type === "text").map((b) => String(b.text || "")).join("\n");
      if (text) return text;
    }
  }
  return "";
}

export function needsCrisisResponse(feature, messages) {
  return CRISIS_CHECKED_FEATURES.includes(feature) && detectCrisis(latestUserText(messages));
}
