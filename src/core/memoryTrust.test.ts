import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for Firestore's users/{uid}/data/{collection} docs.
const store = new Map<string, Record<string, unknown>>();
vi.mock("./firebase", () => ({
  loadData: vi.fn(async (uid: string, col: string) => store.get(`${uid}/${col}`) ?? null),
  saveData: vi.fn(async (uid: string, col: string, data: Record<string, unknown>) => {
    store.set(`${uid}/${col}`, { ...(store.get(`${uid}/${col}`) ?? {}), ...data });
  }),
}));
vi.mock("./contextRetrieval", () => ({ invalidateCache: vi.fn() }));

import {
  proposeMemory, confirmMemory, rejectMemory, deleteMemory, rememberFromUser,
  loadMemoriesV2, loadPendingMemories, takeChatSuggestions, buildMemoryContextV2,
  normalizeMemory, migrateV1MemoriesToV2,
  type MemoryCandidate, type HouseholdMemory,
} from "./memoryServiceV2";
import {
  isSensitiveState, isUsableInContext, pickChatSuggestions, initialStatusFor,
} from "./memoryRules";

const UID = "mom-1";

const inferred = (over: Partial<MemoryCandidate> = {}): MemoryCandidate => ({
  type: "routine",
  title: "Soccer on Tuesdays",
  content: "Kids have soccer practice every Tuesday at 5pm.",
  sourceModule: "cleo",
  confidence: "high",
  sensitivity: "low",
  evidenceDescription: "Mentioned in chat",
  ...over,
});

beforeEach(() => { store.clear(); });

describe("nothing inferred becomes active without a yes", () => {
  it("a confident, low-sensitivity inferred fact waits for the user's OK", async () => {
    const res = await proposeMemory(UID, inferred());
    expect(res.action).toBe("needs_confirmation");
    expect(res.memory?.status).toBe("needs_confirmation");
    expect(res.memory?.confirmation).toBe("pending");
  });

  it("ignores a candidate's own request to be saved as active", async () => {
    const res = await proposeMemory(UID, inferred({ suggestedStatus: "active" }));
    expect(res.memory?.status).toBe("needs_confirmation");
  });

  it("repeating an inferred fact does not activate it", async () => {
    await proposeMemory(UID, inferred());
    const again = await proposeMemory(UID, inferred({ evidenceDescription: "Said again" }));
    expect(again.action).toBe("needs_confirmation");
    const all = await loadMemoriesV2(UID);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("needs_confirmation");
    expect(all[0].evidence).toHaveLength(2);
  });

  it("old V1 facts migrate as suggestions, not active memories", async () => {
    store.set(`${UID}/cleo_memory`, { facts: [{ id: "f1", statement: "Has two kids named Mia and Leo.", type: "family", source: "conversation", confidence: 0.9, createdAt: 1 }] });
    await migrateV1MemoriesToV2(UID);
    const all = await loadMemoriesV2(UID);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("needs_confirmation");
    expect(all[0].origin).toBe("imported");
  });

  it("only user-typed memories start active", () => {
    expect(initialStatusFor("user_typed")).toBe("active");
    expect(initialStatusFor("inferred")).toBe("needs_confirmation");
    expect(initialStatusFor("imported")).toBe("needs_confirmation");
    expect(initialStatusFor(undefined)).toBe("needs_confirmation");
  });
});

describe("Tell Cleo something", () => {
  it("what the user types herself is active right away", async () => {
    const res = await rememberFromUser(UID, "  Soccer is every   Tuesday at 5 ");
    expect(res.action).toBe("saved");
    expect(res.memory?.status).toBe("active");
    expect(res.memory?.origin).toBe("user_typed");
    expect(res.memory?.confirmation).toBe("user_typed");
    expect(res.memory?.content).toBe("Soccer is every Tuesday at 5");
  });

  it("typing something she earlier said no to counts as her yes", async () => {
    const first = await proposeMemory(UID, inferred({ type: "fact", content: "Allergic to peanuts and tree nuts", title: "Allergic to peanuts and tree nuts" }));
    await rejectMemory(UID, first.memory!.id);
    const res = await rememberFromUser(UID, "Allergic to peanuts and tree nuts");
    expect(res.memory?.status).toBe("active");
  });
});

