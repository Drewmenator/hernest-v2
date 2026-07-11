import { describe, it, expect } from "vitest";
import { nextDueDate, daysUntilDue } from "./bills.js";

const NOW = new Date(2026, 6, 11); // 2026-07-11

describe("server bills mirror", () => {
  it("monthly rolls to next month once passed", () => {
    expect(nextDueDate({ cadence: "monthly", dueDay: 5 }, NOW)).toBe("2026-08-05");
  });
  it("monthly stays this month if ahead", () => {
    expect(nextDueDate({ cadence: "monthly", dueDay: 20 }, NOW)).toBe("2026-07-20");
  });
  it("clamps day 31 to Feb", () => {
    expect(nextDueDate({ cadence: "monthly", dueDay: 31 }, new Date(2026, 1, 1))).toBe("2026-02-28");
  });
  it("daysUntilDue counts forward", () => {
    expect(daysUntilDue({ cadence: "monthly", dueDay: 14 }, NOW)).toBe(3);
  });
});
