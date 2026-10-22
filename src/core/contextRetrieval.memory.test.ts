import { describe, it, expect, vi } from "vitest";

vi.mock("./firebase", () => ({ loadData: vi.fn(), saveData: vi.fn() }));
vi.mock("./contextBuilder", () => ({ summariseBills: vi.fn() }));

import { usableMemoryFacts } from "./contextRetrieval";

// Cleo's chat context is built here. It must only ever see active memories.
describe("usableMemoryFacts: the chat context's memory gate", () => {
  const mem = (status: string, content: string, extra: Record<string, unknown> = {}) => ({
    id: content, status, content, type: "routine", confidence: "high", sensitivity: "low",
    createdAt: "2026-10-01T00:00:00Z", ...extra,
  });

  it("passes active memories and nothing else", () => {
    const facts = usableMemoryFacts({
      memories: [
        mem("active", "Soccer every Tuesday"),
        mem("needs_confirmation", "Waiting for OK"),
        mem("rejected", "She said no"),
        mem("deleted", "She said forget it"),
        mem("contradicted", "Replaced"),
        mem("active", "Expired one", { expiresAt: "2020-01-01T00:00:00Z" }),
        mem("active", "Very private", { sensitivity: "high" }),
      ],
    });
    expect(facts.map(f => f.statement)).toEqual(["Soccer every Tuesday"]);
    expect(facts[0].type).toBe("schedule");
  });

  it("copes with a missing or malformed doc", () => {
    expect(usableMemoryFacts(null)).toEqual([]);
    expect(usableMemoryFacts({ memories: [null, 3, { status: "active" }] })).toEqual([]);
  });
});
