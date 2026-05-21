// ─── HerNest Memory Service ───────────────────────────────────────
// Per blueprint: extracts facts from conversations and stores in Firestore
// Every Cleo conversation → fact extraction → memory graph

import { saveData, loadData } from "./firebase";
import { ai } from "./ai";
import { bus } from "./events";

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
Return ONLY valid JSON array, no markdown:
[{"statement":"string","type":"family|health|preference|goal|schedule|temporary","confidence":0.0-1.0}]
Only extract clear, specific facts. Ignore vague statements.
Maximum 5 facts per conversation. Return [] if nothing clear to extract.`;

  const result = await ai(sys, `Extract facts from: ${userMessages}`, "cleo_chat");
  if (result.error) return [];

  try {
    const extracted = JSON.parse(result.text.replace(/```json|```/g, "").trim());
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

// Save facts to Firestore, merge with existing
export async function saveMemoryFacts(
  userId: string,
  newFacts: MemoryFact[]
): Promise<void> {
  if (!newFacts.length) return;

  try {
    const existing = await loadData(userId, "cleo_memory");
    const existingFacts: MemoryFact[] = (existing?.facts as MemoryFact[]) || [];

    // Deduplicate — don't add if similar statement already exists
    const filtered = newFacts.filter(newFact =>
      !existingFacts.some(ef =>
        ef.statement.toLowerCase().includes(newFact.statement.toLowerCase().substring(0, 20))
      )
    );

    if (!filtered.length) return;

    // Remove expired temporary facts
    const now = Date.now();
    const valid = existingFacts.filter(f => !f.expiresAt || f.expiresAt > now);

    const merged = [...filtered, ...valid].slice(0, 100); // Max 100 facts
    await saveData(userId, "cleo_memory", { facts: merged });

    await bus.publish(
      "cleo.memory.updated",
      { added: filtered.length, total: merged.length },
      { userId, source: "memory" }
    );
  } catch (e) {
    console.error("[Memory] Save failed:", e);
  }
}

// Load all memory facts for a user
export async function loadMemoryFacts(userId: string): Promise<MemoryFact[]> {
  try {
    const data = await loadData(userId, "cleo_memory");
    if (!data?.facts) return [];
    const now = Date.now();
    return (data.facts as MemoryFact[]).filter(f => !f.expiresAt || f.expiresAt > now);
  } catch {
    return [];
  }
}

// Build memory context string for AI prompts
export async function buildMemoryContext(userId: string): Promise<string> {
  const facts = await loadMemoryFacts(userId);
  if (!facts.length) return "";

  const byType = facts.reduce((acc, f) => {
    if (!acc[f.type]) acc[f.type] = [];
    acc[f.type].push(f.statement);
    return acc;
  }, {} as Record<string, string[]>);

  const lines: string[] = [];
  if (byType.family)     lines.push(`Family: ${byType.family.join(". ")}`);
  if (byType.health)     lines.push(`Health: ${byType.health.join(". ")}`);
  if (byType.preference) lines.push(`Preferences: ${byType.preference.join(". ")}`);
  if (byType.goal)       lines.push(`Goals: ${byType.goal.join(". ")}`);
  if (byType.schedule)   lines.push(`Schedule: ${byType.schedule.join(". ")}`);
  if (byType.temporary)  lines.push(`Currently: ${byType.temporary.join(". ")}`);

  return lines.join("\n");
}
