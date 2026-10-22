import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./firebase", () => ({
  auth: { currentUser: { getIdToken: vi.fn(async () => "id-token") } },
  loadData: vi.fn(async () => ({ tasks: [] })),
  saveData: vi.fn(async () => {}),
}));
vi.mock("./householdItems", () => ({
  createItem: vi.fn(async () => {}),
  listItems: vi.fn(async () => []),
}));
vi.mock("./events", () => ({ bus: { publish: vi.fn(async () => {}) } }));
vi.mock("./localNotifications", () => ({ ensureReminderPermission: vi.fn(async () => true) }));

import { runCleoAgentStreaming } from "./cleoAgent";
import { createItem } from "./householdItems";

// Builds a Server-Sent Events body from Anthropic stream events.
function sse(events: object[]): Response {
  const text = events.map(e => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
  return { ok: true, status: 200, body } as unknown as Response;
}

// Turn 1: the model thinks, then calls add_task. Turn 2: it thinks, then replies.
const turn1 = [
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "User wants a task." } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-1" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu_1", name: "add_task", input: {} } },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"title\":\"Buy milk\"}" } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "tool_use" } },
];
const turn2 = [
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Added it." } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" } },
];

// Turn 1 that calls add_task with this input.
const addTaskTurn = (input: object) => [
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_r", name: "add_task", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use" } },
];

describe("runCleoAgentStreaming", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.mocked(createItem).mockClear(); });

  async function runWithAddTask(input: object) {
    const bodies: { messages: { content: { type: string; content?: string }[] }[] }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return sse(bodies.length === 1 ? addTaskTurn(input) : turn2);
    }));
    const result = await runCleoAgentStreaming({
      uid: "u1", system: "sys", messages: [{ role: "user", content: "remind me" }], onToken: () => {},
    });
    const saved = vi.mocked(createItem).mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    return { result, saved, toolResult: bodies[1].messages[2].content[0].content || "" };
  }

  it("'remind me at 3pm' saves a confirmed task with remindAt and says when", async () => {
    const future = new Date(Date.now() + 86400000);
    const day = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
    const { saved, toolResult } = await runWithAddTask({ title: "Call the dentist", remindAt: `${day}T15:00` });
    expect(saved).toMatchObject({ title: "Call the dentist", remindAt: `${day}T15:00`, userConfirmed: true, createdBy: "u1", source: "cleo" });
    expect(toolResult).toMatch(/set a reminder for tomorrow at 3:00 PM/);
  });

  it("a task with no reminder still waits for Confirm", async () => {
    const { saved, toolResult } = await runWithAddTask({ title: "Buy milk" });
    expect(saved).toMatchObject({ title: "Buy milk", userConfirmed: false });
    expect(saved).not.toHaveProperty("remindAt");
    expect(toolResult).toMatch(/waiting for your confirmation/);
  });

  it("an unreadable reminder time is not saved, and Cleo is told to ask", async () => {
    const { saved, toolResult } = await runWithAddTask({ title: "Call mom", remindAt: "3pm" });
    expect(saved).toMatchObject({ userConfirmed: false });
    expect(saved).not.toHaveProperty("remindAt");
    expect(toolResult).toMatch(/No reminder was set/);
  });

  it("replays thinking blocks intact (not as empty text) when sending tool results", async () => {
    const bodies: { messages: { content: { type: string; text?: string }[] }[] }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return sse(bodies.length === 1 ? turn1 : turn2);
    }));

    const result = await runCleoAgentStreaming({
      uid: "u1", system: "sys", messages: [{ role: "user", content: "add buy milk" }], onToken: () => {},
    });

    expect(result.text).toBe("Added it.");
    expect(result.usedTools).toBe(true);
    const replayed = bodies[1].messages[1].content;
    expect(replayed[0]).toEqual({ type: "thinking", thinking: "User wants a task.", signature: "sig-1" });
    expect(replayed[1]).toMatchObject({ type: "tool_use", id: "tu_1", name: "add_task", input: { title: "Buy milk" } });
    expect(replayed.some(b => b.type === "text" && !b.text)).toBe(false);
  });
});
