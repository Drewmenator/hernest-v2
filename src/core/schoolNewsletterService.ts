// ─── School newsletter extraction (shared) ─────────────────────────
// PlanScreen and CalendarScreen each had their own extraction with
// DIFFERENT schemas writing to the same "school" collection — and the
// calendar copy's JSON slicing ({…} instead of […]) silently failed on
// newsletters with more than one event. One service, one schema, and the
// API returns exactly that shape (structured outputs), so no JSON slicing.
import { ai } from "./ai";
import { s } from "./aiSchema";
import { loadData, saveData } from "./firebase";
import { bus } from "./events";
import { todayLocal } from "./dateAwareness";

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

// Fixed answer shape (structured outputs). The API only accepts an object at
// the root, so the event list is wrapped in { events }.
const EVENTS_SCHEMA = s.object({
  events: s.array(s.object({
    title: s.string(),
    date: s.string("YYYY-MM-DD"),
    time: s.nullable(s.string()),
    type: s.enum(["academic", "sport", "social", "parent-evening", "trip", "deadline"]),
    requiresAction: s.boolean(),
    actionType: s.enum(["permission-slip", "payment", "rsvp", "supply-list", "costume", "none"]),
    actionDeadline: s.nullable(s.string("YYYY-MM-DD")),
    notes: s.nullable(s.string()),
  })),
});

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
  const today = todayLocal();
  const sys = `You are Cleo extracting school events${childName ? ` for ${childName}` : ""}. ONLY extract events explicitly mentioned in the text — never infer or invent events not clearly stated.
Today: ${today}. Extract ALL events, deadlines, and action items. Be thorough.`;

  const result = await ai(sys, text, "school_calendar", [], { schema: EVENTS_SCHEMA });
  if (result.error) return { events: [], allEvents: [], actionCount: 0, error: result.error };

  let parsed: any[];
  try {
    parsed = JSON.parse(result.text).events;
    if (!Array.isArray(parsed)) throw new Error("No events array in response");
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
