import { describe, it, expect } from "vitest";
import { nextDueDate, daysUntilDue } from "./bills";

const NOW = new Date(2026, 6, 11); // 2026-07-11 (local)

describe("nextDueDate", () => {
  it("monthly: rolls to next month once the day has passed", () => {
    expect(nextDueDate({ cadence: "monthly", dueDay: 5 }, NOW)).toBe("2026-08-05");
  });
  it("monthly: this month if the day is still ahead", () => {
    expect(nextDueDate({ cadence: "monthly", dueDay: 20 }, NOW)).toBe("2026-07-20");
  });
  it("monthly: due today counts as today", () => {
    expect(nextDueDate({ cadence: "monthly", dueDay: 11 }, NOW)).toBe("2026-07-11");
  });
  it("monthly: clamps day 31 to a short month (Feb)", () => {
    expect(nextDueDate({ cadence: "monthly", dueDay: 31 }, new Date(2026, 1, 1))).toBe("2026-02-28");
  });
  it("yearly: next anniversary of the anchor", () => {
    expect(nextDueDate({ cadence: "yearly", dueDate: "2020-03-15" }, NOW)).toBe("2027-03-15");
    expect(nextDueDate({ cadence: "yearly", dueDate: "2020-09-01" }, NOW)).toBe("2026-09-01");
  });
  it("weekly: advances by 7 from the anchor to on/after today", () => {
    expect(nextDueDate({ cadence: "weekly", dueDate: "2026-07-06" }, NOW)).toBe("2026-07-13");
  });
  it("once: returns the fixed date", () => {
    expect(nextDueDate({ cadence: "once", dueDate: "2026-12-01" }, NOW)).toBe("2026-12-01");
  });
});

describe("daysUntilDue", () => {
  it("0 on the due day", () => {
    expect(daysUntilDue({ cadence: "monthly", dueDay: 11 }, NOW)).toBe(0);
  });
  it("counts forward", () => {
    expect(daysUntilDue({ cadence: "monthly", dueDay: 14 }, NOW)).toBe(3);
  });
  it("null when uncomputable", () => {
    expect(daysUntilDue({ cadence: "once" }, NOW)).toBeNull();
  });
});