describe("moods, health and distress are never suggested", () => {
  const cases = [
    "User is feeling overwhelmed this week.",
    "She has been really anxious about work lately.",
    "User was diagnosed with type 2 diabetes last year.",
    "Takes medication for her migraines every morning.",
    "User is pregnant with her third child.",
    "She said she can't cope with everything right now.",
  ];
  for (const content of cases) {
    it(`rejects: ${content}`, async () => {
      const res = await proposeMemory(UID, inferred({ type: "fact", title: content.slice(0, 40), content }));
      expect(res.action).toBe("rejected");
      expect(await loadMemoriesV2(UID)).toHaveLength(0);
    });
  }

  it("rejects stress patterns by type alone", async () => {
    const res = await proposeMemory(UID, inferred({ type: "stress_pattern", content: "Sunday evenings tend to be the busiest stretch." }));
    expect(res.action).toBe("rejected");
  });

  it("does not trip on ordinary household words", () => {
    expect(isSensitiveState("Bills are paid every pay period on Fridays.")).toBe(false);
    expect(isSensitiveState("Prefers to plan meals on Sunday afternoons.")).toBe(false);
    expect(isSensitiveState("Kids have soccer practice every Tuesday at 5pm.")).toBe(false);
  });
});

describe("only active memories reach Cleo's context", () => {
  it("waiting, rejected and forgotten memories are left out; confirmed ones go in", async () => {
    const waiting = await proposeMemory(UID, inferred({ title: "Waiting one", content: "Family dinner is always at 6:30 on weeknights." }));
    const no = await proposeMemory(UID, inferred({ type: "preference", title: "Rejected one", content: "Prefers takeout pizza on Friday nights with the kids." }));
    const yes = await proposeMemory(UID, inferred({ type: "obligation", title: "Confirmed one", content: "Piano lessons happen every Thursday after school." }));
    const forgot = await rememberFromUser(UID, "Grandma visits on the first Sunday of the month");
    await rejectMemory(UID, no.memory!.id);
    await confirmMemory(UID, yes.memory!.id);
    await deleteMemory(UID, forgot.memory!.id);

    const ctx = await buildMemoryContextV2(UID, { maxResults: 10 });
    expect(ctx).toContain("Piano lessons");
    expect(ctx).not.toContain("Family dinner");
    expect(ctx).not.toContain("takeout pizza");
    expect(ctx).not.toContain("Grandma");
    expect(waiting.memory?.status).toBe("needs_confirmation");
  });

  it("expired memories are left out even before the daily tidy-up", () => {
    expect(isUsableInContext({ status: "active", expiresAt: "2020-01-01T00:00:00Z" })).toBe(false);
    expect(isUsableInContext({ status: "active" })).toBe(true);
    expect(isUsableInContext({ status: "needs_confirmation" })).toBe(false);
    expect(isUsableInContext({ status: "rejected" })).toBe(false);
    expect(isUsableInContext({ status: "deleted" })).toBe(false);
  });

  it("an inferred conflict does not retire the old memory until she says yes", async () => {
    const old = await rememberFromUser(UID, "Family prefers saving over spending on extras");
    const next = await proposeMemory(UID, inferred({ type: "fact", title: "Spending", content: "Family prefers spending on experiences this year." }));
    expect(next.action).toBe("needs_confirmation");
    let all = await loadMemoriesV2(UID);
    expect(all.find(m => m.id === old.memory!.id)?.status).toBe("active");
    await confirmMemory(UID, next.memory!.id);
    all = await loadMemoriesV2(UID);
    expect(all.find(m => m.id === old.memory!.id)?.status).toBe("contradicted");
    expect(all.find(m => m.id === next.memory!.id)?.status).toBe("active");
  });
});

