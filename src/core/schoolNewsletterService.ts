// ─── School newsletter extraction (shared) ─────────────────────────
// PlanScreen and CalendarScreen each had their own extraction with
// DIFFERENT schemas writing to the same "school" collection — and the
// calendar copy's JSON slicing ({…} instead of […]) silently failed on
// newsletters with more than one event. One service, one schema, one
// robust parser.
import { ai } from "./ai";
import { loadData, saveData } from "./firebase";
import { bus } from "./events";

export interface SchoolEvent {
  id: string;
  title: string;
  date: string;              // YYYY-MM-DD
  time?: string;
  child?: string;
  type?: "academic" | "sport" | "social" | "parent-evening" | "trip" | "deadline";
  requiresAction: boolean;
  actionType?: "permission-slip" | "payment" | "rsvp" | "supply-list" | "costume" | "none";
  actionDeadline?: string;
  notes?: string;
}

const PROMPT_SCHEMA = `[{
  "title":"string",
  "date":"YYYY-MM-DD",
  "time":"string or null",
  "type":"academic|sport|social|parent-evening|trip|deadline",
  "requiresAction":true/false,
  "actionType":"permission-slip|payment|rsvp|supply-list|costume|none",
  "actionDeadline":"YYYY-MM-DD or null",
  "notes":"string or null"
}]`;

function parseJsonArray(raw: string): any[] {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const s = cleaned.indexOf("[");
  const e = cleaned.lastIndexOf("]");
  if (s === -1 || e === -1 || e <= s) throw new Error("No JSON array in response");
  const parsed = JSON.parse(cleaned.slice(s, e + 1));
  if (!Array.isArray(parsed)) throw new Error("Response is not an array");
  return parsed;
}

export interface ExtractionResult {
  events: SchoolEvent[];      // the newly extracted events
  allEvents: SchoolEvent[];   // the full persisted school collection after merge
  actionCount: number;
  error?: string;
}

// Extract events from pasted newsletter text and persist to the shared
// "school" collection. When childName is given, that child's previous
// events are replaced (repasting an updated newsletter shouldn't double up);
// otherwise new events merge in, deduped by title+date.
export async function extractSchoolEvents(
  userId: string,
  text: string,
  childName?: string
): Promise<ExtractionResult> {
  const today = new Date().toISOString().split("T")[0];
  const sys = `You are Cleo extracting school events${childName ? ` for ${childName}` : ""}. ONLY extract events explicitly mentioned in the text — never infer or invent events not clearly stated. Return ONLY valid JSON array:
${PROMPT_SCHEMA}
Today: ${today}. Extract ALL events, deadlines, and action items. Be thorough.`;

  const result = await ai(sys, text, "school_calendar");
  if (result.error) return { events: [], allEvents: [], actionCount: 0, error: result.error };

  let parsed: any[];
  try {
    parsed = parseJsonArray(result.text);
  } catch (e) {
    console.warn("[SchoolNewsletter] parse failed:", e);
    return { events: [], allEvents: [], actionCount: 0, error: "parse_failed" };
  }

  const events: SchoolEvent[] = parsed
    .filter(e => e?.title && /^\d{4}-\d{2}-\d{2}$/.test(e?.date || ""))
    .map(e => ({
      id: crypto.randomUUID(),
      title: String(e.title),
      date: e.date,
      time: e.time || undefined,
      child: childName || e.child || undefined,
      type: e.type || undefined,
      requiresAction: !!e.requiresAction && e.actionType !== "none",
      actionType: e.actionType && e.actionType !== "none" ? e.actionType : undefined,
      actionDeadline: e.actionDeadline || undefined,
      notes: e.notes || undefined,
    }));

  // Merge into the shared collection
  const existing = ((await loadData(userId, "school"))?.events as SchoolEvent[]) || [];
  let allEvents: SchoolEvent[];
  if (childName) {
    allEvents = [...existing.filter(e => e.child !== childName), ...events];
  } else {
    const seen = new Set(existing.map(e => `${e.title}_${e.date}`.toLowerCase()));
    allEvents = [...existing, ...events.filter(e => !seen.has(`${e.title}_${e.date}`.toLowerCase()))];
  }
  await saveData(userId, "school", { events: allEvents });

  const actionCount = events.filter(e => e.requiresAction).length;
  bus.publish("plan.school.newsletter.parsed", { events: events.length, actionItems: actionCount }, { userId, source: "school" }).catch(() => {});

  return { events, allEvents, actionCount };
}
