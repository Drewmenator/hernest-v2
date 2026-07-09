import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Firestore: resolveHouseholdId reads users/{uid}/data/household_link
const getDocMock = vi.fn();
vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  getDoc: (ref: unknown) => getDocMock(ref),
  setDoc: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
}));
vi.mock("./firebase", () => ({ db: {}, auth: { currentUser: null } }));
vi.mock("./store", () => ({ useStore: { getState: vi.fn(() => ({ setHousehold: vi.fn(), setHouseholdMembers: vi.fn() })) } }));
vi.mock("./eventLog", () => ({ pullCloudEvents: vi.fn(() => Promise.resolve()) }));

import { resolveHouseholdId, acceptInvite } from "./householdService";

beforeEach(() => getDocMock.mockReset());

describe("resolveHouseholdId — multi-login identity resolution", () => {
  it("solo user: household is their own uid, role owner", async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const r = await resolveHouseholdId("alice");
    expect(r).toEqual({ householdId: "alice", role: "owner" });
  });

  it("joined partner: resolves to the primary's uid with partner role", async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ primaryUid: "alice", role: "partner" }) });
    const r = await resolveHouseholdId("bob");
    expect(r).toEqual({ householdId: "alice", role: "partner" });
  });

  it("self-pointing link is treated as owner (no partner-of-yourself)", async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ primaryUid: "alice", role: "partner" }) });
    const r = await resolveHouseholdId("alice");
    expect(r).toEqual({ householdId: "alice", role: "owner" });
  });

  it("Firestore failure degrades safely to solo owner", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getDocMock.mockReturnValue({ exists: () => { throw new Error("offline"); } });
    const r = await resolveHouseholdId("alice");
    expect(r).toEqual({ householdId: "alice", role: "owner" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("acceptInvite — partner join via emailed link", () => {
  it("returns false when not authenticated (no token to send)", async () => {
    const r = await acceptInvite("sometoken", "bob");
    expect(r).toBe(false);
  });
});
