// ─── Crisis detection (shared) ─────────────────────────────────────
// Used by every place a user can type to Cleo (Cleo chat, the mini-widget,
// the Briefing's "Ask Cleo"). A message that matches skips the AI entirely and
// gets local helplines instead.
import { getCurrency } from "../shared/utils/money";

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

export function detectCrisis(msg: string): boolean {
  return CRISIS_PATTERNS.some(p => p.test(msg));
}

// Helplines by country. Only well-established national services; anywhere
// else gets the international directory, which lists free local lines.
const HELPLINES: Record<string, string[]> = {
  GB: ["**Samaritans**: 116 123 (free, 24/7)", "**Shout**: text SHOUT to 85258", "**NHS 111**, or **999** if you're in immediate danger"],
  IE: ["**Samaritans**: 116 123 (free, 24/7)", "**Text About It**: text HELLO to 50808", "**112** or **999** if you're in immediate danger"],
  US: ["**988 Suicide & Crisis Lifeline**: call or text 988 (free, 24/7)", "**911** if you're in immediate danger"],
  CA: ["**988 Suicide Crisis Helpline**: call or text 988 (free, 24/7)", "**911** if you're in immediate danger"],
  AU: ["**Lifeline**: 13 11 14 (24/7)", "**000** if you're in immediate danger"],
  NZ: ["**Need to talk?**: call or text 1737 (free, 24/7)", "**111** if you're in immediate danger"],
};
const DEFAULT_LINES = [
  "**Find a Helpline**: findahelpline.com lists free, confidential lines in your country",
  "Your local emergency number if you're in immediate danger",
];

// Country from the device locale (e.g. "en-GB"), falling back to the
// household's currency, then the international directory.
const CURRENCY_COUNTRY: Record<string, string> = { GBP: "GB", USD: "US", CAD: "CA", AUD: "AU", NZD: "NZ" };

export function crisisCountry(locale?: string, currency?: string): string | null {
  const region = (locale || "").split(/[-_]/)[1]?.toUpperCase();
  if (region && HELPLINES[region]) return region;
  if (currency && CURRENCY_COUNTRY[currency]) return CURRENCY_COUNTRY[currency];
  return null;
}

export function crisisResponse(
  locale: string | undefined = typeof navigator !== "undefined" ? navigator.language : undefined,
  currency: string | undefined = getCurrency(),
): string {
  const country = crisisCountry(locale, currency);
  const lines = (country && HELPLINES[country]) || DEFAULT_LINES;
  return `I'm really glad you told me. What you're feeling is real, and you don't have to carry it alone.

I'm not equipped to help in the way you deserve right now, but these people are:

${lines.map(l => `🆘 ${l}`).join("\n")}

You matter. Please reach out to one of these services — they want to hear from you.`;
}
