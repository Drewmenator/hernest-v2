// ─── Crisis detection (shared) ─────────────────────────────────────
// Used by BOTH Cleo surfaces. The mini-widget previously had no crisis
// handling — a user in distress got a normal LLM reply.
export const CRISIS_PATTERNS = [
  /(kill|hurt|harm) myself/i,
  /end (it|my life|everything)/i,
  /(don'?t|do not) want to (live|be here|exist)/i,
  /suicide/i,
  /(no|nobody) (would|will) miss me/i,
];

export function detectCrisis(msg: string): boolean {
  return CRISIS_PATTERNS.some(p => p.test(msg));
}

export const CRISIS_RESPONSE = `I'm really glad you told me. What you're feeling is real, and you don't have to carry it alone.

I'm not equipped to help in the way you deserve right now, but these people are:

🆘 **Samaritans**: 116 123 (free, 24/7)
🆘 **Shout**: Text SHOUT to 85258
🆘 **NHS 111** or **999** if you're in immediate danger

You matter. Please reach out to one of these services — they want to hear from you.`;
