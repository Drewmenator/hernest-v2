import { describe, it, expect, vi } from "vitest";

// aiOrchestrator pulls in the whole intelligence stack at module level —
// stub the heavy chains; we're testing the pure local intent classifier.
vi.mock("./ai", () => ({ ai: vi.fn(), aiJSON: vi.fn() }));
vi.mock("./cleoAgent", () => ({ runCleoAgent: vi.fn(), runCleoAgentStreaming: vi.fn() }));
vi.mock("./contextBuilder", () => ({ buildAppContext: vi.fn(), buildBriefingPrompt: vi.fn() }));
vi.mock("./household/HouseholdIntelligence", () => ({ buildHouseholdSnapshot: vi.fn() }));
vi.mock("./memory", () => ({ extractFactsFromConversation: vi.fn() }));
vi.mock("./events", () => ({ bus: { publish: vi.fn(), subscribe: vi.fn() } }));
vi.mock("./household/householdStateEngine", () => ({ computeHouseholdState: vi.fn(), buildStatePromptAddendum: vi.fn() }));
vi.mock("./household/responseValidator", () => ({ validateResponse: vi.fn() }));
vi.mock("./contextRetrieval", () => ({ retrieve: vi.fn(), invalidateCache: vi.fn() }));
vi.mock("./graph/GraphService", () => ({
  createContextGraph: vi.fn(), loadGraphFromFirestore: vi.fn(),
  generateContextPackForCleo: vi.fn(), generateContextPackForCFO: vi.fn(),
  formatCleoContextPackForPrompt: vi.fn(), formatCFOContextPackForPrompt: vi.fn(),
}));
vi.mock("./store", () => ({ useStore: { getState: vi.fn(() => ({})) } }));
vi.mock("./identity", () => ({ getHouseholdId: vi.fn(() => null) }));
vi.mock("./firebase", () => ({ loadData: vi.fn(), saveData: vi.fn(), db: {}, auth: {} }));
vi.mock("./memoryServiceV2", () => ({ buildMemoryContextV2: vi.fn(), proposeMemory: vi.fn() }));

import { classifyIntentLocally, buildSystemPrompt, orchestrate } from "./aiOrchestrator";
import { ai } from "./ai";
import { validateResponse } from "./household/responseValidator";
import type { Mock } from "vitest";

describe("classifyIntentLocally — the router that decides which brain answers", () => {
  it("routes clearly financial questions to the CFO", () => {
    const r = classifyIntentLocally("can we afford the car payment this month with our budget?", "cleo");
    expect(r?.intent).toBe("financial_analysis");
    expect(r?.feature).toBe("household_cfo");
    expect(r?.financialDataRequired).toBe(true);
  });

  it("one financial keyword from the finances screen is enough", () => {
    const r = classifyIntentLocally("what about the budget?", "finances");
    expect(r?.intent).toBe("financial_analysis");
  });

  it("routes emotional messages to warm chat with full context", () => {
    const r = classifyIntentLocally("I'm so overwhelmed and exhausted today", "cleo");
    expect(r?.intent).toBe("emotional_support");
    expect(r?.emotionalWeight).toBe("high");
    expect(r?.decisionRequired).toBe(false);
  });

  it("detects task creation", () => {
    const r = classifyIntentLocally("remind me to sign the permission slip tomorrow", "cleo");
    expect(r?.intent).toBe("task_creation");
  });

  it("wellness screen context biases to the wellness coach", () => {
    const r = classifyIntentLocally("how am I doing?", "wellness");
    expect(r?.intent).toBe("wellness_check");
  });

  it("returns null for ambiguous messages (falls through to AI classification)", () => {
    const r = classifyIntentLocally("hello there", "cleo");
    expect(r).toBeNull();
  });
});


describe("buildSystemPrompt — intent addenda now live (ported from CleoScreen's dead prompt)", () => {
  const base = { requiredModules: [], emotionalWeight: "low" as const, decisionRequired: false, financialDataRequired: false, needsFullContext: false };

  it("financial analysis instructs the educational-guidance disclaimer", () => {
    const p = buildSystemPrompt({ ...base, intent: "financial_analysis", feature: "household_cfo" } as any);
    expect(p).toContain("Educational guidance, not financial advice");
  });

  it("task creation instructs TASKS_JSON and forbids claiming completion", () => {
    const p = buildSystemPrompt({ ...base, intent: "task_creation", feature: "task_extraction" } as any);
    expect(p).toContain("TASKS_JSON");
    expect(p).toContain("never claim they were added");
  });

  it("plain chat gets neither addendum", () => {
    const p = buildSystemPrompt({ ...base, intent: "unknown", feature: "cleo_chat" } as any);
    expect(p).not.toContain("TASKS_JSON");
    expect(p).not.toContain("not financial advice");
  });
});

describe("orchestrate — streamed responses are validated (previously skipped)", () => {
  it("runs validateResponse on the streaming path and returns its text", async () => {
    (ai as Mock).mockResolvedValue({ text: "raw model text" });
    (validateResponse as Mock).mockReturnValue({
      valid: true, text: "VALIDATED TEXT", warnings: [], repaired: false,
      confidenceNormalized: false, lengthAdjusted: false,
    });
    const res = await orchestrate({
      userId: "u1",
      profile: { name: "Test" },
      sourceModule: "cleo",
      userMessage: "hello there, just checking in on things today okay",
      conversationHistory: [],
      options: { onToken: () => {} },
    });
    expect(validateResponse).toHaveBeenCalled();
    expect(res.text).toBe("VALIDATED TEXT");
  });
});
