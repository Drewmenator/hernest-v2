// ─── Cleo v2 — Agent tool loop (Phase 2) ────────────────────────
// Turns Cleo from a single-shot chat responder into an executive assistant
// that can take real actions: add tasks, schedule events, complete tasks.
//
// Architecture: the loop runs CLIENT-side because the tools operate on the
// user's own data (Firestore via saveData/loadData + the in-app event bus).
// `api/claude.js` is a thin Anthropic proxy that now forwards `tools`. We POST
// the conversation + tool defs; if the model returns tool_use blocks we execute
// them locally, append tool_result, and loop until a final text answer.
//
// Safety: tools are additive and reversible (add a task/event, complete a task).
// Descriptions tell the model to act ONLY on an explicit request. Any failure
// falls back to plain chat in the orchestrator.

import { auth, loadData, saveData } from "./firebase";
import { bus } from "./events";
import { createItem, listItems } from "./householdItems";
import { AI } from "../config";
import { limitReached } from "./ai";
import { reminderFromToolInput, formatRemindAt } from "./taskReminders";
import { timeoutSignal } from "./timeout";

const MAX_ITERS = 5;

export interface AgentMessage {
  role: "user" | "assistant";
  content: unknown; // string, or an array of content blocks (tool_use / tool_result)
}

export interface AgentResult {
  text: string;
  actions: string[];   // human-readable summary of what Cleo did
  usedTools: boolean;
}

// ─── Tool definitions (Anthropic tool-use schema) ───────────────
const TOOLS = [
  {
    name: "add_task",
    description:
      "Add a to-do item to the household Plan list. Use ONLY when the user explicitly asks to add, create, note down, or be reminded of a task/chore/errand. Do not use for questions or hypotheticals.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The task, phrased as a clear action (e.g. 'Call the dentist')" },
        dueDate: { type: "string", description: "Due date as YYYY-MM-DD if a date is given or implied (resolve relative dates like 'tomorrow' using today's date from the system prompt)" },
        priority: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Priority; default medium" },
        category: { type: "string", enum: ["family", "work", "home", "travel", "personal", "School"], description: "Category; default personal" },
        remindAt: { type: "string", description: "Only when the user asks to be reminded at a time: the local date and time as YYYY-MM-DDTHH:mm (24-hour). Resolve relative times from the current date and time in the system prompt. 'Morning' = 09:00, 'afternoon' = 14:00, 'evening' = 18:00, 'tonight' = 20:00. If they give a day but no time, use 09:00." },
        askPerson: { type: "string", description: "First name of another adult in the household to ASK to take this task (e.g. 'Sam'). Only when the user explicitly says to give it to, ask, or assign it to that person. This only sends them a request; they accept or decline themselves. Omit for the user's own tasks and for kids." },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_task",
    description:
      "Mark an existing open task as done. Use when the user says they finished/completed/did a task. Match by the task's wording.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The title (or a close substring) of the open task to complete" },
      },
      required: ["title"],
    },
  },
  {
    name: "add_calendar_event",
    description:
      "Add an event to the household calendar. Use ONLY when the user asks to schedule, add, book, or put something on the calendar. Requires a date.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        date: { type: "string", description: "Event date as YYYY-MM-DD (resolve relative dates using today's date from the system prompt)" },
        time: { type: "string", description: "Time like '3pm' or '15:00', optional" },
        location: { type: "string", description: "Location, optional" },
      },
      required: ["title", "date"],
    },
  },
];

