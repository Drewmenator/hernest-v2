import { describe, it, expect } from "vitest";
import { computeResilienceScore, rankAttention } from "./householdScores";
import type { AppContext } from "../contextBuilder";

// Only the fields the scores read. The old ctx.budget is deliberately absent:
// since the Oct 2026 Bills redesign the scores must not depend on it.
function ctx(bills: AppContext["bills"], extra: Partial<Record<string, unknown>> = {}): AppContext {
  return {
    tasks: { dueToday: [], overdue: [], total: 0, completionRate: 0.5 },
    calendar: { events: [], todayEvents: [], density: "light", conflicts: [] },
    school: { urgentToday: [], thisWeek: [] },
    trips: { next: null },
    thrive: { sleepTrend: [], moodTrend: [], habitsToday: 0, totalHabits: 0 },
    bills,
    ...extra,
  } as unknown as AppContext;
}

const noBills = { total: 0, overdue: [], dueSoon: [], noDate: 0 };

describe("rankAttention with bills", () => {
  it("flags an overdue bill as an alert pointing at Bills", () => {
    const items = rankAttention(ctx({ total: 3, overdue: [{ name: "Electric", amount: 142, days: -2 }], dueSoon: [], noDate: 0 }));
    const bill = items.find(i => i.id === "bills_overdue");
    expect(bill?.title).toBe("Electric is overdue");
    expect(bill?.severity).toBe("alert");
    expect(bill?.source).toBe("bills");
    expect(items[0].id).toBe("bills_overdue");
  });

  it("flags a bill due tomorrow, but not autopay or later bills", () => {
    const items = rankAttention(ctx({ total: 3, overdue: [], noDate: 0, dueSoon: [
      { name: "Rent", amount: 1800, days: 1, autopay: true },
      { name: "Phone", amount: 60, days: 1, autopay: false },
      { name: "Gym", amount: 30, days: 5, autopay: false },
    ] }));
    const soon = items.filter(i => i.id === "bills_due_soon");
    expect(soon).toHaveLength(1);
    expect(soon[0].title).toBe("Phone is due tomorrow");
    expect(soon[0].severity).toBe("watch");
  });

  it("says nothing about money when there are no bills", () => {
    const items = rankAttention(ctx(noBills));
    expect(items.some(i => ["bills", "budget", "goals"].includes(i.source))).toBe(false);
  });
});

describe("computeResilienceScore with bills", () => {
  it("has no savings, debt or goal components any more", () => {
    const keys = computeResilienceScore(ctx(noBills)).components.map(c => c.key);
    expect(keys).toEqual(["bills", "slack", "reserve"]);
  });

  it("drops when a bill is overdue", () => {
    const fine = computeResilienceScore(ctx({ total: 2, overdue: [], dueSoon: [], noDate: 0 })).score;
    const late = computeResilienceScore(ctx({ total: 2, overdue: [{ name: "Water", amount: null, days: -1 }], dueSoon: [], noDate: 0 })).score;
    expect(late).toBeLessThan(fine);
  });
});
