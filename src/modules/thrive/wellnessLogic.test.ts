import { describe, it, expect } from "vitest";
import {
  weekDays, saveMoodEntry, moodFaceFor, weekDots, goalProgress, moveStreak, activityByDay,
  pickSuggestion, habitsFromPicks, toggleHabit, isHabitDoneToday, weekSummary, sleepForWeek,
  moodsForWeek, goalLabel, isValidGoal, type MoveGoal, type SuggestionInput,
} from "./wellnessLogic";
import type { WearableDay } from "../../core/wellnessAutoTrack";

// 2026-10-21 is a Wednesday
const WED = "2026-10-21";
const mins30x3: MoveGoal = { type: "minutes", amount: 30, days: 3 };
const steps7k: MoveGoal = { type: "steps", amount: 7000, days: 7 };

const wearable = (over: Partial<WearableDay> = {}): WearableDay => ({
  source: "apple_health", date: WED, sleepHours: 7, sleepScore: null, readiness: null, steps: 3000,
  avgHrv: null, restingHr: null, readinessContributors: null, stressDay: null, stressHighMins: null,
  recoveryHighMins: null, activeCalories: null, sedentaryMins: null, activityScore: null, history: [], ...over,
});
const point = (day: string, o: { steps?: number; activeMins?: number; sleepHours?: number } = {}) => ({
  day, sleepHours: o.sleepHours ?? null, sleepScore: null, readiness: null, hrv: null, restingHr: null,
  steps: o.steps ?? null, stressDay: null, activeMins: o.activeMins ?? null,
});

