// ─── Style: the pure logic behind "what do I wear today?" ───────────
// Weather and calendar into a prompt, which events are worth planning an
// outfit for, reading old and new style docs, and saved looks of both shapes.
// No Firebase, no React: all tested.
import type { SimpleEvent } from "../../core/upcomingEvents";
import type { WeatherData } from "../../core/weather";

// ── Occasions ("Something else") ───────────────────────────────────
export const OCCASIONS: { id: string; label: string; emoji: string }[] = [
  { id: "work",    label: "Work",          emoji: "💼" },
  { id: "date",    label: "Date night",    emoji: "🌙" },
  { id: "kids",    label: "Kids' party",   emoji: "🎈" },
  { id: "workout", label: "Workout",       emoji: "🏃‍♀️" },
  { id: "errands", label: "Errands",       emoji: "🛒" },
  { id: "special", label: "Special event", emoji: "✨" },
];
export const occasionLabel = (id?: string | null) =>
  OCCASIONS.find(o => o.id === id)?.label
  // old saved looks used these ids
  ?? ({ casual: "Casual", evening: "Evening", special: "Special event", today: "Today" } as Record<string, string>)[id || ""]
  ?? "Today";

const RULES: { id: string; words: RegExp }[] = [
  { id: "special", words: /\b(wedding|gala|funeral|memorial|graduation|christening|baptism|bar mitzvah|bat mitzvah|quincea|prom|formal|awards?|ceremony|recital|concert|theat(er|re)|opera|ballet|banquet)\b/i },
  { id: "date",    words: /\b(date night|date|anniversary|dinner (with|at)|drinks|cocktails?|girls'? night|night out)\b/i },
  { id: "kids",    words: /\b(birthday party|kids'? party|party|playdate|play date|bday)\b/i },
  { id: "work",    words: /\b(meeting|call|interview|presentation|conference|client|office|work|standup|stand-up|review|1:1|one-on-one|zoom|teams)\b/i },
  { id: "workout", words: /\b(gym|yoga|pilates|run|running|spin|barre|workout|class pass|hike|tennis|pickleball|swim)\b/i },
];

// Events that are just logistics: nothing to dress for.
const ROUTINE = /\b(pick ?up|drop ?off|school run|carpool|practice|dentist|doctor|orthodont|appointment|reminder|bills?|due|trash|recycling|no school|early dismissal|half day|library|homework|deadline|pay)\b/i;

export function occasionFor(title: string): string | null {
  if (ROUTINE.test(title)) return null;
  for (const r of RULES) if (r.words.test(title)) return r.id;
  return null;
}

// "Coming up": the next 7 days (not today), only events worth dressing for.
export function comingUp(events: SimpleEvent[], today: string, max = 5): (SimpleEvent & { occasion: string })[] {
  return events
    .filter(e => e.date > today)
    .map(e => ({ ...e, occasion: occasionFor(e.title) }))
    .filter((e): e is SimpleEvent & { occasion: string } => !!e.occasion && e.occasion !== "workout")
    .slice(0, max);
}

// Today's mix: the most "dressy" event sets the tone; otherwise everyday.
const WEIGHT: Record<string, number> = { special: 5, date: 4, work: 3, kids: 2, workout: 1 };
export function occasionForDay(events: SimpleEvent[]): string | null {
  let best: string | null = null;
  for (const e of events) {
    const o = occasionFor(e.title);
    if (o && (!best || WEIGHT[o] > WEIGHT[best])) best = o;
  }
  return best;
}

// ── Words for the prompt and the screen ────────────────────────────
export function weatherLine(w: WeatherData | null): string {
  if (!w) return "";
  const feels = Math.abs(w.feelsLike - w.temp) >= 5 ? `, feels like ${w.feelsLike}°` : "";
  return `${w.temp}°${w.unit} and ${w.condition.toLowerCase()}${feels}`;
}

export function formatTime(hhmm?: string): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

export function dayLine(events: SimpleEvent[], max = 3): string {
  return events.slice(0, max).map(e => (e.time ? `${formatTime(e.time)} ${e.title}` : e.title)).join(", ")
    + (events.length > max ? ` +${events.length - max} more` : "");
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function whenLabel(date: string, today: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const diff = Math.round((new Date(y, m - 1, d).getTime() - new Date(ty, tm - 1, td).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return diff < 7 ? WEEKDAY[new Date(y, m - 1, d).getDay()] : new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Her style profile (set once). Reads the old doc too. ───────────
export const STYLE_WORDS = ["Classic", "Casual", "Minimal", "Sporty", "Boho", "Feminine", "Edgy", "Polished", "Colorful", "Comfy"];
export const US_SIZES = ["XS / 0-2", "S / 4-6", "M / 8-10", "L / 12-14", "XL / 16-18", "1X / 18-20", "2X / 22-24", "3X / 26-28"];
export const BODY_SHAPES = ["Hourglass", "Pear", "Apple", "Rectangle", "Inverted triangle", "Petite", "Plus size"];
export const BUDGET_STEPS = [50, 100, 200, 400];

export interface StyleProfile { size: string; words: string[]; budget: number | null; bodyShape: string; height: string; }

const OLD_VIBE_TO_WORDS: Record<string, string[]> = {
  "Classic elegant": ["Classic", "Polished"], "Boho casual": ["Boho", "Casual"], "Minimalist": ["Minimal"],
  "Bold & colorful": ["Colorful"], "Smart casual": ["Casual", "Polished"], "Athleisure": ["Sporty", "Comfy"],
  "Feminine romantic": ["Feminine"], "Edgy cool": ["Edgy"],
};
const OLD_BUDGET_TO_AMOUNT: Record<string, number> = { "Budget-friendly": 50, "Mid-range": 100, "Premium": 200, "Luxury": 400 };

export function readStyleProfile(d: Record<string, unknown> | null | undefined): StyleProfile {
  const doc = d || {};
  const words = Array.isArray(doc.styleWords) && doc.styleWords.length
    ? doc.styleWords.filter((w: unknown): w is string => typeof w === "string")
    : OLD_VIBE_TO_WORDS[String(doc.vibe)] || [];
  const budget = typeof doc.budgetAmount === "number" ? doc.budgetAmount : OLD_BUDGET_TO_AMOUNT[String(doc.budget)] ?? null;
  return { size: String(doc.size || ""), words, budget, bodyShape: String(doc.bodyShape || ""), height: String(doc.height || "") };
}

export function hasProfile(p: StyleProfile): boolean {
  return !!(p.size || p.words.length || p.budget);
}

export function profileLine(p: StyleProfile, money: (n: number) => string): string {
  return [p.size && `US ${p.size}`, p.words.length && p.words.join(", "), p.budget && `about ${money(p.budget)} an outfit`]
    .filter(Boolean).join(" · ");
}

// ── The outfit itself ──────────────────────────────────────────────
export interface Outfit { headline: string; pieces: { item: string; note: string }[]; why: string; tip: string | null; }

export function buildOutfitPrompt(input: {
  weather: string; events: SimpleEvent[]; occasion: string | null; eventTitle?: string; when?: string;
  profile: StyleProfile; currencyCode: string; avoid: string[];
}): string {
  const p = input.profile;
  const lines = [
    input.eventTitle
      ? `Outfit for: ${input.eventTitle}${input.when ? ` (${input.when})` : ""}.`
      : `Outfit for today.${input.events.length ? ` Her day: ${dayLine(input.events, 5)}.` : " Nothing on her calendar."}`,
    input.occasion ? `Occasion: ${occasionLabel(input.occasion)}.` : "Occasion: an everyday mom day.",
    input.weather ? `Weather${input.eventTitle ? " today (may differ on the day)" : ""}: ${input.weather}.` : "",
    p.size ? `Her size: US ${p.size}.` : "",
    p.words.length ? `Her style: ${p.words.join(", ")}.` : "",
    p.bodyShape ? `Body shape: ${p.bodyShape}.` : "",
    p.height ? `Height: ${p.height}.` : "",
    p.budget ? `If anything needs buying, keep the whole look around ${p.budget} ${input.currencyCode}.` : "",
    input.avoid.length ? `Give a different idea from: ${input.avoid.join(" | ")}.` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export const OUTFIT_SYSTEM = `You are Cleo, a practical stylist for a busy mom. Suggest ONE outfit she can put on from a normal closet.
Rules:
- Dress for the weather and everything on her day (school run, work, after-school). Comfort and practicality first.
- headline: the whole outfit in one line, e.g. "Dark jeans, cream knit, ankle boots, rain jacket"
- pieces: 3 to 6 items, each with a short note (max 8 words)
- why: one or two short sentences tied to her weather and day. No essay, no flattery.
- tip: one optional practical tip, or null
- US sizes, US English, never mention body flaws.`;

export function parseOutfit(text: string): Outfit | null {
  try {
    const o = JSON.parse(text);
    if (!o || typeof o.headline !== "string" || !Array.isArray(o.pieces)) return null;
    const pieces = (o.pieces as { item?: unknown; note?: unknown }[])
      .filter((p): p is { item: string; note?: unknown } => !!p && typeof p.item === "string" && !!p.item.trim())
      .map(p => ({ item: p.item.trim(), note: typeof p.note === "string" ? p.note.trim() : "" }))
      .slice(0, 6);
    if (!pieces.length) return null;
    return { headline: o.headline.trim(), pieces, why: typeof o.why === "string" ? o.why.trim() : "", tip: typeof o.tip === "string" && o.tip.trim() ? o.tip.trim() : null };
  } catch { return null; }
}

// ── Saved looks: new shape, plus the old stylist's ─────────────────
// What the old stylist saved (rec.outfit.top.name etc.)
type OldPiece = { name?: unknown } | null | undefined;
interface OldRec { rationale?: unknown; outfit?: Record<string, OldPiece | OldPiece[]>; }

export interface SavedLook { id: string; occasion: string; title?: string; outfit?: Outfit; rec?: OldRec; mood?: string; savedAt: number; }

export function lookView(l: SavedLook): { title: string; headline: string; lines: string[]; note: string } {
  if (l.outfit) {
    return { title: l.title || occasionLabel(l.occasion), headline: l.outfit.headline, lines: l.outfit.pieces.map(p => p.item), note: l.outfit.why };
  }
  // Old stylist format: rec.outfit.{top,bottom,dress,outerwear,shoes,bag,accessories}
  const o = l.rec?.outfit || {};
  const one = (k: string) => (Array.isArray(o[k]) ? null : (o[k] as OldPiece));
  const items = [one("top"), one("dress"), one("bottom"), one("outerwear"), one("shoes"), one("bag"), ...(Array.isArray(o.accessories) ? o.accessories : [])]
    .map(x => x?.name).filter((n: unknown): n is string => typeof n === "string" && !!n);
  return { title: l.title || occasionLabel(l.occasion), headline: items.slice(0, 4).join(", "), lines: items, note: typeof l.rec?.rationale === "string" ? l.rec.rationale : "" };
}
