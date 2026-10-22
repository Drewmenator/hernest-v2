import { describe, it, expect } from "vitest";
import { buildUpstreamBody, resolveModel, MODELS, MAX_TEXT_CHARS, THINKING_HEADROOM } from "./claudeRequest.js";

const tool = (name) => ({ name, description: "d", input_schema: { type: "object", properties: {} } });

describe("buildUpstreamBody", () => {
  it("rejects a missing or unknown feature", () => {
    expect(buildUpstreamBody({ prompt: "hi" }).error).toBe("invalid_feature");
    expect(buildUpstreamBody({ prompt: "hi", feature: "free_chatbot" }).error).toBe("invalid_feature");
  });

  it("ignores a client-chosen expensive model", () => {
    const { upstream } = buildUpstreamBody({ prompt: "hi", feature: "gift_advisor", model: "claude-opus-5-5" });
    expect(upstream.model).toBe(MODELS.haiku);
  });

  it("honours a tier request (orchestrator routing)", () => {
    expect(resolveModel("cleo_chat", "haiku")).toBe(MODELS.haiku);
    expect(resolveModel("gift_advisor", "sonnet")).toBe(MODELS.sonnet);
    expect(resolveModel("cleo_chat", "claude-sonnet-4-5")).toBe(MODELS.sonnet);
  });

  it("caps max_tokens at the feature limit", () => {
    const { upstream } = buildUpstreamBody({ prompt: "hi", feature: "gift_advisor", max_tokens: 8000 });
    expect(upstream.max_tokens).toBe(1000 + THINKING_HEADROOM);
  });

  it("only allows the Cleo tools, and only on cleo_chat", () => {
    expect(buildUpstreamBody({ prompt: "hi", feature: "cleo_chat", tools: [tool("add_task")] }).upstream.tools).toHaveLength(1);
    expect(buildUpstreamBody({ prompt: "hi", feature: "cleo_chat", tools: [tool("web_fetch")] }).error).toBe("tools_not_allowed");
    expect(buildUpstreamBody({ prompt: "hi", feature: "meal_plan", tools: [tool("add_task")] }).error).toBe("tools_not_allowed");
  });

  it("rejects oversized requests, counting system and messages", () => {
    const big = "x".repeat(MAX_TEXT_CHARS);
    expect(buildUpstreamBody({ system: big, prompt: "hi", feature: "cleo_chat" }).status).toBe(413);
    expect(buildUpstreamBody({ messages: [{ role: "user", content: big + "x" }], feature: "cleo_chat" }).status).toBe(413);
  });

  it("allows attachments only on document features", () => {
    const content = [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }];
    expect(buildUpstreamBody({ messages: [{ role: "user", content }], feature: "school_calendar" }).upstream).toBeTruthy();
    expect(buildUpstreamBody({ messages: [{ role: "user", content }], feature: "cleo_chat" }).error).toBe("attachments_not_allowed");
  });

  it("rejects bad roles", () => {
    expect(buildUpstreamBody({ messages: [{ role: "system", content: "x" }], feature: "cleo_chat" }).error).toBe("bad_request");
  });

  it("sets effort per feature", () => {
    expect(buildUpstreamBody({ prompt: "hi", feature: "gift_advisor" }).upstream.output_config.effort).toBe("low");
    expect(buildUpstreamBody({ prompt: "hi", feature: "household_cfo" }).upstream.output_config.effort).toBe("medium");
  });

  it("passes a fixed answer shape through as structured output", () => {
    const schema = { type: "object", properties: { ideas: { type: "array", items: { type: "string" } } }, required: ["ideas"], additionalProperties: false };
    const { upstream } = buildUpstreamBody({ prompt: "hi", feature: "gift_advisor", schema });
    expect(upstream.output_config.format).toEqual({ type: "json_schema", schema });
  });

  it("rejects bad or oversized schemas", () => {
    expect(buildUpstreamBody({ prompt: "hi", feature: "gift_advisor", schema: { type: "array" } }).error).toBe("bad_schema");
    const huge = { type: "object", description: "x".repeat(30000) };
    expect(buildUpstreamBody({ prompt: "hi", feature: "gift_advisor", schema: huge }).error).toBe("bad_schema");
  });
});
