import { describe, it, expect } from "vitest";
import { computeAge, daysUntilBirthday, isBirthdayToday, turningAge } from "./dates.js";

// Mirror of src/core/dateAwareness.test.ts — keep the two in sync.
const NOW = new Date(2026, 6, 11); // 2026-07-11

describe("server dates mirror", () => {
  it("computeAge: June born 2019-07-05 is 7 (birthday passed)", () => {
    expect(computeAge("2019-07-05", NOW)).toBe(7);
  });
  it("computeAge: null without a year", () => {
    expect(computeAge("07-05", NOW)).toBeNull();
  });
  it("daysUntilBirthday handles YYYY-MM-DD and MM-DD", () => {
    expect(daysUntilBirthday("2019-07-18", NOW)).toBe(7);
    expect(daysUntilBirthday("07-18", NOW)).toBe(7);
  });
  it("isBirthdayToday", () => {
    expect(isBirthdayToday("2019-07-11", NOW)).toBe(true);
    expect(isBirthdayToday("2019-07-12", NOW)).toBe(false);
  });
  it("turningAge is the new age on the day", () => {
    expect(turningAge("2019-07-11", NOW)).toBe(7);
  });
});
