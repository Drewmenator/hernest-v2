// Privacy guard: what counts as "household" data in the app must match the
// database rules, and private records must always resolve to their owner.
import { describe, it, expect, vi } from "vitest";
// Vite inlines the rules file as text (no Node file access in app code).
import rules from "../../firestore.rules?raw";

vi.mock("./store", () => ({
  useStore: { getState: () => ({ currentHouseholdId: "alice", user: { uid: "bob" } }) },
}));

import { HOUSEHOLD_COLLECTIONS, isHouseholdCollection, getHouseholdId } from "./identity";

// Mirrors ownerFor() in firebase.ts: household collections go to the
// household's owner, everything else stays with the signed-in person.
const ownerFor = (uid: string, col: string) => (isHouseholdCollection(col) ? getHouseholdId() || uid : uid);

const PRIVATE = ["thrive", "cleo_memory", "cleo_memory_v2", "profile", "subscription", "push_state",
  "alerts", "style", "wellness", "partner_invite", "household_link", "gmail_receipts", "usage"];

describe("household vs private data", () => {
  it("a partner's private records always stay under their own account", () => {
    for (const col of PRIVATE) expect(ownerFor("bob", col)).toBe("bob");
  });

  it("shared records resolve to the household", () => {
    expect(ownerFor("bob", "tasks")).toBe("alice");
    expect(ownerFor("bob", "family")).toBe("alice");
  });

  it("no private collection is on the household list", () => {
    for (const col of PRIVATE) expect(HOUSEHOLD_COLLECTIONS.has(col)).toBe(false);
  });

  it("the app's household list matches the database rules exactly", () => {
    const grab = (fn: string) => {
      const m = rules.match(new RegExp(`function ${fn}\\(\\) \\{[\\s\\S]*?return \\[([\\s\\S]*?)\\];`));
      return (m?.[1].match(/'([^']+)'/g) || []).map((x: string) => x.slice(1, -1));
    };
    const inRules = new Set([...grab("householdShared"), ...grab("householdItemCollections")]);
    expect([...inRules].sort()).toEqual([...HOUSEHOLD_COLLECTIONS].sort());
  });
});
