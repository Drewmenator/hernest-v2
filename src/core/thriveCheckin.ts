// ─── Thrive check-in brain ─────────────────────────────────────────
// Cleo's morning check-in paragraph + the single contextual nudge.
// Pure logic exported for tests; AI generation with a strict
// no-invented-data prompt and a static fallback built from real numbers.
import { vsUsual, type WearableDay } from "./wellnessAutoTrack";
import { todayLocal } from "./dateAwareness";

// ── Nudge: at most ONE, priority-ordered, always skippable ─────────
export interface Nudge { id: string; text: string; }

export function pickNudge(w: WearableDay | null, waterGlasses: number, hour: number): Nudge | null {
  if (!w) return null;
  // 1. Long sedentary stretch (afternoon onwards, when it's actionable)
  if (w.sedentaryMins != null && w.sedentaryMins >= 360 && hour >= 12 && hour < 20) {
    return { id: "sedentary", text: "You've been still for most of the day — even a 10-minute walk resets more than you'd think." };
  }
  // 2. Stress-heavy day with little recovery → protect the evening
  if (w.stressHighMins != null && w.stressHighMins >= 120 && (w.recoveryHighMins ?? 0) < 30 && hour >= 15) {
    return { id: "stress_evening", text: "Today has carried more stress than recovery. Keep tonight light if you can — you've earned it." };
  }
  // 3. Behind on water late in the day
  if (waterGlasses < 4 && hour >= 15 && hour < 21) {
    return { id: "water", text: `Only ${waterGlasses} glass${waterGlasses === 1 ? "" : "es"} of water so far — a couple before dinner keeps the evening headache away.` };
  }
  return null;
}

// ── What Cleo reads the day from ────────────────────────────────────
// She doesn't ask how you feel: the measured numbers say more. With Oura the
// tone follows readiness; with Apple Health (no readiness score) it follows
// sleep and how heart rate variability compares with her own usual.
export type DayTone = "lighter" | "steady" | "strong" | null;

export function dayTone(w: WearableDay | null): DayTone {
  if (!w) return null;
  if (w.readiness != null) return w.readiness >= 85 ? "strong" : w.readiness >= 60 ? "steady" : "lighter";
  const hrv = vsUsual(w.avgHrv, w.history, "hrv", w.date);
  const short = w.sleepHours != null && w.sleepHours < 6;
  const rested = w.sleepHours != null && w.sleepHours >= 7;
  if (short || (hrv?.word === "below" && hrv.diffPct <= -15)) return "lighter";
  if (rested && hrv?.word !== "below") return "strong";
  if (w.sleepHours == null && !hrv) return null;
  return "steady";
}

// The measured facts Cleo's note may use. Nothing here is estimated.
export function checkinFacts(w: WearableDay): string[] {
  const hrv = vsUsual(w.avgHrv, w.history, "hrv", w.date);
  const rhr = vsUsual(w.restingHr, w.history, "restingHr", w.date);
  const usual = (v: ReturnType<typeof vsUsual>, unit: string) => (v ? ` (${v.word} her usual ${v.usual}${unit})` : "");
  return [
    w.sleepHours != null ? `Sleep: ${w.sleepHours}h${w.sleepScore != null ? `, score ${w.sleepScore}/100` : ""}` : null,
    w.readiness != null ? `Readiness: ${w.readiness}/100` : null,
    w.avgHrv != null ? `Heart rate variability: ${w.avgHrv}ms${usual(hrv, "ms")}` : null,
    w.restingHr != null ? `Resting heart rate: ${w.restingHr}bpm${usual(rhr, "bpm")}` : null,
    w.stressDay ? `Yesterday's stress balance: ${w.stressDay} (${w.stressHighMins ?? 0}min stress-high vs ${w.recoveryHighMins ?? 0}min recovery-high)` : null,
    w.steps != null ? `Steps so far today: ${w.steps}` : null,
    w.activeMins != null ? `Active minutes today: ${w.activeMins}` : null,
    w.mindfulMins ? `Mindful minutes today: ${w.mindfulMins}` : null,
  ].filter((x): x is string => !!x);
}

