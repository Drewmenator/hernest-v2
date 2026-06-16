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
import { AI } from "../config";

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
      const existing = ((await loadData(uid, "tasks"))?.tasks as any[]) || [];
      const task = {
        id: crypto.randomUUID(),
        title,
        category: (input.category as string) || "personal",
        priority: (input.priority as string) || "medium",
        status: "pending",
        source: "cleo",
        ...(input.dueDate ? { dueDate: String(input.dueDate) } : {}),
      };
      await saveData(uid, "tasks", { tasks: [...existing, task] });
      await bus.publish("plan.task.created", task, { userId: uid, source: "cleo" }).catch(() => {});
      return `Added task "${title}"${input.dueDate ? ` (due ${input.dueDate})` : ""}.`;
    }

    case "complete_task": {
      const q = String(input.title || "").trim().toLowerCase();
      if (!q) return "I couldn't tell which task to complete.";
      const existing = ((await loadData(uid, "tasks"))?.tasks as any[]) || [];
      const match = existing.find(
        (t: any) => t.status !== "completed" && String(t.title || "").toLowerCase().includes(q)
      );
      if (!match) return `I couldn't find an open task matching "${input.title}".`;
      const updated = existing.map((t: any) => (t.id === match.id ? { ...t, status: "completed" } : t));
      await saveData(uid, "tasks", { tasks: updated });
      await bus.publish("plan.task.completed", match, { userId: uid, source: "cleo" }).catch(() => {});
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
        model: params.model || AI.SONNET,
        messages: convo,
        tools: TOOLS,
        max_tokens: 2000,
      }),
    });

    if (res.status === 429) {
      window.dispatchEvent(new CustomEvent("hn_limit_reached"));
      throw new Error("daily_limit_reached");
    }
    if (!res.ok) throw new Error(`agent_http_${res.status}`);

    const data = await res.json();
    const content: any[] = Array.isArray(data.content) ? data.content : [];
    // Record the assistant turn verbatim (text + any tool_use blocks).
    convo.push({ role: "assistant", content });

    const toolUses = content.filter((b) => b?.type === "tool_use");
    if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = content.find((b) => b?.type === "text")?.text || "";
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
