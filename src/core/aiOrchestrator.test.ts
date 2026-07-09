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

import { classifyIntentLocally } from "./aiOrchestrator";

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
