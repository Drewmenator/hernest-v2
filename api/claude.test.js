// /api/claude end to end with Firestore, auth and Anthropic faked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "./_lib/fakeDb.testutil.js";

const state = vi.hoisted(() => ({ db: null }));
vi.mock("./_lib/secure.js", () => ({
  get adminDb() { return state.db; },
  adminAuth: { verifyIdToken: async () => ({ uid: "alice" }) },
  applyCors: () => false,
}));

import handler from "./claude.js";

function call(body, headers = {}) {
  const res = {
    statusCode: 200, body: undefined, chunks: [],
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader() {}, flushHeaders() {},
    write(c) { this.chunks.push(c); }, end() { return this; },
  };
  return handler({ method: "POST", headers: { authorization: "Bearer t", ...headers }, body }, res).then(() => res);
}

const chat = (text, extra = {}) => ({ feature: "cleo_chat", messages: [{ role: "user", content: text }], ...extra });

beforeEach(() => {
  state.db = fakeDb();
  vi.unstubAllGlobals();
});

describe("/api/claude", () => {
  it("answers distress language with crisis: true and never calls the model", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const body of [chat("I want to die"), { feature: "bill_parse", prompt: "i cant go on anymore" }, { feature: "school_calendar", prompt: "thinking about suicide" }]) {
      const res = await call(body);
      expect(res.body).toEqual({ crisis: true });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("records tokens and cost for a normal call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ content: [{ type: "text", text: "hi" }], usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 2000 } }),
    })));
    const res = await call(chat("what's for dinner?"));
    expect(res.statusCode).toBe(200);
    const [day] = [...state.db.store.entries()].filter(([k]) => k.startsWith("ai_usage/")).map(([, v]) => v);
    expect(day.calls).toBe(1);
    expect(day.features.cleo_chat.inputTokens).toBe(500);
    expect(day.features.cleo_chat.cacheReadTokens).toBe(2000);
    expect(day.costUsd).toBeGreaterThan(0);
  });

  it("counts the call on the user's local day (body tz or x-hn-tz header)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T03:00:00Z")); // 11pm Oct 21 New York, 12pm Oct 22 Tokyo
    try {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ content: [], usage: { input_tokens: 1, output_tokens: 1 } }) })));
      await call(chat("hi", { tz: "America/New_York" }));
      await call(chat("hi"), { "x-hn-tz": "Asia/Tokyo" });
      await call(chat("hi")); // no zone → America/Chicago (10pm Oct 21)
      expect(state.db.store.get("ai_usage/2026-10-21/households/alice").calls).toBe(2);
      expect(state.db.store.get("ai_usage/2026-10-22/households/alice").calls).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it("records tokens from a streamed reply", async () => {
    const frames = [
      `data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 300, output_tokens: 1 } } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 42 } })}\n\n`,
    ].map((s) => Buffer.from(s));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body: frames })));
    const res = await call(chat("hello", { stream: true }));
    expect(res.chunks).toHaveLength(2);
    const day = [...state.db.store.entries()].find(([k]) => k.startsWith("ai_usage/"))[1];
    expect(day.features.cleo_chat).toMatchObject({ inputTokens: 300, outputTokens: 42 });
  });

  it("returns a friendly 429 when the household has used today's calls", async () => {
    vi.stubEnv("AI_HOUSEHOLD_DAILY_LIMIT", "1");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ content: [], usage: {} }) })));
    await call(chat("one"));
    const res = await call(chat("two"));
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toBe("daily_limit_reached");
    expect(res.body.message).toMatch(/tomorrow/);
    vi.unstubAllEnvs();
  });
});
