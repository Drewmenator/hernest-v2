import { describe, it, expect, vi } from "vitest";
vi.mock("../firebase", () => ({ loadData: vi.fn() }));
import { snapshotFrom } from "./householdSnapshot";

const NOW = new Date("2026-10-21T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString().split("T")[0];

describe("household snapshot (no money)", () => {
  it("a quiet week is light and low stress", () => {
    const s = snapshotFrom({ calendar: { events: [{ date: day(1) }] } }, NOW);
    expect(s).toMatchObject({ calendarLoad: "light", householdStressLevel: "low" });
    expect(s.upcomingTrip).toBeUndefined();
  });
  it("a packed week, short sleep and a trip add up to high stress", () => {
    const events = Array.from({ length: 12 }, (_, i) => ({ date: day(i % 6) }));
    const s = snapshotFrom({
      calendar: { events },
      thrive: { sleepLog: [{ hours: 4.5 }, { hours: 5 }], moodLog: [{ value: 3 }] },
      trips: { trips: [{ destination: "Orlando", departureDate: day(5) }] },
    }, NOW);
    expect(s.calendarLoad).toBe("critical");
    expect(s.householdStressLevel).toBe("high");
    expect(s.upcomingTrip).toEqual({ name: "Orlando", daysUntil: 5 });
  });
  it("trips more than two weeks out don't count", () => {
    const s = snapshotFrom({ trips: { trips: [{ destination: "Paris", departureDate: day(30) }] } }, NOW);
    expect(s.upcomingTrip).toBeUndefined();
  });
});