describe("weekDays", () => {
  it("runs Sunday to Saturday around today", () => {
    expect(weekDays(WED)).toEqual(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
  });
  it("starts on today when today is Sunday", () => {
    expect(weekDays("2026-10-18")[0]).toBe("2026-10-18");
  });
  it("crosses month ends", () => {
    expect(weekDays("2026-11-01")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(weekDays("2026-10-31")[0]).toBe("2026-10-25");
  });
});

describe("saveMoodEntry (the thrive doc's moodLog format)", () => {
  it("appends today's entry with the old labels and 3/6/9 rating plus a 1-5 value", () => {
    const logs = saveMoodEntry([{ date: "2026-10-20", rating: 6, label: "Okay" }], WED, { face: "good" }, 1000);
    expect(logs).toEqual([
      { date: "2026-10-20", rating: 6, label: "Okay" },
      { date: WED, rating: 9, label: "Good", value: 4, at: 1000 },
    ]);
  });
  it("replaces today rather than adding a second entry, and keeps energy", () => {
    let logs = saveMoodEntry([], WED, { face: "struggling" }, 1);
    logs = saveMoodEntry(logs, WED, { energy: "low" }, 2);
    expect(logs).toEqual([{ date: WED, rating: 3, label: "Struggling", value: 2, energy: "low", at: 2 }]);
    logs = saveMoodEntry(logs, WED, { face: "okay" }, 3);
    expect(logs).toEqual([{ date: WED, rating: 6, label: "Okay", value: 3, energy: "low", at: 3 }]);
  });
  it("energy first defaults the face to Okay", () => {
    expect(saveMoodEntry(undefined, WED, { energy: "good" }, 5)[0]).toMatchObject({ label: "Okay", rating: 6, energy: "good" });
  });
  it("sorts oldest-first (old Home logger unshifted) and caps the log", () => {
    const old = Array.from({ length: 100 }, (_, i) => ({ date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}-${i}`, rating: 6, label: "Okay" }));
    const logs = saveMoodEntry([{ date: "2026-10-19", rating: 9, label: "Good" }, ...old, { date: "2026-10-01", rating: 3, label: "Hard" }], WED, { face: "good" });
    expect(logs.length).toBe(90);
    expect(logs[logs.length - 1].date).toBe(WED);
    expect(logs[logs.length - 2].date).toBe("2026-10-19");
  });
  it("reads old entries by label or rating, including the Home 'Hard'", () => {
    expect(moodFaceFor({ label: "Hard", rating: 3 })).toBe("struggling");
    expect(moodFaceFor({ label: "Good" })).toBe("good");
    expect(moodFaceFor({ rating: 6 })).toBe("okay");
    expect(moodFaceFor(null)).toBeNull();
  });
});

describe("week dots + goal progress", () => {
  it("fills dots from device minutes, manual taps, and leaves the future empty", () => {
    const activity = activityByDay(wearable({ history: [point("2026-10-18", { activeMins: 35 }), point("2026-10-19", { activeMins: 10 }), point("2026-10-20", { activeMins: 0 })] }));
    const dots = weekDots(mins30x3, WED, activity, ["2026-10-20"]);
    expect(dots.map(d => d.state)).toEqual(["moved", "missed", "moved", "today", "future", "future", "future"]);
    expect(dots[0].auto).toBe(true);
    expect(dots[2].auto).toBe(false);
    expect(dots.map(d => d.letter).join("")).toBe("SMTWTFS");
    const p = goalProgress(mins30x3, dots);
    expect(p).toMatchObject({ done: 2, target: 3, met: false, daysLeft: 4, text: "2 of 3 days" });
  });

  it("uses steps for a steps goal, including today's live steps", () => {
    const activity = activityByDay(wearable({ steps: 7200, history: [point("2026-10-20", { steps: 6999 }), point(WED, { steps: 5000 })] }));
    const dots = weekDots(steps7k, WED, activity);
    expect(dots[2].state).toBe("missed");
    expect(dots[3].state).toBe("moved");
  });

  it("reports goal met and extra days", () => {
    const dots = weekDots(mins30x3, WED, {}, ["2026-10-18", "2026-10-19", "2026-10-20", WED]);
    expect(goalProgress(mins30x3, dots)).toMatchObject({ done: 4, met: true, text: "Goal met, plus 1 extra" });
  });

  it("counts a streak through today, not breaking on a today not yet moved", () => {
    expect(moveStreak(weekDots(mins30x3, WED, {}, ["2026-10-18", "2026-10-19", "2026-10-20"]))).toBe(3);
    expect(moveStreak(weekDots(mins30x3, WED, {}, ["2026-10-19", "2026-10-20", WED]))).toBe(3);
    expect(moveStreak(weekDots(mins30x3, WED, {}, ["2026-10-18", "2026-10-20"]))).toBe(1);
  });

  it("labels and validates goals", () => {
    expect(goalLabel(steps7k)).toBe("7,000 steps a day");
    expect(goalLabel({ type: "minutes", amount: 45, days: 2 })).toBe("Move 45 min, 2 days a week");
    expect(isValidGoal({ type: "steps", amount: 0, days: 7 })).toBe(false);
    expect(isValidGoal(mins30x3)).toBe(true);
  });
});

describe("pickSuggestion", () => {
  const base: SuggestionInput = { hour: 10, sleepHours: 7.5, readiness: null, mood: null, energy: null, eventsToday: 2, progress: null, movedToday: false, streak: 0 };
  const progress = (done: number, target: number, daysLeft: number) => ({ done, target, daysLeft, met: done >= target, text: "" });

  it("returns nothing when there's nothing useful to say", () => {
    expect(pickSuggestion(base)).toBeNull();
  });
  it("puts how she feels first", () => {
    expect(pickSuggestion({ ...base, energy: "low", sleepHours: 5 })?.id).toBe("low");
    expect(pickSuggestion({ ...base, mood: "struggling", eventsToday: 4 })?.id).toBe("low_busy");
  });
  it("links short sleep to a busy calendar", () => {
    const s = pickSuggestion({ ...base, sleepHours: 5.4, eventsToday: 3 });
    expect(s?.id).toBe("short_busy");
    expect(s?.text).toContain("5.4h");
    expect(pickSuggestion({ ...base, sleepHours: 5.4, eventsToday: 1 })?.id).toBe("short_sleep");
  });
  it("celebrates a streak, then a met goal", () => {
    expect(pickSuggestion({ ...base, progress: progress(3, 3, 3), streak: 3 })?.text).toBe("You've moved 3 days in a row, nice.");
    expect(pickSuggestion({ ...base, progress: progress(3, 3, 3), streak: 1 })?.id).toBe("goal_met");
  });
  it("nudges only when she'd fall short otherwise", () => {
    expect(pickSuggestion({ ...base, progress: progress(1, 3, 2) })?.text).toBe("2 more days to hit your goal. Even 15 minutes today counts.");
    expect(pickSuggestion({ ...base, progress: progress(1, 3, 4) })).toBeNull();
    expect(pickSuggestion({ ...base, progress: progress(1, 3, 2), movedToday: true })).toBeNull();
  });
  it("spots a light calendar as a window to move", () => {
    expect(pickSuggestion({ ...base, eventsToday: 0, progress: progress(0, 3, 5) })?.id).toBe("quiet_day");
    expect(pickSuggestion({ ...base, eventsToday: 0, hour: 21, progress: progress(0, 3, 5) })).toBeNull();
  });
});

describe("small habits", () => {
  it("builds up to 3 rows in the old habit shape, keeping streaks", () => {
    const rows = habitsFromPicks(["water", "read", "stretch", "outside"], [{ id: "water", streak: 4, done: true, lastCompleted: "2026-10-20" }]);
    expect(rows.map(r => r.id)).toEqual(["water", "read", "stretch"]);
    expect(rows[0]).toMatchObject({ streak: 4, lastCompleted: "2026-10-20", name: "Drink water" });
    expect(rows[1]).not.toHaveProperty("lastCompleted");
  });
  it("ticks and unticks without undefined fields", () => {
    let rows = habitsFromPicks(["water"], [{ id: "water", streak: 2, done: true, lastCompleted: "2026-10-20" }]);
    expect(isHabitDoneToday(rows[0], WED)).toBe(false);
    rows = toggleHabit(rows, "water", WED);
    expect(rows[0]).toMatchObject({ done: true, streak: 3, lastCompleted: WED });
    rows = toggleHabit(rows, "water", WED);
    expect(rows[0]).toMatchObject({ done: false, streak: 2, lastCompleted: "2026-10-20" });
    const fresh = toggleHabit(toggleHabit(habitsFromPicks(["read"], []), "read", WED), "read", WED)[0];
    expect(fresh).toEqual({ id: "read", name: "Read a few pages", icon: "📖", category: "small", done: false, streak: 0 });
  });
});

describe("this week summary", () => {
  it("writes a plain line from what's known, no grade", () => {
    const days = weekDays(WED);
    const sleep = sleepForWeek(days, wearable({ history: [point("2026-10-18", { sleepHours: 6.5 }), point("2026-10-19", { sleepHours: 7.1 })] }), [{ date: "2026-10-20", hours: 6.8 }, { date: "2026-09-01", hours: 9 }]);
    expect(sleep).toEqual([6.5, 7.1, 6.8]);
    const moods = moodsForWeek(days, [{ date: "2026-10-19", label: "Good" }, { date: "2026-10-20", label: "Good" }, { date: WED, label: "Okay" }, { date: "2026-10-01", label: "Hard" }]);
    expect(weekSummary({ sleepHours: sleep, movedDays: 2, daysSoFar: 4, moods })).toBe("Slept 6.8h on average · moved 2 of 4 days · mostly good days.");
  });
  it("skips what it doesn't know", () => {
    expect(weekSummary({ sleepHours: [], movedDays: null, daysSoFar: 4, moods: ["okay", "struggling"] })).toBe("A mix of days.");
    expect(weekSummary({ sleepHours: [], movedDays: null, daysSoFar: 4, moods: [] })).toBe("");
  });
});
