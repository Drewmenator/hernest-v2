import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/shared/utils/money", () => ({ getCurrency: () => "USD" }));
import { CRISIS_PATTERNS, latestUserText, needsCrisisResponse } from "./crisis.js";
import { CRISIS_PATTERNS as APP_PATTERNS } from "../../src/core/crisis.ts";

describe("server crisis check", () => {
  it("uses exactly the same patterns as the app", () => {
    expect(CRISIS_PATTERNS.map(String)).toEqual(APP_PATTERNS.map(String));
  });

  it("looks at the latest thing the person typed, skipping tool results", () => {
    const msgs = [
      { role: "user", content: "I don't want to be here anymore" },
      { role: "assistant", content: [{ type: "tool_use", id: "1", name: "add_task", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "done" }] },
    ];
    expect(latestUserText(msgs)).toBe("I don't want to be here anymore");
    expect(needsCrisisResponse("cleo_chat", msgs)).toBe(true);
  });

  it("only checks an earlier message if nothing newer was typed", () => {
    const msgs = [
      { role: "user", content: "I want to die" },
      { role: "assistant", content: "..." },
      { role: "user", content: "thanks, I called 988 and feel safer. what's for dinner?" },
    ];
    expect(needsCrisisResponse("cleo_chat", msgs)).toBe(false);
  });

  it("skips features whose prompt is built by the app, not typed", () => {
    expect(needsCrisisResponse("morning_briefing", [{ role: "user", content: "Task: suicide prevention walk" }])).toBe(false);
  });
});
