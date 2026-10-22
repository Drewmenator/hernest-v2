import { describe, it, expect } from "vitest";
import { pickNudge, buildCheckinFallback, dayTone, checkinFacts } from "./thriveCheckin";
import { vsUsual, type WearableDay } from "./wellnessAutoTrack";

const base: WearableDay = {
  source: "oura", date: "2026-07-10",
  sleepHours: 7.2, sleepScore: 84, readiness: 78, steps: 4800,
  avgHrv: 45, restingHr: 58, readinessContributors: null,
  stressDay: "normal", stressHighMins: 60, recoveryHighMins: 90,
  activeCalories: 300, sedentaryMins: 200, activityScore: 75, history: [],
};

describe("pickNudge", () => {
  it("returns null with no wearable", () => {
    expect(pickNudge(null, 2, 15)).toBeNull();
  });

  it("prioritizes sedentary stretch in the afternoon", () => {
    const n = pickNudge({ ...base, sedentaryMins: 400 }, 6, 14);
    expect(n?.id).toBe("sedentary");
  });

  it("does not nudge sedentary in the morning or late evening", () => {
    expect(pickNudge({ ...base, sedentaryMins: 400 }, 6, 9)?.id).not.toBe("sedentary");
    expect(pickNudge({ ...base, sedentaryMins: 400 }, 6, 21)).toBeNull();
  });

  it("suggests protecting the evening after a stress-heavy day", () => {
    const n = pickNudge({ ...base, stressHighMins: 180, recoveryHighMins: 10 }, 6, 17);
    expect(n?.id).toBe("stress_evening");
  });

  it("nudges water late in the day when behind", () => {
    const n = pickNudge(base, 2, 16);
    expect(n?.id).toBe("water");
  });

  it("returns at most one nudge — sedentary beats water", () => {
    const n = pickNudge({ ...base, sedentaryMins: 400 }, 1, 16);
    expect(n?.id).toBe("sedentary");
  });

  it("stays quiet when all is well", () => {
    expect(pickNudge(base, 6, 10)).toBeNull();
  });
});

describe("buildCheckinFallback", () => {
  it("never asks how she feels, even with no data", () => {
    const t = buildCheckinFallback(null, "Andrew");
    expect(t).toContain("Andrew");
    expect(t).toContain("Apple Health or Oura");
    expect(t).not.toMatch(/\?|feel/i);
  });

  it("uses only real numbers and ends without a question", () => {
    const t = buildCheckinFallback(base, "Andrew");
    expect(t).toContain("7.2h");
    expect(t).toContain("78");
    expect(t).not.toMatch(/\?|how do you feel/i);
    expect(t).not.toContain("—");
  });

  it("is protective when readiness is low", () => {
    const t = buildCheckinFallback({ ...base, readiness: 45 }, "");
    expect(t.toLowerCase()).toContain("lighter day");
  });

  it("acknowledges a stressful yesterday", () => {
    const t = buildCheckinFallback({ ...base, stressDay: "stressful" }, "");
    expect(t.toLowerCase()).toContain("gentler");
  });
});

import { computeWeeklyScore } from "./thriveCheckin";

describe("computeWeeklyScore — body-first (no hydration/habits)", () => {
  const hist = [
    { sleepScore: 80, sleepHours: 7.5, readiness: 78 },
    { sleepScore: 90, sleepHours: 8, readiness: 85 },
  ];

  it("weights sleep 30 / readiness 30 / activity 20 / mood 20", () => {
    const { score, breakdown } = computeWeeklyScore(hist, [70, 80], [9, 9]);
    // sleep avg (8.0+9.0)/2=8.5, readiness (7.8+8.5)/2=8.15, activity 7.5, mood 10
    expect(breakdown.sleep).toBeCloseTo(8.5, 1);
    expect(breakdown.readiness).toBeCloseTo(8.15, 1);
    expect(breakdown.activity).toBeCloseTo(7.5, 1);
    expect(breakdown.mood).toBeCloseTo(10, 1);
    expect(score).toBeCloseTo(8.5 * 0.3 + 8.15 * 0.3 + 7.5 * 0.2 + 10 * 0.2, 1);
  });

  it("derives sleep from hours when no Oura score", () => {
    const { breakdown } = computeWeeklyScore([{ sleepScore: null, sleepHours: 7.5, readiness: 70 }], [], [6]);
    expect(breakdown.sleep).toBe(10); // 7-9h band
  });

  it("neutral 5s when there's no data at all", () => {
    const { score, breakdown } = computeWeeklyScore([], [], []);
    expect(breakdown).toEqual({ sleep: 5, readiness: 5, activity: 5, mood: 5 });
    expect(score).toBe(5);
  });
});

