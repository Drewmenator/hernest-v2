import { describe, it, expect } from "vitest";
import {
  limits, estimateCostUsd, normalizeUsage, sseUsageTracker, householdIdFor, takeQuota, recordUsage, usageDocPath, PRICES, dayKey,
} from "./aiUsage.js";
import { MODELS } from "./claudeRequest.js";
import { fakeDb } from "./fakeDb.testutil.js";

const NOW = new Date("2026-10-21T14:03:20Z");

describe("pilot limits", () => {
  it("defaults to 60 calls a household a day and 10 a user a minute, set by env", () => {
    expect(limits({})).toEqual({ householdDaily: 60, proHouseholdDaily: 200, userPerMinute: 10 });
    expect(limits({ AI_HOUSEHOLD_DAILY_LIMIT: "5", AI_USER_PER_MINUTE_LIMIT: "2" }).householdDaily).toBe(5);
    expect(limits({ AI_HOUSEHOLD_DAILY_LIMIT: "nonsense" }).householdDaily).toBe(60);
  });

  it("uses the owner's uid as the household for a joined partner", async () => {
    const db = fakeDb({ "users/bob/data/household_link": { primaryUid: "alice" } });
    expect(await householdIdFor(db, "bob")).toBe("alice");
    expect(await householdIdFor(db, "solo")).toBe("solo");
  });

  it("counts calls per household and stops at the daily limit", async () => {
    const db = fakeDb();
    const env = { AI_HOUSEHOLD_DAILY_LIMIT: "3", AI_USER_PER_MINUTE_LIMIT: "100" };
    // alice and her partner bob share one allowance
    expect((await takeQuota(db, { uid: "alice", householdId: "alice", now: NOW, env })).ok).toBe(true);
    expect((await takeQuota(db, { uid: "bob", householdId: "alice", now: NOW, env })).ok).toBe(true);
    expect((await takeQuota(db, { uid: "bob", householdId: "alice", now: NOW, env })).ok).toBe(true);
    expect(await takeQuota(db, { uid: "alice", householdId: "alice", now: NOW, env })).toEqual({ ok: false, reason: "daily_limit_reached" });
    expect(db.store.get(usageDocPath("2026-10-21", "alice")).calls).toBe(3);
    // the next day starts fresh
    expect((await takeQuota(db, { uid: "alice", householdId: "alice", now: new Date("2026-10-22T09:00:00Z"), env })).ok).toBe(true);
  });

  it("Pro households get the higher daily limit", async () => {
    const db = fakeDb({
      "users/alice/data/subscription": { status: "active" },
      [usageDocPath("2026-10-21", "alice")]: { calls: 60 },
    });
    expect((await takeQuota(db, { uid: "alice", householdId: "alice", now: NOW, env: {} })).ok).toBe(true);
  });

  it("stops a runaway loop at the per-minute limit, then lets it go next minute", async () => {
    const db = fakeDb();
    const env = { AI_USER_PER_MINUTE_LIMIT: "2" };
    await takeQuota(db, { uid: "alice", householdId: "alice", now: NOW, env });
    await takeQuota(db, { uid: "alice", householdId: "alice", now: NOW, env });
    expect(await takeQuota(db, { uid: "alice", householdId: "alice", now: NOW, env })).toEqual({ ok: false, reason: "burst_limit_reached" });
    expect((await takeQuota(db, { uid: "alice", householdId: "alice", now: new Date("2026-10-21T14:04:01Z"), env })).ok).toBe(true);
  });
});

describe("cost tracking", () => {
  it("has a price for every model the server can pick", () => {
    for (const id of Object.values(MODELS)) expect(PRICES[id]).toBeTruthy();
  });

  it("estimates cost from input, output and cache tokens", () => {
    const u = { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
    // Sonnet: $2 input + $1 output + $0.20 cache read
    expect(estimateCostUsd("claude-sonnet-5-5", u)).toBeCloseTo(3.2, 6);
    expect(estimateCostUsd("claude-haiku-5-5", u)).toBeCloseTo(0.16, 6);
  });

  it("reads token counts out of a streamed response", () => {
    const t = sseUsageTracker();
    const frame = (o) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
    const all = frame({ type: "message_start", message: { usage: { input_tokens: 120, cache_read_input_tokens: 900, cache_creation_input_tokens: 40, output_tokens: 1 } } })
      + frame({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } })
      + frame({ type: "message_delta", usage: { output_tokens: 75 } });
    // split mid-frame to prove partial chunks are handled
    t.push(Buffer.from(all.slice(0, 50)));
    t.push(Buffer.from(all.slice(50)));
    expect(t.usage()).toEqual({ inputTokens: 120, outputTokens: 75, cacheReadTokens: 900, cacheWriteTokens: 40 });
  });

  it("adds each call to the household's day, split by feature", async () => {
    const db = fakeDb();
    const usage = normalizeUsage({ input_tokens: 1000, output_tokens: 200 });
    await recordUsage(db, { householdId: "alice", uid: "bob", feature: "cleo_chat", model: "claude-haiku-5-5", usage, now: NOW });
    await recordUsage(db, { householdId: "alice", uid: "alice", feature: "bill_parse", model: "claude-haiku-5-5", usage, now: NOW });
    const day = db.store.get(usageDocPath("2026-10-21", "alice"));
    expect(day.inputTokens).toBe(2000);
    expect(day.features.cleo_chat.calls).toBe(1);
    expect(day.features.bill_parse.outputTokens).toBe(200);
    expect(day.costUsd).toBeCloseTo(2 * (1000 * 0.1 + 200 * 0.5) / 1e6, 9);
  });
});

describe("daily limit follows the user's local day", () => {
  it("keys the day on the user's zone, defaulting to America/Chicago", () => {
    const evening = new Date("2026-10-22T00:30:00Z"); // 8:30pm Oct 21 in New York, 7:30pm in Chicago
    expect(dayKey(evening, "America/New_York")).toBe("2026-10-21");
    expect(dayKey(evening)).toBe("2026-10-21");
    expect(dayKey(evening, "garbage")).toBe("2026-10-21");
    expect(dayKey(evening, "Asia/Tokyo")).toBe("2026-10-22");
  });

  it("an east-coast evening doesn't reset the household's limit", async () => {
    const db = fakeDb();
    const env = { AI_HOUSEHOLD_DAILY_LIMIT: "1", AI_USER_PER_MINUTE_LIMIT: "100" };
    const tz = "America/New_York";
    expect((await takeQuota(db, { uid: "a", householdId: "a", now: new Date("2026-10-21T22:00:00Z"), env, tz })).ok).toBe(true);
    // 8:30pm the same local day (already Oct 22 in UTC): still limited
    expect(await takeQuota(db, { uid: "a", householdId: "a", now: new Date("2026-10-22T00:30:00Z"), env, tz })).toEqual({ ok: false, reason: "daily_limit_reached" });
    // after local midnight: fresh
    expect((await takeQuota(db, { uid: "a", householdId: "a", now: new Date("2026-10-22T04:30:00Z"), env, tz })).ok).toBe(true);
  });

  it("records usage on the same local day the quota was taken", async () => {
    const db = fakeDb();
    const usage = normalizeUsage({ input_tokens: 10, output_tokens: 1 });
    await recordUsage(db, { householdId: "a", uid: "a", feature: "f", model: "claude-haiku-5-5", usage, now: new Date("2026-10-22T00:30:00Z"), tz: "America/New_York" });
    expect(db.store.get(usageDocPath("2026-10-21", "a")).inputTokens).toBe(10);
  });
});
