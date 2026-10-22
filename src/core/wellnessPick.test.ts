import { describe, it, expect } from "vitest";
import { pickWearable, type WearableDay } from "./wellnessAutoTrack";

const base: Omit<WearableDay, "source" | "date"> = {
  sleepHours: 7, sleepScore: null, readiness: null, steps: null, avgHrv: null, restingHr: null,
  readinessContributors: null, stressDay: null, stressHighMins: null, recoveryHighMins: null,
  activeCalories: null, sedentaryMins: null, activityScore: null, history: [],
};

describe("which wearable's sleep to show", () => {
  it("the newest night wins, even over Oura", () => {
    const r = pickWearable([{ ...base, source: "oura", date: "2026-10-21" }, { ...base, source: "apple_health", date: "2026-10-22" }]);
    expect(r?.source).toBe("apple_health");
  });
  it("Oura wins when both have the same night", () => {
    const r = pickWearable([{ ...base, source: "apple_health", date: "2026-10-22" }, { ...base, source: "oura", date: "2026-10-22" }]);
    expect(r?.source).toBe("oura");
  });
  it("nothing recent means nothing to show", () => {
    expect(pickWearable([])).toBeNull();
  });
});
