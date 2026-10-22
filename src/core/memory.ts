// ─── Memory helpers ────────────────────────────────────────────────
// What's left of the version-1 memory layer: the fact extractor Cleo runs
// after a conversation (its facts are saved through memoryServiceV2's
// proposeMemory) and the daily tidy-up. Saving, loading and deleting go
// through memoryServiceV2 directly since simplify phase 3.

import { ai } from "./ai";
import { s } from "./aiSchema";
import { decayAndExpireMemories } from "./memoryServiceV2";

export interface MemoryFact {
  id: string;
  statement: string;
  type: "family" | "health" | "preference" | "goal" | "schedule" | "temporary";
  source: "conversation" | "user-stated" | "inferred";
  confidence: number;
  createdAt: number;
  expiresAt?: number;
}

// Extract facts from a conversation using Claude
export async function extractFactsFromConversation(
  messages: Array<{ role: string; content: string }>,
  userId: string
): Promise<MemoryFact[]> {
  if (!messages.length) return [];

  const userMessages = messages
    .filter(m => m.role === "user")
    .map(m => m.content)
    .join("\n");

  if (userMessages.trim().length < 20) return [];

  const sys = `You are a fact extractor for an AI assistant. 
Extract atomic facts about the user from their messages.
Only extract clear, specific facts. Ignore vague statements.
Maximum 5 facts per conversation. Return an empty facts list if nothing clear to extract.`;

  // Root must be an object, so the fact list is wrapped in { facts }.
  const schema = s.object({
    facts: s.array(s.object({
      statement: s.string(),
      type: s.enum(["family", "health", "preference", "goal", "schedule", "temporary"]),
      confidence: s.number("0.0 to 1.0"),
    })),
  });

  const result = await ai(sys, `Extract facts from: ${userMessages}`, "cleo_chat", [], { schema });
  if (result.error) return [];

  try {
    const extracted = JSON.parse(result.text).facts;
    if (!Array.isArray(extracted)) return [];

    return extracted
      .filter((f: any) => f.statement && f.type && f.confidence > 0.6)
      .map((f: any) => ({
        id: crypto.randomUUID(),
        statement: f.statement,
        type: f.type,
        source: "conversation" as const,
        confidence: f.confidence,
        createdAt: Date.now(),
        expiresAt: f.type === "temporary" ? Date.now() + 7 * 24 * 60 * 60 * 1000 : undefined,
      }));
  } catch {
    return [];
  }
}

// ─── V1 API, backed by the V2 store ─────────────────────────────────
// There used to be two memory stores (cleo_memory and V2's household memory)
// written by different screens, so Cleo saw different things depending on
// where you asked. These functions keep their old signatures but read and
// write V2 only, so there is one memory of record (memoryServiceV2.ts).

// Once a day on app open: expire temporary memories and lower the confidence
// of stale ones (decayAndExpireMemories was written but never called).
export async function maintainMemory(userId: string): Promise<void> {
  const key = `hn_memory_maintained_${userId}`;
  const today = new Date().toISOString().slice(0, 10);
  try { if (localStorage.getItem(key) === today) return; } catch { /* storage unavailable */ }
  await decayAndExpireMemories(userId).catch(e => console.warn("[Memory] decay failed:", e));
  try { localStorage.setItem(key, today); } catch { /* storage unavailable */ }
}
