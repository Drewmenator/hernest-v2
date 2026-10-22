import { describe, it, expect, vi } from "vitest";
vi.mock("./firebase", () => ({ auth: {}, loadData: vi.fn(), saveData: vi.fn(), db: {} }));
vi.mock("./events", () => ({ bus: { publish: vi.fn() } }));
import { mergeSyncedEvents } from "./connectorSync";

const range = { from: "2026-10-20", to: "2026-11-20" };

describe("mergeSyncedEvents", () => {
  it("drops my cancelled events in the synced range when the list is complete", () => {
    const existing = [
      { id: "a", source: "google", syncedBy: "me", date: "2026-10-25" },   // cancelled
      { id: "b", source: "google", syncedBy: "me", date: "2026-10-26" },
      { id: "p", source: "google", syncedBy: "partner", date: "2026-10-25" }, // partner's
      { id: "o", source: "google", syncedBy: "me", date: "2026-12-01" },   // outside range
      { id: "w", source: "work", syncedBy: "me", date: "2026-10-25" },     // other source
    ];
    const out = mergeSyncedEvents(existing, [{ id: "b", source: "google", date: "2026-10-27" }], "me", "google", { complete: true, range });
    expect(out.map(e => e.id).sort()).toEqual(["b", "o", "p", "w"]);
    expect(out.find(e => e.id === "b")).toMatchObject({ date: "2026-10-27", syncedBy: "me" });
  });

  it("only merges when the list may be partial", () => {
    const existing = [{ id: "a", source: "google", syncedBy: "me", date: "2026-10-25" }];
    const out = mergeSyncedEvents(existing, [], "me", "google", { complete: false, range });
    expect(out.map(e => e.id)).toEqual(["a"]);
  });

  it("clears older untagged events too (saved before syncs were tagged)", () => {
    const existing = [{ id: "old", source: "google", date: "2026-10-25" }];
    const out = mergeSyncedEvents(existing, [], "me", "google", { complete: true, range });
    expect(out).toEqual([]);
  });

  it("iPhone sync clears only iPhone events, not web iCloud or Google ones", () => {
    const existing = [
      { id: "device_colleague_1", source: "apple", syncedBy: "me", date: "2026-10-25" },
      { id: "apple_web_1", source: "apple", syncedBy: "me", date: "2026-10-25" },
      { id: "google_1", source: "google", syncedBy: "me", date: "2026-10-25" },
    ];
    const out = mergeSyncedEvents(existing, [{ id: "device_mine_1", source: "apple", date: "2026-10-26" }], "me", "device", { complete: true, range });
    expect(out.map(e => e.id).sort()).toEqual(["apple_web_1", "device_mine_1", "google_1"]);
  });

  it("drops events older than the cutoff", () => {
    const out = mergeSyncedEvents([{ id: "x", date: "2026-10-01" }], [], "me", "google", {}, "2026-10-15");
    expect(out).toEqual([]);
  });
});

import { weekChanged } from "./connectorSync";
describe("weekChanged", () => {
  const now = new Date(2026, 9, 22, 10);
  it("is true when an event in the next 7 days was removed or moved", () => {
    const a = [{ id: "x", date: "2026-10-23", title: "Asher vaccines" }];
    expect(weekChanged(a, [], now)).toBe(true);
    expect(weekChanged(a, [{ ...a[0], date: "2026-10-24" }], now)).toBe(true);
  });
  it("ignores changes further out and identical lists", () => {
    const far = [{ id: "y", date: "2026-11-20", title: "Later" }];
    expect(weekChanged(far, [], now)).toBe(false);
    const same = [{ id: "x", date: "2026-10-23", title: "A" }];
    expect(weekChanged(same, [{ ...same[0], syncedBy: "me" }], now)).toBe(false);
  });
});