// ─── Tool execution (operates on the user's real data) ──────────
async function executeTool(uid: string, name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "add_task": {
      const title = String(input.title || "").trim();
      if (!title) return "I couldn't add that — no task description was given.";
      const reminder = reminderFromToolInput(input);
      const task = {
        id: crypto.randomUUID(),
        title,
        createdBy: uid,
        category: (input.category as string) || "personal",
        priority: (input.priority as string) || "medium",
        status: "pending",
        source: "cleo",
        // AI-created tasks await user confirmation — Plan surfaces these with
        // a "Confirm" affordance (same flow as school-extracted tasks).
        // Exception: "remind me at 3" is her explicit ask, so it is saved
        // confirmed; otherwise the alert would wait behind Confirm.
        userConfirmed: !!reminder.remindAt,
        ...(input.dueDate ? { dueDate: String(input.dueDate) } : {}),
        ...(reminder.remindAt ? { remindAt: reminder.remindAt } : {}),
        createdAt: Date.now(),
      };
      // Cleo can ask another adult to take it, but never accept on their
      // behalf: the task starts as "asked" and they say yes or no themselves.
      const askName = String(input.askPerson || "").trim();
      if (askName) {
        const { findAdult, proposeNewTask } = await import("./taskActions");
        const adult = findAdult(askName);
        if (adult && adult.uid !== uid) {
          // The user asked for this hand-off in words, so it doesn't wait for their own Confirm.
          await proposeNewTask({ ...task, userConfirmed: true }, adult);
          return `Asked ${adult.name} to take "${title}"${input.dueDate ? ` (due ${input.dueDate})` : ""}. It shows as "Waiting for ${adult.name}" in Plan until ${adult.name} accepts or declines.${reminder.remindAt ? ` If they accept, their phone reminds them ${formatRemindAt(reminder.remindAt)}.` : ""}`;
        }
        await createItem(uid, "tasks", task);
        await bus.publish("plan.task.created", task, { userId: uid, source: "cleo" }).catch(() => {});
        return `I added "${title}" to your own list. I couldn't ask ${askName}, because they aren't in your HerNest household yet (invite them from Your family).`;
      }
      await createItem(uid, "tasks", task);
      await bus.publish("plan.task.created", task, { userId: uid, source: "cleo" }).catch(() => {});
      if (reminder.remindAt) {
        // Ask for notification permission now, the first time she sets one.
        const on = await import("./localNotifications").then(m => m.ensureReminderPermission(uid)).catch(() => null);
        return `Added task "${title}" and set a reminder for ${formatRemindAt(reminder.remindAt)}. Tell the user exactly when you'll remind them.${on !== false ? "" : " (Phone notifications are off on this device, so mention they can turn them on in Settings to get the alert.)"}`;
      }
      const note = reminder.problem ? ` No reminder was set: ${reminder.problem}. Ask the user for the time.` : "";
      return `Added task "${title}"${input.dueDate ? ` (due ${input.dueDate})` : ""} — it's waiting for your confirmation in Plan.${note}`;
    }

    case "complete_task": {
      const q = String(input.title || "").trim().toLowerCase();
      if (!q) return "I couldn't tell which task to complete.";
      const existing = await listItems<any>(uid, "tasks");
      // Fuzzy matching completed the WRONG task when several titles overlapped.
      // Only act on an unambiguous match; otherwise ask instead of guessing.
      const matches = existing.filter(
        (t: any) => t.status !== "completed" && String(t.title || "").toLowerCase().includes(q)
      );
      if (matches.length === 0) return `I couldn't find an open task matching "${input.title}".`;
      if (matches.length > 1) return `A few tasks match "${input.title}": ${matches.slice(0, 3).map((t: any) => `"${t.title}"`).join(", ")}. Which one did you mean?`;
      const match = matches[0];
      const { setTaskDone } = await import("./taskActions");
      await setTaskDone(match, true);
      return `Marked "${match.title}" complete.`;
    }

    case "add_calendar_event": {
      const title = String(input.title || "").trim();
      const date = String(input.date || "").trim();
      if (!title || !date) return "I couldn't add that event — it needs a title and a date.";
      const existing = ((await loadData(uid, "calendar"))?.events as any[]) || [];
      const event = {
        id: crypto.randomUUID(),
        title,
        date,
        source: "manual",
        allDay: !input.time,
        ...(input.time ? { time: String(input.time) } : {}),
        ...(input.location ? { location: String(input.location) } : {}),
      };
      await saveData(uid, "calendar", { events: [...existing, event] });
      await bus.publish("plan.calendar.event.added", event, { userId: uid, source: "cleo" }).catch(() => {});
      return `Added "${title}" to the calendar on ${date}${input.time ? ` at ${input.time}` : ""}.`;
    }

    default:
      return `Unknown action "${name}".`;
  }
}

async function getIdToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    return user ? await user.getIdToken() : null;
  } catch {
    return null;
  }
}

// ─── The agent loop ─────────────────────────────────────────────
// Returns text + a list of actions taken. On a non-OK response, throws so the
// orchestrator can fall back to single-shot chat. An empty text with no tools
// signals "nothing handled" so the caller can also fall back.
export async function runCleoAgent(params: {
  uid: string;
  system: string;
  messages: AgentMessage[];
  model?: string;
}): Promise<AgentResult> {
  const idToken = await getIdToken();
  if (!idToken) throw new Error("not authenticated");

  const convo: AgentMessage[] = params.messages.map((m) => ({ role: m.role, content: m.content }));
  // Anthropic requires the first message to be a user turn.
  while (convo.length && convo[0].role !== "user") convo.shift();
  const actions: string[] = [];
  let usedTools = false;

  for (let i = 0; i < MAX_ITERS; i++) {
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        system: params.system,
        feature: "cleo_chat",
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        model: params.model || AI.SONNET,
        messages: convo,
        tools: TOOLS,
        max_tokens: 2000,
      }),
      signal: timeoutSignal(60_000),   // never leave Cleo "thinking" forever
    });

    if (res.status === 429) throw new Error(await limitReached(res));
    if (!res.ok) throw new Error(`agent_http_${res.status}`);

    const data = await res.json();
    // Server crisis backstop: the model wasn't called (see api/_lib/crisis.js).
    if (data?.crisis) throw new Error("crisis_detected");
    const content: any[] = Array.isArray(data.content) ? data.content : [];
    // Record the assistant turn verbatim (text + any tool_use blocks).
    convo.push({ role: "assistant", content });

    const toolUses = content.filter((b) => b?.type === "tool_use");
    if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = content.filter((b) => b?.type === "text").map((b) => b.text).join("");
      return { text, actions, usedTools };
    }

    usedTools = true;
    const toolResults = [];
    for (const tu of toolUses) {
      let result: string;
      try {
        result = await executeTool(params.uid, tu.name, (tu.input as Record<string, unknown>) || {});
      } catch (e: any) {
        result = `That action failed: ${e?.message || "unknown error"}.`;
      }
      actions.push(result);
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    convo.push({ role: "user", content: toolResults });
  }

  // Ran out of iterations — return what we did with a gentle close.
  return {
    text: actions.length
      ? `Done — ${actions.join(" ")}`
      : "I started on that but need a bit more detail to finish — can you confirm the specifics?",
    actions,
    usedTools,
  };
}

