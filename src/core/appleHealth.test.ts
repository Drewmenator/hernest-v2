import { describe, it, expect, vi } from "vitest";
import type { HealthSample } from "@capgo/capacitor-health";

vi.mock("./firebase", () => ({ loadData: vi.fn(), saveData: vi.fn() }));
import { sleepHoursByNight, localDay } from "./appleHealth";

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const sample = (start: string, end: string, extra: Partial<HealthSample> = {}): HealthSample =>
  ({ dataType: "sleep", value: 0, unit: "minute", startDate: start, endDate: end, sourceName: "Watch", ...extra });

describe("sleepHoursByNight", () => {
  it("counts asleep time only, keyed by the day you woke up", () => {
    const res = sleepHoursByNight([
      sample(at(2026, 10, 20, 22, 30), at(2026, 10, 20, 23, 0), { sleepState: "inBed" }),
      sample(at(2026, 10, 20, 23, 0), at(2026, 10, 21, 3, 0), { sleepState: "deep" }),
      sample(at(2026, 10, 21, 3, 0), at(2026, 10, 21, 3, 30), { sleepState: "awake" }),
      sample(at(2026, 10, 21, 3, 30), at(2026, 10, 21, 6, 30), { sleepState: "rem" }),
    ]);
    expect(res[localDay(at(2026, 10, 21, 7))]).toBe(7);
  });

  it("uses stage data when present", () => {
    const res = sleepHoursByNight([sample(at(2026, 10, 20, 23), at(2026, 10, 21, 7), {
      hasStageData: true,
      stages: [
        { startDate: "", endDate: "", stage: "light", durationMinutes: 300 },
        { startDate: "", endDate: "", stage: "awake", durationMinutes: 60 },
        { startDate: "", endDate: "", stage: "deep", durationMinutes: 60 },
      ],
    })]);
    expect(res[localDay(at(2026, 10, 21, 7))]).toBe(6);
  });

  it("takes the fullest source instead of adding Watch and iPhone together", () => {
    const night = [at(2026, 10, 20, 23), at(2026, 10, 21, 6)] as const;
    const res = sleepHoursByNight([
      sample(night[0], night[1], { sourceName: "Watch", sleepState: "asleep" }),
      sample(night[0], at(2026, 10, 21, 5), { sourceName: "iPhone", sleepState: "asleep" }),
    ]);
    expect(res[localDay(night[1])]).toBe(7);
  });
});
