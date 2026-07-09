import { describe, it, expect } from "vitest";
import { validateResponse } from "./responseValidator";

const base = {
  intent: "planning" as const,
  feature: "cleo_chat" as any,
  householdState: null,
  fallbackText: "Sorry — try again.",
};

describe("validateResponse", () => {
  it("passes clean text through", () => {
    const r = validateResponse({ ...base, rawText: "Here are your three priorities for today.", requireJson: false });
    expect(r.valid).toBe(true);
    expect(r.text).toContain("priorities");
  });

  it("repairs JSON wrapped in markdown fences", () => {
    const raw = '```json\n{"summary": "ok", "items": [1, 2]}\n```';
    const r = validateResponse({ ...base, rawText: raw, requireJson: true });
    expect(r.valid).toBe(true);
    expect(r.repaired).toBe(true);
  });

  it("falls back when JSON is unrecoverable", () => {
    const r = validateResponse({ ...base, rawText: "not json at all {{{", requireJson: true });
    expect(r.valid).toBe(false);
    expect(r.text).toBe(base.fallbackText);
  });

  it("accepts pre-parsed JSON without repair", () => {
    const r = validateResponse({ ...base, rawText: '{"a":1}', rawParsed: { a: 1 }, requireJson: true });
    expect(r.valid).toBe(true);
    expect(r.repaired).toBe(false);
  });
});
