// Adversarial privacy tests: private activity must never reach the shared
// household log (readable by every member) or a partner notification.
import { describe, it, expect, vi, beforeEach } from "vitest";

const setDoc = vi.fn(() => Promise.resolve());
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(), doc: vi.fn((...a: unknown[]) => a.join("/")), setDoc: (...a: unknown[]) => setDoc(...(a as [])),
  getDocs: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
}));
vi.mock("./firebase", () => ({ db: {}, auth: { currentUser: null } }));
vi.mock("./db", () => ({ db: { events: { put: vi.fn(() => Promise.resolve()) } } }));
const notifyHousehold = vi.fn(() => Promise.resolve());
vi.mock("./pushNotifications", () => ({ notifyHousehold: (...a: unknown[]) => notifyHousehold(...(a as [])) }));
vi.mock("./identity", () => ({ getHouseholdId: () => "alice" }));

import { bus, effectiveVisibility, isSharedEventType } from "./events";

const flush = () => new Promise(r => setTimeout(r, 0));
const cloudWrites = () => setDoc.mock.calls.map(c => (c as unknown[])[1] as { type: string; shared?: boolean });

beforeEach(() => { setDoc.mockClear(); notifyHousehold.mockClear(); });

describe("event privacy", () => {
  const PRIVATE = [
    ["cleo.conversation.ended", { messages: [{ role: "user", content: "I feel overwhelmed" }] }],
    ["cleo.crisis.detected", { message: "I can't cope" }],
    ["thrive.mood.logged", { rating: 1 }],
    ["thrive.sleep.logged", { hours: 4 }],
    ["profile.updated", { challenge: "my marriage" }],
    ["style.preference.updated", { bodyShape: "pear" }],
    ["cleo.memory.updated", { added: 1 }],
    ["budget.receipts.found", { count: 2 }],
  ] as const;

  for (const [type, payload] of PRIVATE) {
    it(`${type} stays off the shared log and never notifies a partner`, async () => {
      await bus.publish(type, payload, { userId: "alice", source: "test", visibility: "household" });
      await flush();
      expect(cloudWrites()).toEqual([]);
      expect(notifyHousehold).not.toHaveBeenCalled();
    });
  }

  it("shared household events are mirrored, marked shared", async () => {
    await bus.publish("plan.task.created", { title: "Permission slip" }, { userId: "alice", source: "test" });
    await flush();
    expect(cloudWrites()).toHaveLength(1);
    expect(cloudWrites()[0]).toMatchObject({ type: "plan.task.created", shared: true, visibility: "household" });
  });

  it("a shared event can still be kept private on purpose", async () => {
    await bus.publish("plan.task.created", { title: "Book therapist" }, { userId: "alice", source: "test", visibility: "private" });
    await flush();
    expect(cloudWrites()).toEqual([]);
    expect(notifyHousehold).not.toHaveBeenCalled();
  });

  it("new event types are private until someone decides otherwise", () => {
    expect(isSharedEventType("wellness.new.thing")).toBe(false);
    expect(effectiveVisibility("wellness.new.thing", "household")).toBe("private");
    expect(effectiveVisibility("trips.trip.created")).toBe("household");
  });
});