// An Apple Health day: no readiness, sleep score or stress. Heart data and a
// week of history from the iPhone.
const apple = (over: Partial<WearableDay> = {}): WearableDay => ({
  source: "apple_health", date: "2026-10-21",
  sleepHours: 7.4, sleepScore: null, readiness: null, steps: 6100,
  avgHrv: 52, restingHr: 61, readinessContributors: null,
  stressDay: null, stressHighMins: null, recoveryHighMins: null,
  activeCalories: null, sedentaryMins: null, activityScore: null,
  activeMins: 34, mindfulMins: 10,
  history: [
    { day: "2026-10-17", sleepHours: 7, sleepScore: null, readiness: null, hrv: 50, restingHr: 60, steps: 7000, stressDay: null },
    { day: "2026-10-18", sleepHours: 6.8, sleepScore: null, readiness: null, hrv: 48, restingHr: 62, steps: 5000, stressDay: null },
    { day: "2026-10-19", sleepHours: 7.5, sleepScore: null, readiness: null, hrv: 52, restingHr: 60, steps: 8000, stressDay: null },
    { day: "2026-10-20", sleepHours: 7.1, sleepScore: null, readiness: null, hrv: 50, restingHr: 61, steps: 6500, stressDay: null },
  ],
  ...over,
});

describe("Apple Health days: Cleo reads the body, doesn't ask", () => {
  it("compares today with her own usual, needing at least 3 earlier days", () => {
    expect(vsUsual(52, apple().history, "hrv", "2026-10-21")).toEqual({ usual: 50, diffPct: 4, word: "about" });
    expect(vsUsual(38, apple().history, "hrv", "2026-10-21")?.word).toBe("below");
    expect(vsUsual(52, apple().history.slice(0, 2), "hrv", "2026-10-21")).toBeNull();
    expect(vsUsual(null, apple().history, "hrv")).toBeNull();
  });

  it("sets the tone from sleep and heart data when there's no readiness", () => {
    expect(dayTone(apple())).toBe("strong");
    expect(dayTone(apple({ sleepHours: 5.2 }))).toBe("lighter");
    expect(dayTone(apple({ avgHrv: 38 }))).toBe("lighter"); // 24% below her usual
    expect(dayTone(apple({ sleepHours: 6.5 }))).toBe("steady");
    expect(dayTone({ ...base, readiness: 45 })).toBe("lighter"); // Oura still uses readiness
  });

  it("gives Cleo only measured facts, including active and mindful minutes", () => {
    const facts = checkinFacts(apple({ avgHrv: 38 })).join("\n");
    expect(facts).toContain("Heart rate variability: 38ms (below her usual 50ms)");
    expect(facts).toContain("Resting heart rate: 61bpm");
    expect(facts).toContain("Active minutes today: 34");
    expect(facts).toContain("Mindful minutes today: 10");
    expect(facts).not.toMatch(/Readiness|score|stress/i);
  });

  it("the fallback note mentions heart data below her usual without inventing a score", () => {
    const t = buildCheckinFallback(apple({ avgHrv: 38 }), "Amy");
    expect(t).toContain("heart rate variability is below your usual");
    expect(t).toContain("lighter day");
    expect(t).not.toMatch(/readiness|\?/i);
  });
});