// ─── Streaming variant ──────────────────────────────────────────
// One streamed call: parses Anthropic's SSE, fires onToken for each text delta,
// and reconstructs the full content blocks (incl. tool_use, whose JSON input
// arrives as partial deltas) so the loop can still detect + run tools.
async function streamClaude(params: {
  idToken: string; system: string; model: string; messages: AgentMessage[]; onToken: (t: string) => void;
}): Promise<{ content: any[]; stopReason: string | null }> {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.idToken}` },
    body: JSON.stringify({
      system: params.system, feature: "cleo_chat", model: params.model,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      messages: params.messages, tools: TOOLS, max_tokens: 2000, stream: true,
    }),
    signal: timeoutSignal(90_000),   // a stream cut off when the phone sleeps ends with Try again
  });
  if (res.status === 429) throw new Error(await limitReached(res));
  // Server crisis backstop answers with JSON instead of a stream.
  if (res.ok && res.headers?.get("content-type")?.includes("application/json")) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.crisis ? "crisis_detected" : "agent_stream_bad_response");
  }
  if (!res.ok || !res.body) throw new Error(`agent_stream_http_${res.status}`);

  const blocks: any[] = [];
  const toolJson: Record<number, string> = {};
  let stopReason: string | null = null;

  const handle = (e: any) => {
    if (e.type === "content_block_start") {
      const cb = e.content_block || {};
      // Thinking blocks (Haiku/Sonnet 5.5 think by default) must be replayed
      // unchanged, signature included, when we send tool results back; turning
      // them into empty text blocks made the follow-up request fail.
      if (cb.type === "tool_use") { blocks[e.index] = { type: "tool_use", id: cb.id, name: cb.name, input: {} }; toolJson[e.index] = ""; }
      else if (cb.type === "text") blocks[e.index] = { type: "text", text: "" };
      else blocks[e.index] = { ...cb };
    } else if (e.type === "content_block_delta") {
      const d = e.delta || {};
      const b = blocks[e.index];
      if (d.type === "text_delta") { if (b) b.text += d.text; params.onToken(d.text || ""); }
      else if (d.type === "input_json_delta") { toolJson[e.index] = (toolJson[e.index] || "") + (d.partial_json || ""); }
      else if (d.type === "thinking_delta" && b) { b.thinking = (b.thinking || "") + (d.thinking || ""); }
      else if (d.type === "signature_delta" && b) { b.signature = (b.signature || "") + (d.signature || ""); }
    } else if (e.type === "content_block_stop") {
      const b = blocks[e.index];
      if (b?.type === "tool_use") { try { b.input = JSON.parse(toolJson[e.index] || "{}"); } catch { b.input = {}; } }
    } else if (e.type === "message_delta") {
      if (e.delta?.stop_reason) stopReason = e.delta.stop_reason;
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try { handle(JSON.parse(payload)); } catch { /* ignore partial frames */ }
    }
  }
  // An empty text block is rejected if replayed, so drop those.
  return { content: blocks.filter(b => b && !(b.type === "text" && !b.text)), stopReason };
}

export async function runCleoAgentStreaming(params: {
  uid: string; system: string; messages: AgentMessage[]; model?: string; onToken: (t: string) => void;
}): Promise<AgentResult> {
  const idToken = await getIdToken();
  if (!idToken) throw new Error("not authenticated");
  const convo: AgentMessage[] = params.messages.map((m) => ({ role: m.role, content: m.content }));
  while (convo.length && convo[0].role !== "user") convo.shift();
  const actions: string[] = [];
  let usedTools = false;

  for (let i = 0; i < MAX_ITERS; i++) {
    const { content, stopReason } = await streamClaude({
      idToken, system: params.system, model: params.model || AI.SONNET, messages: convo, onToken: params.onToken,
    });
    convo.push({ role: "assistant", content });
    const toolUses = content.filter((b: any) => b?.type === "tool_use");
    if (stopReason !== "tool_use" || toolUses.length === 0) {
      const text = content.filter((b: any) => b?.type === "text").map(b => b.text).join("");
      return { text, actions, usedTools };
    }
    usedTools = true;
    const toolResults = [];
    for (const tu of toolUses) {
      let result: string;
      try { result = await executeTool(params.uid, tu.name, (tu.input as Record<string, unknown>) || {}); }
      catch (e: any) { result = `That action failed: ${e?.message || "unknown error"}.`; }
      actions.push(result);
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    convo.push({ role: "user", content: toolResults });
  }
  return { text: actions.length ? `Done — ${actions.join(" ")}` : "I started on that but need a bit more detail to finish.", actions, usedTools };
}