describe("a no sticks", () => {
  it("a rejected suggestion is not suggested again", async () => {
    const first = await proposeMemory(UID, inferred());
    await rejectMemory(UID, first.memory!.id);
    const again = await proposeMemory(UID, inferred({ evidenceDescription: "Came up again" }));
    expect(again.action).toBe("rejected");
    expect(await loadPendingMemories(UID)).toHaveLength(0);
  });

  it("a forgotten memory is not suggested again", async () => {
    const first = await proposeMemory(UID, inferred());
    await confirmMemory(UID, first.memory!.id);
    await deleteMemory(UID, first.memory!.id);
    const again = await proposeMemory(UID, inferred());
    expect(again.action).toBe("rejected");
  });
});

describe("chat asks about one or two new suggestions, once", () => {
  it("returns at most two, only from this chat, and never the same one twice", async () => {
    await proposeMemory(UID, inferred({ title: "Before chat", content: "Library books are due back every other Monday." }));
    const since = new Date(Date.now() + 1).toISOString();
    await new Promise(r => setTimeout(r, 5));
    await proposeMemory(UID, inferred({ title: "A", content: "Swim lessons are on Saturday mornings at nine." }));
    await proposeMemory(UID, inferred({ type: "preference", title: "B", content: "Prefers grocery pickup instead of delivery." }));
    await proposeMemory(UID, inferred({ type: "obligation", title: "C", content: "Trash goes out Wednesday night for Thursday pickup." }));

    const first = await takeChatSuggestions(UID, since, 2);
    expect(first.map(m => m.title)).toEqual(["A", "B"]);
    const second = await takeChatSuggestions(UID, since, 2);
    expect(second.map(m => m.title)).toEqual(["C"]);
    expect(await takeChatSuggestions(UID, since, 2)).toEqual([]);
    // Unanswered ones still wait in What Cleo knows.
    expect(await loadPendingMemories(UID)).toHaveLength(4);
  });

  it("pickChatSuggestions skips anything already shown or answered", () => {
    const base = { createdAt: "2026-10-21T10:00:00Z" };
    const picked = pickChatSuggestions([
      { id: "1", status: "needs_confirmation", ...base, usage: { lastShownToUserAt: "x" } },
      { id: "2", status: "active", ...base },
      { id: "3", status: "needs_confirmation", ...base },
    ], "2026-10-21T00:00:00Z");
    expect(picked.map(m => m.id)).toEqual(["3"]);
  });
});

describe("every memory records who, where from, why, who sees it, when, and her say-so", () => {
  it("new memories carry all trust fields, private by default", async () => {
    const { memory } = await proposeMemory(UID, inferred());
    expect(memory).toMatchObject({
      ownerId: UID, origin: "inferred", type: "routine", visibility: "private", confirmation: "pending",
    });
    expect(typeof memory!.createdAt).toBe("string");
  });

  it("old records without the new fields still load, with safe defaults", async () => {
    const legacy = {
      id: "old-1", householdId: UID, type: "preference", title: "Old", content: "Prefers morning reminders over evening ones.",
      sourceModule: "cleo", confidence: "medium", sensitivity: "low", status: "active",
      evidence: [], usage: { timesUsed: 0 }, decay: { shouldDecay: false, decayRate: "slow" },
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    };
    store.set(`${UID}/cleo_memory_v2`, { memories: [legacy] });
    const [m] = await loadMemoriesV2(UID);
    expect(m).toMatchObject({ ownerId: UID, origin: "inferred", visibility: "private", confirmation: "legacy" });
    expect(normalizeMemory({ ...legacy, status: "needs_confirmation" } as HouseholdMemory).confirmation).toBe("pending");
  });

  it("confirming and declining are recorded", async () => {
    const a = await proposeMemory(UID, inferred());
    const b = await proposeMemory(UID, inferred({ type: "preference", title: "Other", content: "Prefers texts over phone calls for reminders." }));
    await confirmMemory(UID, a.memory!.id);
    await rejectMemory(UID, b.memory!.id);
    const all = await loadMemoriesV2(UID);
    const ca = all.find(m => m.id === a.memory!.id)!;
    const cb = all.find(m => m.id === b.memory!.id)!;
    expect(ca.confirmation).toBe("confirmed");
    expect(ca.lastConfirmedAt).toBeTruthy();
    expect(cb.status).toBe("rejected");
    expect(cb.confirmation).toBe("declined");
    expect(cb.declinedAt).toBeTruthy();
  });
});
