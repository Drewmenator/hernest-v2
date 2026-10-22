import { describe, it, expect, vi, beforeEach } from "vitest";
const store: Record<string, unknown> = {};
vi.mock("./firebase", () => ({
  loadData: vi.fn(async (_u: string, k: string) => store[k] ?? null),
  saveData: vi.fn(async (_u: string, k: string, d: Record<string, unknown>) => { store[k] = { ...(store[k] as object || {}), ...d }; }),
}));
import { isPicked, saveCalendarChoice, loadCalendarChoice } from "./calendarChoice";

describe("isPicked", () => {
  it("before choosing: own calendars in, shared ones out", () => {
    expect(isPicked("mine", true, undefined)).toBe(true);
    expect(isPicked("colleague", false, undefined)).toBe(false);
  });
  it("after choosing: the ticks win; new calendars follow the default", () => {
    const c = { picked: ["colleague"], seen: ["mine", "colleague"] };
    expect(isPicked("mine", true, c)).toBe(false);
    expect(isPicked("colleague", false, c)).toBe(true);
    expect(isPicked("new", true, c)).toBe(true);
  });
});

describe("saveCalendarChoice", () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });
  it("records what was shown and ticked, keeping other sources", async () => {
    await saveCalendarChoice("u", "google", [{ id: "g1", picked: true }]);
    await saveCalendarChoice("u", "device", [{ id: "d1", picked: false }, { id: "d2", picked: true }]);
    const c = await loadCalendarChoice("u");
    expect(c.google).toEqual({ picked: ["g1"], seen: ["g1"] });
    expect(c.device).toEqual({ picked: ["d2"], seen: ["d1", "d2"] });
  });
});
