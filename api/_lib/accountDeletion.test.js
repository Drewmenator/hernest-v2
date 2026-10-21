import { describe, it, expect, vi, beforeAll } from "vitest";
import { deleteAccount } from "./accountDeletion.js";
import { encryptSecret } from "./cryptoUtil.js";

beforeAll(() => { process.env.CREDENTIALS_ENCRYPTION_KEY = "b".repeat(64); });

// Minimal in-memory Firestore: a flat map of document path → data.
function fakeDb(seed) {
  const docs = new Map(Object.entries(seed));
  const docRef = (path) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    delete: async () => { docs.delete(path); },
  });
  const childrenOf = (col) => [...docs.keys()].filter(k => k.startsWith(col + "/") && !k.slice(col.length + 1).includes("/"));
  const query = (col, filter) => ({
    get: async () => ({
      docs: childrenOf(col)
        .filter(k => !filter || docs.get(k)?.[filter.field] === filter.value)
        .map(k => ({ id: k.split("/").pop(), ref: docRef(k), data: () => docs.get(k) })),
    }),
  });
  return {
    docs,
    doc: docRef,
    collection: (col) => ({ ...query(col), where: (field, _op, value) => query(col, { field, value }) }),
    recursiveDelete: async (ref) => {
      for (const k of [...docs.keys()]) if (k === ref.path || k.startsWith(ref.path + "/")) docs.delete(k);
    },
  };
}

const OWNER = "alice", PARTNER = "bob";

function seed() {
  return {
    [`users/${OWNER}/data/profile`]: { name: "Alice" },
    [`users/${OWNER}/data/subscription`]: { status: "active", stripeSubscriptionId: "sub_1" },
    [`users/${OWNER}/data/partner_invite`]: { partnerUid: PARTNER, status: "accepted" },
    [`users/${OWNER}/integrations/google_calendar`]: { refreshToken: encryptSecret("rt-google") },
    [`users/${OWNER}/integrations/apple_calendar`]: { password: encryptSecret("caldav") },
    [`users/${OWNER}/devices/tok1`]: { platform: "ios" },
    [`users/${OWNER}/usage/2026-10-21`]: { count: 3 },
    [`households/${OWNER}`]: { ownerUid: OWNER },
    [`households/${OWNER}/members/${PARTNER}`]: { role: "partner" },
    [`users/${PARTNER}/data/household_link`]: { primaryUid: OWNER },
    [`users/${PARTNER}/data/profile`]: { name: "Bob" },
    [`invites/tok`]: { fromUid: OWNER, status: "pending" },
  };
}

describe("deleteAccount", () => {
  it("cancels billing, revokes Google, unlinks the partner and erases everything", async () => {
    const db = fakeDb(seed());
    const stripe = { subscriptions: { cancel: vi.fn(async () => ({})) } };
    const auth = { deleteUser: vi.fn(async () => {}) };
    const fetchFn = vi.fn(async () => ({ ok: true }));

    await deleteAccount({ uid: OWNER, db, auth, stripe, fetchFn });

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    expect(fetchFn.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/revoke");
    expect(fetchFn.mock.calls[0][1].body).toContain("rt-google");
    expect(auth.deleteUser).toHaveBeenCalledWith(OWNER);
    const left = [...db.docs.keys()];
    expect(left.some(k => k.startsWith(`users/${OWNER}`))).toBe(false);
    expect(left.some(k => k.startsWith(`households/${OWNER}`))).toBe(false);
    expect(left).not.toContain("invites/tok");
    expect(left).not.toContain(`users/${PARTNER}/data/household_link`);
    expect(left).toContain(`users/${PARTNER}/data/profile`); // partner's own data untouched
  });

  it("a partner leaving removes only their roster entry", async () => {
    const db = fakeDb(seed());
    await deleteAccount({ uid: PARTNER, db, auth: { deleteUser: async () => {} }, fetchFn: async () => ({}) });
    const left = [...db.docs.keys()];
    expect(left).not.toContain(`households/${OWNER}/members/${PARTNER}`);
    expect(left).not.toContain(`users/${OWNER}/data/partner_invite`);
    expect(left).toContain(`households/${OWNER}`);
    expect(left).toContain(`users/${OWNER}/data/profile`);
  });

  it("stops before deleting anything if billing can't be cancelled", async () => {
    const db = fakeDb(seed());
    const stripe = { subscriptions: { cancel: async () => { throw Object.assign(new Error("down"), { code: "api_error" }); } } };
    const auth = { deleteUser: vi.fn() };
    await expect(deleteAccount({ uid: OWNER, db, auth, stripe, fetchFn: async () => ({}) })).rejects.toThrow();
    expect(auth.deleteUser).not.toHaveBeenCalled();
    expect(db.docs.has(`users/${OWNER}/data/profile`)).toBe(true);
  });

  it("treats an already-cancelled subscription as fine", async () => {
    const db = fakeDb(seed());
    const stripe = { subscriptions: { cancel: async () => { throw Object.assign(new Error("gone"), { code: "resource_missing" }); } } };
    const auth = { deleteUser: vi.fn(async () => {}) };
    await deleteAccount({ uid: OWNER, db, auth, stripe, fetchFn: async () => ({}) });
    expect(auth.deleteUser).toHaveBeenCalled();
  });
});
