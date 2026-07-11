import { describe, it, expect } from "vitest";
import { parseDateParts, computeAge, daysUntilBirthday, isBirthdayToday, turningAge, displayAge, todayLocal } from "./dateAwareness";

// Fixed "now" so tests are deterministic: 2026-07-11.
const NOW = new Date(2026, 6, 11);

describe("todayLocal", () => {
  it("formats the local date (not UTC-shifted)", () => {
    expect(todayLocal(new Date(2026, 6, 11))).toBe("2026-07-11");
    expect(todayLocal(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("parseDateParts", () => {
  it("parses YYYY-MM-DD (date-picker format)", () => {
    expect(parseDateParts("2019-07-05")).toEqual({ year: 2019, month: 7, day: 5 });
  });
  it("parses bare MM-DD (legacy, no year)", () => {
    expect(parseDateParts("07-05")).toEqual({ month: 7, day: 5 });
  });
  it("rejects junk", () => {
    expect(parseDateParts("")).toBeNull();
    expect(parseDateParts(null)).toBeNull();
    expect(parseDateParts("not-a-date")).toBeNull();
  });
});

describe("computeAge — the June bug", () => {
  it("June born 2019-07-05 is 7 on 2026-07-11 (birthday already passed)", () => {
    expect(computeAge("2019-07-05", NOW)).toBe(7);
  });
  it("is still 6 the day before her birthday", () => {
    expect(computeAge("2019-07-05", new Date(2026, 6, 4))).toBe(6);
  });
  it("turns 7 exactly on her birthday", () => {
    expect(computeAge("2019-07-05", new Date(2026, 6, 5))).toBe(7);
  });
  it("returns null without a birth year (MM-DD can't yield an age)", () => {
    expect(computeAge("07-05", NOW)).toBeNull();
  });
});

describe("daysUntilBirthday", () => {
  it("0 on the birthday", () => {
    expect(daysUntilBirthday("2019-07-11", NOW)).toBe(0);
  });
  it("counts forward within the year", () => {
    expect(daysUntilBirthday("2019-07-18", NOW)).toBe(7);
  });
  it("rolls to next year once passed", () => {
    expect(daysUntilBirthday("2019-07-05", NOW)).toBe(359);
  });
  it("works with legacy MM-DD", () => {
    expect(daysUntilBirthday("07-18", NOW)).toBe(7);
  });
});

describe("isBirthdayToday", () => {
  it("true on the day regardless of year format", () => {
    expect(isBirthdayToday("2019-07-11", NOW)).toBe(true);
    expect(isBirthdayToday("07-11", NOW)).toBe(true);
  });
  it("false otherwise", () => {
    expect(isBirthdayToday("2019-07-12", NOW)).toBe(false);
  });
});

describe("turningAge", () => {
  it("is the new age on the birthday", () => {
    expect(turningAge("2019-07-11", NOW)).toBe(7);
  });
  it("is the upcoming age before the birthday", () => {
    expect(turningAge("2019-12-25", NOW)).toBe(7); // currently 6, turns 7 in Dec
  });
});

describe("displayAge", () => {
  it("prefers live DOB over a stale stored age", () => {
    expect(displayAge({ birthDate: "2019-07-05", age: 6 })).toBe(7);
  });
  it("falls back to stored age when no DOB", () => {
    expect(displayAge({ age: 6 })).toBe(6);
  });
  it("null when neither is usable", () => {
    expect(displayAge({ birthDate: "07-05" })).toBeNull();
  });
});
