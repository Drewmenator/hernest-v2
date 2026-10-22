import { describe, it, expect, vi } from "vitest";

vi.mock("../../core/firebase", () => ({ loadData: vi.fn(), saveData: vi.fn(), db: {}, auth: {} }));
vi.mock("../../core/events", () => ({ bus: { publish: vi.fn(() => Promise.resolve()) } }));
vi.mock("../../core/deviceCalendar", () => ({
  deviceCalendarSupported: () => false, deviceCalendarConnected: vi.fn(), readDeviceCalendar: vi.fn(),
}));

import { mergeEventsById, type CalEvent } from "./useCalendarEvents";

const ev = (id: string, title: string, date = "2026-10-22"): CalEvent => ({ id, title, date, source: "google" });

describe("mergeEventsById", () => {
  it("replaces an event with the incoming version of the same id", () => {
    const out = mergeEventsById([ev("a", "Dentist", "2026-10-22"), ev("b", "Soccer")], [ev("a", "Dentist (moved)", "2026-10-24")]);
    expect(out).toEqual([ev("a", "Dentist (moved)", "2026-10-24"), ev("b", "Soccer")]);
  });

  it("adds new events at the end and keeps the rest", () => {
    const out = mergeEventsById([ev("a", "A")], [ev("c", "C")]);
    expect(out.map(e => e.id)).toEqual(["a", "c"]);
  });

  it("ignores incoming events without an id", () => {
    const out = mergeEventsById([ev("a", "A")], [{ ...ev("", "No id") }]);
    expect(out).toEqual([ev("a", "A")]);
  });
});
