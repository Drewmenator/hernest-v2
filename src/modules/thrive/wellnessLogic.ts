// ─── Wellness: the pure logic behind the one-screen Wellness view ───
// Week dots, the "move this week" goal, the one suggestion, the mood entry
// format and the plain weekly summary. No Firebase, no React: all tested.
import { todayLocal } from "../../core/dateAwareness";
import type { WearableDay, WearableDayPoint } from "../../core/wellnessAutoTrack";

// ── Dates ───────────────────────────────────────────────────────────
const parse = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (day: string, n: number) => { const d = parse(day); d.setDate(d.getDate() + n); return todayLocal(d); };

// The 7 days of the week containing `today`, Sunday first (US calendars).
export function weekDays(today: string): string[] {
  const start = addDays(today, -parse(today).getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// ── Mood + energy (the only mood logger in the app) ────────────────
// Same labels and 3/6/9 rating Thrive always saved, so the briefing and old
// readers keep working. `value` is the 1-5 scale Cleo's context reads.
export type MoodFace = "struggling" | "okay" | "good";
export type Energy = "low" | "ok" | "good";

export const MOOD_FACES: { id: MoodFace; label: string; emoji: string; rating: number; value: number }[] = [
  { id: "struggling", label: "Struggling", emoji: "😔", rating: 3, value: 2 },
  { id: "okay",       label: "Okay",       emoji: "😐", rating: 6, value: 3 },
  { id: "good",       label: "Good",       emoji: "😊", rating: 9, value: 4 },
];
export const ENERGY_LEVELS: { id: Energy; label: string }[] = [
  { id: "low", label: "Low" }, { id: "ok", label: "OK" }, { id: "good", label: "Good" },
];

// A row as stored in Firestore: shape not guaranteed (old app versions wrote it).
export type StoredRow = Record<string, unknown>;

export type MoodEntry = { date: string; rating: number; label: string; value: number; energy?: Energy; at?: number };

export function moodFaceFor(entry: StoredRow | null | undefined): MoodFace | null {
  if (!entry) return null;
  const byLabel = MOOD_FACES.find(f => f.label.toLowerCase() === String(entry.label || "").toLowerCase());
  if (byLabel) return byLabel.id;
  if (entry.label === "Hard") return "struggling"; // the old Home check-in
  const r = Number(entry.rating);
  if (!r) return null;
  return r <= 4 ? "struggling" : r <= 7 ? "okay" : "good";
}

const MAX_MOOD_LOGS = 90;

// Upsert today's entry (mood and/or energy), keep the log oldest-first so the
// readers that take `slice(-7)` see the latest week.
export function saveMoodEntry(
  logs: StoredRow[] | undefined,
  date: string,
  change: { face?: MoodFace; energy?: Energy },
  now = Date.now(),
): MoodEntry[] {
  const list = (Array.isArray(logs) ? logs : []).filter(l => l && typeof l.date === "string") as (StoredRow & { date: string })[];
  const existing = list.find(l => l.date === date);
  const face = change.face ?? moodFaceFor(existing) ?? "okay";
  const f = MOOD_FACES.find(x => x.id === face)!;
  const energy = change.energy ?? (existing?.energy as Energy | undefined);
  const entry: MoodEntry = { date, rating: f.rating, label: f.label, value: f.value, ...(energy ? { energy } : {}), at: now };
  return [...(list.filter(l => l.date !== date) as unknown as MoodEntry[]), entry]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_MOOD_LOGS);
}

// ── Move goal ──────────────────────────────────────────────────────
export interface MoveGoal { type: "minutes" | "steps"; amount: number; days: number; }

export const GOAL_PRESETS: { id: string; label: string; goal: MoveGoal }[] = [
  { id: "m20x3", label: "Move 20 min, 3 days a week", goal: { type: "minutes", amount: 20, days: 3 } },
  { id: "m30x3", label: "Move 30 min, 3 days a week", goal: { type: "minutes", amount: 30, days: 3 } },
  { id: "m30x5", label: "Move 30 min, 5 days a week", goal: { type: "minutes", amount: 30, days: 5 } },
  { id: "s5k",   label: "5,000 steps a day",          goal: { type: "steps", amount: 5000, days: 7 } },
  { id: "s7k",   label: "7,000 steps a day",          goal: { type: "steps", amount: 7000, days: 7 } },
  { id: "s10k",  label: "10,000 steps a day",         goal: { type: "steps", amount: 10000, days: 7 } },
];

export function goalLabel(g: MoveGoal): string {
  const preset = GOAL_PRESETS.find(p => p.goal.type === g.type && p.goal.amount === g.amount && p.goal.days === g.days);
  if (preset) return preset.label;
  return g.type === "steps"
    ? `${g.amount.toLocaleString("en-US")} steps${g.days >= 7 ? " a day" : `, ${g.days} days a week`}`
    : `Move ${g.amount} min, ${g.days} day${g.days === 1 ? "" : "s"} a week`;
}

export function isValidGoal(v: unknown): v is MoveGoal {
  const g = v as MoveGoal | null;
  return !!g && (g.type === "minutes" || g.type === "steps") && g.amount > 0 && g.days >= 1 && g.days <= 7;
}

export interface DayActivity { steps: number | null; activeMins: number | null; }

// What the device knows per day: the wearable history plus today's live numbers.
export function activityByDay(w: WearableDay | null): Record<string, DayActivity> {
  const out: Record<string, DayActivity> = {};
  const put = (day: string, steps: number | null | undefined, mins: number | null | undefined) => {
    const prev = out[day] || { steps: null, activeMins: null };
    out[day] = {
      steps: steps != null ? Math.max(steps, prev.steps ?? 0) : prev.steps,
      activeMins: mins != null ? Math.max(mins, prev.activeMins ?? 0) : prev.activeMins,
    };
  };
  for (const p of (w?.history || []) as WearableDayPoint[]) if (p?.day) put(p.day, p.steps, p.activeMins);
  if (w?.date) put(w.date, w.steps, null);
  return out;
}

export type DotState = "moved" | "today" | "missed" | "future";
export interface Dot { date: string; letter: string; state: DotState; auto: boolean; }

export function movedOn(goal: MoveGoal, a: DayActivity | undefined): boolean {
  if (!a) return false;
  return goal.type === "steps"
    ? (a.steps ?? 0) >= goal.amount
    : (a.activeMins ?? 0) >= goal.amount;
}

export function weekDots(goal: MoveGoal, today: string, activity: Record<string, DayActivity>, manualDays: string[] = []): Dot[] {
  const manual = new Set(manualDays);
  return weekDays(today).map(date => {
    const letter = "SMTWTFS"[parse(date).getDay()];
    const auto = movedOn(goal, activity[date]);
    if (date > today) return { date, letter, state: "future", auto: false };
    if (auto || manual.has(date)) return { date, letter, state: "moved", auto };
    return { date, letter, state: date === today ? "today" : "missed", auto: false };
  });
}

export interface GoalProgress { done: number; target: number; met: boolean; daysLeft: number; text: string; }

export function goalProgress(goal: MoveGoal, dots: Dot[]): GoalProgress {
  const done = dots.filter(d => d.state === "moved").length;
  const target = Math.min(7, goal.days);
  // Days still open, counting today if she hasn't moved yet
  const daysLeft = dots.filter(d => d.state === "future" || d.state === "today").length;
  const met = done >= target;
  const text = met
    ? (done > target ? `Goal met, plus ${done - target} extra` : "Goal met this week")
    : `${done} of ${target} days`;
  return { done, target, met, daysLeft, text };
}

// Days in a row up to today (today counts only once she has moved).
export function moveStreak(dots: Dot[]): number {
  let n = 0;
  const past = dots.filter(d => d.state !== "future");
  for (let i = past.length - 1; i >= 0; i--) {
    if (past[i].state === "moved") n++;
    else if (past[i].state === "today") continue;
    else break;
  }
  return n;
}

// ── The one suggestion ─────────────────────────────────────────────
export interface Suggestion { id: string; text: string; }

export interface SuggestionInput {
  hour: number;
  sleepHours: number | null;
  readiness: number | null;
  mood: MoodFace | null;
  energy: Energy | null;
  eventsToday: number;
  progress: GoalProgress | null;  // null when no goal set
  movedToday: boolean;
  streak: number;
  sedentaryMins?: number | null;
}

// At most one, never a lecture. Order: how she feels > her body > her goal.
export function pickSuggestion(i: SuggestionInput): Suggestion | null {
  const busy = i.eventsToday >= 3;
  const shortSleep = i.sleepHours != null && i.sleepHours < 6;

  if (i.mood === "struggling" || i.energy === "low") {
    return busy
      ? { id: "low_busy", text: "Heavy day and low energy. Pick one thing to drop or hand off, and keep the rest simple." }
      : { id: "low", text: "Low-energy day. Something small still counts: 10 minutes outside, or an early night." };
  }
  if (shortSleep && busy) {
    return { id: "short_busy", text: `Busy day and a short night (${i.sleepHours}h). A 10-minute walk between things is plenty today.` };
  }
  if (shortSleep) {
    return { id: "short_sleep", text: `Short night (${i.sleepHours}h). Go easy today and aim for an earlier bedtime.` };
  }
  if (i.readiness != null && i.readiness < 60) {
    return { id: "low_readiness", text: "Your body's still recovering. A walk or a stretch beats a hard workout today." };
  }
  if (i.sedentaryMins != null && i.sedentaryMins >= 360 && i.hour >= 12 && i.hour < 20 && !i.movedToday) {
    return { id: "sedentary", text: "You've been still most of the day. Even a 10-minute walk helps." };
  }
  if (i.progress) {
    if (i.streak >= 3) return { id: "streak", text: `You've moved ${i.streak} days in a row, nice.` };
    if (i.progress.met) return { id: "goal_met", text: "You've hit your goal this week. Anything more is a bonus." };
    const needed = i.progress.target - i.progress.done;
    if (!i.movedToday && needed > 0 && needed >= i.progress.daysLeft && i.progress.daysLeft > 0) {
      return { id: "behind", text: `${needed} more day${needed === 1 ? "" : "s"} to hit your goal. Even 15 minutes today counts.` };
    }
    if (!i.movedToday && i.eventsToday <= 1 && i.hour >= 9 && i.hour < 19) {
      return { id: "quiet_day", text: "Your calendar is light today: a good window for a walk." };
    }
  }
  return null;
}

// ── Small habits (optional, off by default, max 3) ─────────────────
export const HABIT_CHOICES: { id: string; name: string; icon: string }[] = [
  { id: "water",   name: "Drink water",       icon: "💧" },
  { id: "stretch", name: "Stretch",           icon: "🧘" },
  { id: "read",    name: "Read a few pages",  icon: "📖" },
  { id: "outside", name: "Get outside",       icon: "☀️" },
  { id: "mindful", name: "5 quiet minutes",   icon: "🌿" },
  { id: "vitamins",name: "Take vitamins",     icon: "💊" },
];
export const MAX_HABITS = 3;

// Same shape the thrive doc's `habits` always had, so Cleo's "habits done
// today" keeps reading it.
export interface HabitRow { id: string; name: string; icon: string; category: string; done: boolean; streak: number; lastCompleted?: string; }

export function habitsFromPicks(picks: string[], existing: Partial<HabitRow>[] | undefined): HabitRow[] {
  const prev = new Map((existing || []).filter(Boolean).map(h => [h.id, h]));
  return picks.slice(0, MAX_HABITS).map(id => {
    const c = HABIT_CHOICES.find(h => h.id === id)!;
    const old = prev.get(id);
    return { id, name: c.name, icon: c.icon, category: "small", done: !!old?.done, streak: old?.streak || 0, ...(old?.lastCompleted ? { lastCompleted: old.lastCompleted } : {}) };
  });
}

export function isHabitDoneToday(h: { done?: boolean; lastCompleted?: string }, today: string): boolean {
  return !!h.done && h.lastCompleted === today;
}

export function toggleHabit(habits: HabitRow[], id: string, today: string): HabitRow[] {
  const yesterday = addDays(today, -1);
  return habits.map(h => {
    if (h.id !== id) return h;
    if (isHabitDoneToday(h, today)) {
      // Firestore rejects undefined, so drop the key rather than unset it
      const rest: HabitRow = { ...h, done: false, streak: 0 };
      delete rest.lastCompleted;
      return h.streak > 1 ? { ...rest, streak: h.streak - 1, lastCompleted: yesterday } : rest;
    }
    const streak = h.lastCompleted === yesterday || h.lastCompleted === today ? h.streak + 1 : 1;
    return { ...h, done: true, streak, lastCompleted: today };
  });
}

// ── This week, in plain words ──────────────────────────────────────
export function sleepForWeek(days: string[], w: WearableDay | null, sleepLog: StoredRow[] | undefined): number[] {
  const hist = new Map(((w?.history || []) as WearableDayPoint[]).map(p => [p.day, p.sleepHours]));
  const logged = new Map((sleepLog || []).filter(Boolean).map(l => [l.date, l.hours] as const));
  return days
    .map(d => hist.get(d) ?? logged.get(d) ?? null)
    .filter((h): h is number => typeof h === "number" && h > 0);
}

export function weekSummary(input: { sleepHours: number[]; movedDays: number | null; daysSoFar: number; moods: MoodFace[] }): string {
  const parts: string[] = [];
  if (input.sleepHours.length) {
    const avg = input.sleepHours.reduce((a, b) => a + b, 0) / input.sleepHours.length;
    parts.push(`Slept ${avg.toFixed(1)}h on average`);
  }
  if (input.movedDays != null) parts.push(`moved ${input.movedDays} of ${input.daysSoFar} day${input.daysSoFar === 1 ? "" : "s"}`);
  if (input.moods.length) {
    const count = (f: MoodFace) => input.moods.filter(m => m === f).length;
    const n = input.moods.length;
    const words =
      count("good") > n / 2 ? "mostly good days" :
      count("struggling") > n / 2 ? "mostly hard days" :
      count("okay") > n / 2 ? "mostly okay days" :
      "a mix of days";
    parts.push(words);
  }
  if (!parts.length) return "";
  const s = parts.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

export function moodsForWeek(days: string[], logs: StoredRow[] | undefined): MoodFace[] {
  const set = new Set(days);
  return (logs || [])
    .filter(l => l && set.has(l.date as string))
    .map(l => moodFaceFor(l))
    .filter((m): m is MoodFace => !!m);
}

// The message "Ask Cleo about this" opens with.
export function cleoWellnessPrompt(summary: string, goal: MoveGoal | null, progress: GoalProgress | null): string {
  const bits = [summary && `This week: ${summary}`, goal && progress && `My goal is "${goalLabel(goal)}" and I'm at ${progress.text.toLowerCase()}.`].filter(Boolean);
  return `${bits.join(" ")} What's one small thing that would help me feel better this week?`.trim();
}
