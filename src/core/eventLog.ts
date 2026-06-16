// ─── HerNest Event Log (migration Step 2) ───────────────────────
// Makes the in-memory bus durable + household-scoped. Every non-ephemeral
// published event is written to a local Dexie log (survives reload,
// offline-first — the source of truth for the timeline) and best-effort
// mirrored to Firestore households/{id}/events/{id}. Powers the household
// timeline + replay. All ops are non-fatal: if persistence fails, the live
// event fan-out is unaffected.

import { collection, doc, setDoc, getDocs, query, orderBy, limit as fblimit } from "firebase/firestore";
import { db as fdb } from "./firebase";
import { db as localDb, type LoggedEvent } from "./db";

// Append one event: durable locally, best-effort to the cloud.
export async function appendEvent(event: LoggedEvent): Promise<void> {
  try {
    await localDb.events.put(event); // fast, durable, offline-first
  } catch (e) {
    console.warn("[EventLog] local append failed (non-fatal):", e);
  }
  // Cloud mirror is fire-and-forget so the live event loop never waits on the
  // network. Requires Firestore rules allowing members to write households/{id}/events.
  setDoc(
    doc(fdb, "households", event.householdId, "events", event.id),
    event as unknown as Record<string, unknown>,
  ).catch((e) => console.warn("[EventLog] cloud mirror failed (non-fatal):", e));
}

export interface TimelineQuery {
  limit?: number;
  types?: string[];
  since?: number; // include events with occurredAt >= since
}

// Read the household timeline from the local log (instant, offline-friendly).
export async function getHouseholdTimeline(
  householdId: string,
  q: TimelineQuery = {},
): Promise<LoggedEvent[]> {
  try {
    let rows = await localDb.events.where("householdId").equals(householdId).toArray();
    if (q.since) rows = rows.filter((e) => e.occurredAt >= q.since!);
    if (q.types?.length) rows = rows.filter((e) => q.types!.includes(e.type));
    rows.sort((a, b) => b.occurredAt - a.occurredAt);
    return rows.slice(0, q.limit ?? 100);
  } catch (e) {
    console.warn("[EventLog] timeline read failed (non-fatal):", e);
    return [];
  }
}

// Hydrate the local log from the shared cloud log (multi-device / multi-login).
// Called on household bootstrap. Best-effort; needs Firestore read rules.
export async function pullCloudEvents(householdId: string, max = 200): Promise<number> {
  try {
    const snap = await getDocs(
      query(
        collection(fdb, "households", householdId, "events"),
        orderBy("occurredAt", "desc"),
        fblimit(max),
      ),
    );
    if (snap.empty) return 0;
    const events = snap.docs.map((d) => d.data() as LoggedEvent);
    await localDb.events.bulkPut(events);
    return events.length;
  } catch (e) {
    console.warn("[EventLog] cloud pull failed (non-fatal):", e);
    return 0;
  }
}
