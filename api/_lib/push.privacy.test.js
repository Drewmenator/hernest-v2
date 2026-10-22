// The morning notification for a partner may only draw on shared household
// records and the partner's own records, never the owner's private ones.
import { describe, it, expect, vi } from "vitest";

const reads = [];
const store = {
  "users/bob/data/household_link": { primaryUid: "alice" },
  "users/alice/data/profile": { kids: [{ name: "SecretKid", birthday: "2015-10-23" }], challenge: "SECRET-CHALLENGE" },
  "users/alice/data/thrive": { moodLog: [{ value: 1, note: "SECRET-MOOD" }] },
  "users/alice/data/cleo_memory_v2": { memories: [{ content: "SECRET-MEMORY" }] },
  "users/alice/data/school": { events: [] },
  "users/bob/data/profile": { kids: [] },
};
vi.mock("./secure.js", () => ({
  adminDb: {
    doc: (path) => ({ path, async get() { reads.push(path); const d = store[path]; return { exists: !!d, data: () => d }; } }),
    collection: (path) => ({ async get() { reads.push(path); return { docs: [], empty: true }; } }),
  },
}));
vi.mock("firebase-admin/messaging", () => ({ getMessaging: () => ({}) }));

const { buildBriefingLine } = await import("./push.js");

const SHARED = ["calendar_synced", "tasks", "chores", "bills", "school", "family", "circle", "items_migration"];

describe("partner's morning notification", () => {
  it("reads only shared household records from the owner's account", async () => {
    const line = await buildBriefingLine("bob", new Date(2026, 9, 21));
    const ownerReads = reads.filter(p => p.startsWith("users/alice/"));
    expect(ownerReads.length).toBeGreaterThan(0);
    for (const p of ownerReads) {
      const col = p.split("/")[3];
      expect(SHARED, `read ${p}`).toContain(col);
    }
    expect(line).not.toMatch(/SECRET/);
    expect(line).not.toContain("SecretKid");
  });
});
