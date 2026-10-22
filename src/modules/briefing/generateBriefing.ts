// ─── Briefing generator ───────────────────────────────────────────
// Shared by the Today screen (morning note) and the full Briefing screen.
// One briefing per time window (morning/afternoon/evening), cached locally.
import { displayAge } from "../../core/dateAwareness";
import { ai } from "../../core/ai";
import { s as js } from "../../core/aiSchema";
import { db as localDb } from "../../core/db";
import { buildAppContext, buildBriefingPrompt, selectFocusWord, type AppContext } from "../../core/contextBuilder";
import { trackEvent } from "../../core/analytics";
import type { WeatherData } from "../../core/weather";
import type { FamilyMember, UserProfile } from "../../core/store";
import { cleanBriefing } from "./briefingFilter";

// ── Types per blueprint spec ───────────────────────────────────────
export interface Briefing {
  focusWord:    { word: string; emoji: string; why: string };
  greeting:     string;
  priorities:   { rank: number; text: string; emoji: string; source: string; urgency: string; whyToday: string; estimatedMinutes?: number }[];
  calendar:     { highlights: { time: string; title: string; icon: string }[]; densityNote?: string; conflicts?: string[] };
  tasks:        { aiSuggestion: string; completionNote: string };
  bills?:       { message: string } | null;  // replaced the old Budget pulse (Oct 2026)
  trips?:       { statusMessage: string; urgentActions: string[]; excitementNote: string; packingStatus?: string };
  circle:       { checkinMessage?: string; birthdayAlert?: string; communityNote?: string };
  energy?:      { predictedLevel: string; predictionBasis: string; tip: string; scheduleSuggestion: string } | null;  // only with body data
  affirmation:  { text: string; theme: string };
  travelBrief?: { urgentActions: string[]; packingTip: string; weatherHint?: string | null; kidsTip?: string; excitement: string };
}

// Fixed answer shape for the briefing (structured outputs): the API returns
// exactly this, so no more cutting JSON out of the reply text.
const opt = js.nullable(js.string());
const BRIEFING_SCHEMA = js.object({
  focusWord: js.object({ word: js.string(), emoji: js.string(), why: js.string() }),
  greeting: js.string(),
  priorities: js.array(js.object({
    rank: js.integer(), text: js.string(), emoji: js.string(),
    source: js.enum(["task", "calendar", "school", "bills", "trip", "circle", "health"]),
    urgency: js.enum(["critical", "high", "medium", "low"]),
    whyToday: js.string(), estimatedMinutes: js.nullable(js.integer()),
  })),
  calendar: js.object({
    highlights: js.array(js.object({ time: js.string(), title: js.string(), icon: js.string() })),
    densityNote: opt, conflicts: js.array(js.string()),
  }),
  tasks: js.object({ aiSuggestion: opt, completionNote: opt }),
  bills: js.nullable(js.object({ message: js.string() })),
  trips: js.nullable(js.object({
    statusMessage: js.string(), urgentActions: js.array(js.string()), excitementNote: js.string(), packingStatus: opt,
  })),
  circle: js.object({ checkinMessage: opt, birthdayAlert: opt, communityNote: opt }),
  energy: js.nullable(js.object({
    predictedLevel: js.enum(["high", "medium", "low", "very-low"]),
    predictionBasis: js.string(), tip: opt, scheduleSuggestion: opt,
  })),
  affirmation: js.object({ text: js.string(), theme: js.string() }),
  travelBrief: js.nullable(js.object({
    urgentActions: js.array(js.string()), packingTip: js.string(), weatherHint: opt, kidsTip: opt, excitement: js.string(),
  })),
});

export type BriefingWindow = "morning" | "afternoon" | "evening";
export function briefingWindow(d: Date = new Date()): BriefingWindow {
  const h = d.getHours();
  return h >= 6 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : "evening";
}

// The cached briefing for the current window, or null.
export async function cachedBriefing(): Promise<Briefing | null> {
  try {
    const cached = await localDb.getTodayBriefing();
    const b = cached?.data as unknown as Briefing | undefined;
    return b ? cleanBriefing(b) : null;
  } catch { return null; }
}

// Today and the Briefing screen can both ask at once; share one AI call.
let inflight: Promise<{ briefing: Briefing; ctx: AppContext }> | null = null;

export function generateBriefing(opts: {
  uid: string; profile: UserProfile | null; familyMembers: FamilyMember[]; weather: WeatherData | null;
}): Promise<{ briefing: Briefing; ctx: AppContext }> {
  if (inflight) return inflight;
  inflight = runGenerate(opts).finally(() => { inflight = null; });
  return inflight;
}

