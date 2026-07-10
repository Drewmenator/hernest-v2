import { describe, it, expect } from "vitest";
import { pickMainSleep, resolveSleepScore, sleepHours, buildOuraHistory } from "./oura.js";

describe("pickMainSleep — the 0.1h bug", () => {
  it("picks the main long_sleep, not a nap fragment (regression: 0.1h vs 84 score)", () => {
    const periods = [
      { day: "2026-07-11", type: "late_nap", total_sleep_duration: 360 },      // 6 min nap
      { day: "2026-07-11", type: "long_sleep", total_sleep_duration: 27000 },  // 7.5h night
    ];
    const main = pickMainSleep(periods);
    expect(main.total_sleep_duration).toBe(27000);
    expect(sleepHours(main)).toBe(7.5);
  });

  it("with multiple long_sleep on the latest day, takes the longest", () => {
    const periods = [
      { day: "2026-07-11", type: "long_sleep", total_sleep_duration: 3600 },
      { day: "2026-07-11", type: "long_sleep", total_sleep_duration: 25200 },
    ];
    expect(sleepHours(pickMainSleep(periods))).toBe(7);
  });

  it("prefers the most recent day", () => {
    const periods = [
      { day: "2026-07-09", type: "long_sleep", total_sleep_duration: 28800 },
      { day: "2026-07-11", type: "long_sleep", total_sleep_duration: 25200 },
    ];
    expect(pickMainSleep(periods).day).toBe("2026-07-11");
  });

  it("falls back to any period when types are absent", () => {
    const periods = [{ day: "2026-07-11", total_sleep_duration: 26000 }];
    expect(sleepHours(pickMainSleep(periods))).toBe(7.2);
  });

  it("ignores zero-duration periods and returns null when nothing valid", () => {
    expect(pickMainSleep([{ day: "2026-07-11", total_sleep_duration: 0 }])).toBeNull();
    expect(pickMainSleep([])).toBeNull();
    expect(pickMainSleep(undefined)).toBeNull();
  });
});

describe("resolveSleepScore — score lives on /daily_sleep, not /sleep", () => {
  it("matches the score to the night's day", () => {
    const daily = [{ day: "2026-07-10", score: 71 }, { day: "2026-07-11", score: 84 }];
    expect(resolveSleepScore(daily, "2026-07-11")).toBe(84);
  });

  it("falls back to the newest daily_sleep if the exact day isn't present", () => {
    const daily = [{ day: "2026-07-10", score: 71 }, { day: "2026-07-11", score: 84 }];
    expect(resolveSleepScore(daily, "2026-07-12")).toBe(84);
  });

  it("returns null with no data", () => {
    expect(resolveSleepScore([], "2026-07-11")).toBeNull();
    expect(resolveSleepScore(undefined, "2026-07-11")).toBeNull();
  });
});

describe("buildOuraHistory — trend sparklines", () => {
  it("joins the daily collections by day, sleep hours from the long_sleep period", () => {
    const sleepPeriods = [
      { day: "2026-07-10", type: "long_sleep", total_sleep_duration: 25200, average_hrv: 40, lowest_heart_rate: 55 },
      { day: "2026-07-10", type: "late_nap", total_sleep_duration: 600 },
      { day: "2026-07-11", type: "long_sleep", total_sleep_duration: 27000, average_hrv: 46, lowest_heart_rate: 52 },
    ];
    const dailySleep = [{ day: "2026-07-10", score: 71 }, { day: "2026-07-11", score: 84 }];
    const readiness = [{ day: "2026-07-10", score: 68 }, { day: "2026-07-11", score: 79 }];
    const activity = [{ day: "2026-07-10", steps: 5200 }, { day: "2026-07-11", steps: 8100 }];
    const stress = [{ day: "2026-07-11", day_summary: "restored" }];
    const h = buildOuraHistory(sleepPeriods, dailySleep, readiness, activity, stress);
    expect(h).toHaveLength(2);
    expect(h[1]).toMatchObject({ day: "2026-07-11", sleepHours: 7.5, sleepScore: 84, readiness: 79, hrv: 46, steps: 8100, stressDay: "restored" });
    expect(h[0].sleepHours).toBe(7); // 25200s, not the 600s nap
  });

  it("returns [] when everything is empty", () => {
    expect(buildOuraHistory([], [], [], [], [])).toEqual([]);
    expect(buildOuraHistory()).toEqual([]);
  });
});