// ── Static note (fallback + no-AI path). Real numbers only. ────────
export function greetingFor(hour: number): string {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function buildCheckinFallback(w: WearableDay | null, name: string, hour = new Date().getHours()): string {
  const hi = `${greetingFor(hour)}${name ? `, ${name}` : ""} ✦`;
  if (!w || (w.sleepHours == null && w.readiness == null && w.avgHrv == null)) {
    return `${hi} I don't have last night's numbers yet. Once Apple Health or Oura syncs, your note for today will be here.`;
  }
  const bits: string[] = [];
  if (w.sleepHours != null) bits.push(`you slept ${w.sleepHours}h${w.sleepScore != null ? ` (score ${w.sleepScore})` : ""}`);
  if (w.readiness != null) bits.push(`your body's at ${w.readiness} readiness`);
  else {
    const hrv = vsUsual(w.avgHrv, w.history, "hrv", w.date);
    if (hrv && hrv.word !== "about") bits.push(`your heart rate variability is ${hrv.word} your usual`);
  }
  if (w.stressDay === "restored") bits.push("and yesterday ended more restored than stressed");
  else if (w.stressDay === "stressful") bits.push("and yesterday ran stressful, so today gets to be gentler");

  const tone = {
    strong: " A strong day. A good one for the thing you've been putting off.",
    steady: " A steady day. Pace yourself and it'll all fit.",
    lighter: " Your body's asking for a lighter day. Protect what you can.",
  }[dayTone(w) || "steady"];
  return bits.length ? `${hi} ${bits.join(", ")}.${tone}` : `${hi}${tone}`;
}

// ── AI check-in with cache + fallback ───────────────────────────────
export async function generateCheckin(uid: string, name: string, w: WearableDay | null): Promise<string> {
  const fallback = buildCheckinFallback(w, name);
  // Nothing measured today: the fallback, not an AI note about nothing.
  if (!w || !checkinFacts(w).length) return fallback;

  try {
    const [{ ai }, { loadData, saveData }] = await Promise.all([import("./ai"), import("./firebase")]);
    const today = todayLocal();

    // Cache: one generation per day (v2: notes no longer end with a question)
    const cached = await loadData(uid, "thrive_checkin");
    if (cached?.date === today && cached.v === 2 && typeof cached.text === "string" && cached.text) return cached.text as string;

    const facts = checkinFacts(w).join("\n");
    const tone = dayTone(w);

    const sys = `You are Cleo, a warm household chief of staff. Write ONE short note for today (2-3 sentences, max 55 words) for ${name || "her"} using ONLY the measured data below. Rules:
- Reference up to 3 of the strongest signals in plain language. No jargon, no listing every number.
- Never invent data. Never mention data you weren't given.
- Read her day from the numbers; don't ask how she feels or how her energy is.
- Tone: ${tone === "lighter" ? "protective and permission-giving, her body needs a lighter day" : tone === "strong" ? "quietly energizing, it's a strong day" : "steady and encouraging"}.
- End with one small suggestion for today tied to these numbers (e.g. short sleep: keep the evening light), not a question and not a generic wellness tip.
- No greetings like "Good morning" (the UI adds context), no emoji except at most one ✦, no em dashes.`;

    const result = await ai(sys, facts, "cleo_checkin");
    if (result.error || !result.text.trim()) return fallback;
    const text = result.text.trim();
    await saveData(uid, "thrive_checkin", { date: today, text, v: 2 }).catch(() => {});
    return text;
  } catch {
    return fallback;
  }
}

// ─── Weekly wellness score (body-first) ────────────────────────────
// Composed from wearable trends + mood. No hydration/habits — those were
// removed with the manual-logging redesign. Pure + tested.
export interface ScoreBreakdown { sleep: number; readiness: number; activity: number; mood: number }

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeWeeklyScore(
  history: Array<{ sleepScore: number | null; sleepHours: number | null; readiness: number | null }>,
  activityScores: number[],
  moodRatings: number[], // 3 | 6 | 9 scale from MOOD_LEVELS
): { score: number; breakdown: ScoreBreakdown } {
  const last7 = (history || []).slice(-7);
  // Sleep 0-10: prefer Oura sleep score, else derive from hours (7-8h = 10)
  const sleepVals = last7.map(d => d.sleepScore != null ? d.sleepScore / 10
    : d.sleepHours != null ? (d.sleepHours >= 7 && d.sleepHours <= 9 ? 10 : d.sleepHours >= 6 ? 8 : d.sleepHours >= 5 ? 6 : 3)
    : null).filter((v): v is number => v != null);
  const readyVals = last7.map(d => d.readiness).filter((v): v is number => v != null).map(v => v / 10);
  const actVals = (activityScores || []).filter(v => v != null).map(v => v / 10);
  const moodVals = (moodRatings || []).map(v => (v / 9) * 10); // 3→3.3, 9→10

  const sleep = sleepVals.length ? avg(sleepVals) : 5;
  const readiness = readyVals.length ? avg(readyVals) : 5;
  const activity = actVals.length ? avg(actVals) : 5;
  const mood = moodVals.length ? avg(moodVals) : 5;

  // Sleep 30 · Readiness 30 · Activity 20 · Mood 20
  const score = Math.round((sleep * 0.3 + readiness * 0.3 + activity * 0.2 + mood * 0.2) * 10) / 10;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { score, breakdown: { sleep: r1(sleep), readiness: r1(readiness), activity: r1(activity), mood: r1(mood) } };
}
