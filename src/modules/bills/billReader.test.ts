import { describe, it, expect } from "vitest";
import { extractJSON, sanitizeSuggestions, suggestionToBill } from "./billReader";
import { nextDueDate, type Bill } from "../../core/bills";

describe("extractJSON", () => {
  it("reads JSON inside code fences and chatter", () => {
    expect(extractJSON('Here you go:\n```json\n{"bills":[]}\n```')).toEqual({ bills: [] });
  });
  it("returns null for junk", () => {
    expect(extractJSON("sorry, I can't")).toBeNull();
  });
});

describe("sanitizeSuggestions", () => {
  const existing: Bill[] = [{ id: "1", name: "Netflix", cadence: "monthly", dueDay: 12 }];

  it("keeps clean bills and flags low confidence", () => {
    const out = sanitizeSuggestions({ bills: [
      { name: "Spotify", amount: 11.99, cadence: "monthly", dueDay: 3, confidence: "high" },
      { name: "Electric", amount: null, cadence: "monthly", dueDay: 18, confidence: "low" },
    ] }, existing);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: "Spotify", amount: 11.99, dueDay: 3, unsure: false });
    expect(out[1]).toMatchObject({ name: "Electric", dueDay: 18, unsure: true });
    expect(out[1].amount).toBeUndefined();
  });

  it("marks bills you already have and drops repeats", () => {
    const out = sanitizeSuggestions({ bills: [
      { name: "NETFLIX.COM", amount: 15.49, cadence: "monthly", dueDay: 12, confidence: "high" },
      { name: "Netflix", amount: 15.49, cadence: "monthly", dueDay: 12, confidence: "high" },
    ] }, existing);
    expect(out).toHaveLength(1);
    expect(out[0].duplicateOf).toBe("Netflix");
  });

  it("rejects impossible values instead of passing them on", () => {
    const out = sanitizeSuggestions({ bills: [
      { name: "  Gym  ", amount: -5, cadence: "fortnightly", dueDay: 45, dueDate: "next week", confidence: "high" },
      { name: "", amount: 10 },
      "not an object",
    ] }, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "Gym", cadence: "monthly", unsure: true });
    expect(out[0].amount).toBeUndefined();
    expect(out[0].dueDay).toBeUndefined();
  });

  it("uses the day from a date for monthly bills, keeps dates for others", () => {
    const out = sanitizeSuggestions({ bills: [
      { name: "Phone", cadence: "monthly", dueDate: "2026-10-27", confidence: "high" },
      { name: "Car insurance", amount: 620, cadence: "semiannual", dueDate: "2027-03-01", confidence: "high" },
    ] }, []);
    expect(out[0].dueDay).toBe(27);
    expect(out[1]).toMatchObject({ dueDate: "2027-03-01", unsure: false });
  });

  it("handles a missing bills list", () => {
    expect(sanitizeSuggestions(null, [])).toEqual([]);
    expect(sanitizeSuggestions({ bills: "x" }, [])).toEqual([]);
  });
});

describe("suggestionToBill", () => {
  it("a bill without a date is saved as needing one", () => {
    const b = suggestionToBill({ key: "e", name: "Electric", cadence: "monthly", unsure: true }, "screenshot", new Date(2026, 9, 21));
    expect(b).toMatchObject({ name: "Electric", dueUnknown: true, addedOn: "2026-10-21", source: "screenshot" });
    expect(nextDueDate(b, new Date(2026, 9, 21))).toBeNull();
  });
});
