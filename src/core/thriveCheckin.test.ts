import { describe, it, expect } from "vitest";
import { pickNudge, buildCheckinFallback } from "./thriveCheckin";
import type { WearableDay } from "./wellnessAutoTrack";

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
  it("asks the mood question with no data", () => {
    const t = buildCheckinFallback(null, "Andrew");
    expect(t).toContain("Andrew");
    expect(t.toLowerCase()).toContain("how are you feeling");
  });

  it("uses only real numbers", () => {
    const t = buildCheckinFallback(base, "Andrew");
    expect(t).toContain("7.2h");
    expect(t).toContain("78");
    expect(t.toLowerCase()).toContain("how do you feel");
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