async function runGenerate({ uid, profile, familyMembers, weather }: {
  uid: string; profile: UserProfile | null; familyMembers: FamilyMember[]; weather: WeatherData | null;
}): Promise<{ briefing: Briefing; ctx: AppContext }> {
  const appCtx = await buildAppContext(uid, (profile ?? {}) as unknown as Record<string, unknown>).catch(() => ({} as AppContext));
  const window = briefingWindow();
  const weatherStr = weather ? `Current weather: ${weather.temp}°${weather.unit} ${weather.condition} ${weather.icon}, feels like ${weather.feelsLike}°${weather.unit}, humidity ${weather.humidity}%, wind ${weather.windSpeed}mph.` : "";
  const windowPrompt = window === "morning"
    ? "Generate a warm, energizing morning briefing. Focus on today's priorities, schedule, and what matters most today."
    : window === "afternoon"
    ? "Generate a midday check-in briefing. Focus on what's still pending and afternoon priorities."
    : "Generate a gentle evening wind-down briefing. Focus on what was accomplished today, tomorrow's prep, and winding down.";
  const contextStr = `${appCtx ? buildBriefingPrompt(appCtx) + "\n\n" : ""}${weatherStr ? weatherStr + "\n" : ""}Time of day: ${window}. ${windowPrompt}`;
  const focusData  = selectFocusWord(appCtx.tone);

  const familyRoster = familyMembers.length > 0
    ? "Family: " + familyMembers.map(m => { const a = displayAge(m); return `${m.name} (${m.role}${a != null ? ", age " + a : ""}${m.notes ? ", " + m.notes : ""})`; }).join("; ")
    : "";

  // Energy and the travel brief only when there is real data behind them.
  const hasBody = appCtx?.thrive?.readiness != null || !!appCtx?.thrive?.bodyFacts?.length;
  const travelSoon = (appCtx?.trips?.next?.daysUntil ?? 99) <= 14;

  const date = new Date().toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });

  const sys = `You are Cleo, ${appCtx?.name || profile?.name || "her"}'s AI chief of staff inside HerNest.
Generate her Morning Briefing as a warm, intelligent, SPECIFIC summary.

${familyRoster ? familyRoster + "\n" : ""}TONE: ${appCtx?.tone || "steady"} (${appCtx?.toneConfig?.label || "Steady"})
RULES:
- Be SPECIFIC — use real names, amounts, dates from the data
- Be CONCISE — every word earns its place
- Be WARM — this is the first thing she reads
- Be ACTIONABLE — every priority needs a clear next step
- NEVER mention total debt amounts in the briefing unless a payment is due today or a milestone was reached. Focus on what's going well and what needs action today.
- NEVER invent facts not in the data. If data is missing, say "I don't have that info yet" — never fill gaps with plausible-sounding details.
- If tone is tired/struggling: reduce demands, increase compassion
- If tone is thriving: energise and celebrate
- ONLY real items: every priority must come from something in the data (a task, calendar event, school item, bill, trip, or birthday). Fewer priorities is better than filler.
- NEVER give generic parenting or family-time advice (e.g. "spend 15 minutes with your son", "quality time with the kids"). She knows how to be a mom.
- NEVER ask her to log, track or record anything in the app (sleep, mood, habits, water, check-ins). Missing wellness data just means you don't mention it.

Answer in this shape (null for anything you have no data for):
{
  "focusWord": {"word":"${focusData.word}","emoji":"${focusData.emoji}","why":"one personal sentence why this word today"},
  "greeting": "warm personal greeting using her name and today ${date}",
  "priorities": [{"rank":1,"text":"specific action","emoji":"emoji","source":"task|calendar|school|bills|trip|circle|health","urgency":"critical|high|medium|low","whyToday":"why now","estimatedMinutes":5}],
  "calendar": {"highlights":[{"time":"","title":"","icon":""}],"densityNote":"optional note if heavy","conflicts":[]},
  "tasks": {"aiSuggestion":"the one task from TASKS to do first, by its name, or null if there are none","completionNote":null},
  "bills": {"message":"one short, calm line about bills that are overdue or due in the next few days, using only the BILLS data"} or null if no bills are overdue or due soon,
  "trips": {"statusMessage":"","urgentActions":[""],"excitementNote":"","packingStatus":""},
  "circle": {"checkinMessage":"optional","birthdayAlert":"optional","communityNote":"optional"},
  "energy": ${hasBody ? `{"predictedLevel":"high|medium|low|very-low","predictionBasis":"cite the strongest measured signals: body readiness if present, else sleep and heart rate variability vs her usual (e.g. readiness 62 + 5.8h sleep). Don't ask how she feels","tip":"one tip tied to those numbers, or null","scheduleSuggestion":"when to tackle which of her real tasks or events, or null"}` : "null (no body data today)"},
  "affirmation": {"text":"warm personal affirmation","theme":"${appCtx?.toneConfig?.affirmationTheme || "self-compassion"}"},
  "travelBrief": ${travelSoon ? '{"urgentActions":[""],"packingTip":"","weatherHint":"only from weather data you were given, else null","kidsTip":"","excitement":""}' : 'null'}
}
Return up to 5 priorities, most important first; on a light day 1 or 2 is right, and an empty list is fine. Set trips and travelBrief to null unless that data exists.`;

  const result = await ai(sys, contextStr, "morning_briefing", [], { schema: BRIEFING_SCHEMA });
  if (result.error) throw new Error(String(result.error));

  const parsed = JSON.parse(result.text) as Briefing;
  if (!parsed.priorities) parsed.priorities = [];
  if (!parsed.calendar) parsed.calendar = { highlights: [] };
  parsed.tasks = { aiSuggestion: parsed.tasks?.aiSuggestion || "", completionNote: parsed.tasks?.completionNote || "" };
  if (parsed.energy) parsed.energy = { ...parsed.energy, tip: parsed.energy.tip || "", scheduleSuggestion: parsed.energy.scheduleSuggestion || "" };
  if (!hasBody) parsed.energy = null;
  if (!parsed.affirmation) parsed.affirmation = { text: "", theme: "" };
  if (!parsed.circle) parsed.circle = {};
  if (!parsed.focusWord) parsed.focusWord = { word: "Today", emoji: "✦", why: "Focus on what matters most." };
  if (!parsed.greeting) parsed.greeting = "Good morning.";
  const clean = cleanBriefing(parsed);
  trackEvent("briefing_generated");
  await localDb.cacheBriefing({ ...clean, generatedAt: new Date().toISOString() } as unknown as Record<string, unknown>);
  return { briefing: clean, ctx: appCtx };
}
