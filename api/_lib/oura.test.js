import { describe, it, expect } from "vitest";
import { pickMainSleep, resolveSleepScore, sleepHours } from "./oura.js";

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
