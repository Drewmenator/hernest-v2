// ─── HerNest Intelligence Event Subscriptions ────────────────────
// Wires the event bus to the intelligence layer.
// Called once on app init alongside connectModules().
//
// What this does:
//   Module events → intelligence layer reactions
//
// Trip created             → invalidate cache, flag travel_prep
// Task completed           → invalidate cache
// Cleo conversation ended  → memory writeback v2
// Cleo memory updated      → invalidate retrieval cache
// Profile updated          → invalidate all cache
// Thrive logged            → invalidate cache for wellness

import { bus } from "./events";
import { invalidateCache, clearUserCache } from "./contextRetrieval";
import { proposeMemory } from "./memoryServiceV2";

// ─── Main setup function ──────────────────────────────────────────
export function connectIntelligenceLayer(userId: string): () => void {
  const unsubs: Array<() => void> = [];

  // ── 3. Trip created → invalidate trips + calendar cache ──────────
  unsubs.push(bus.subscribe("trips.trip.created", async () => {
    invalidateCache(userId, ["trips", "calendar"]);
  }));

  // ── 4. Task created/completed → invalidate tasks cache ───────────
  unsubs.push(bus.subscribe("plan.task.created", async () => {
    invalidateCache(userId, ["tasks"]);
  }));

  unsubs.push(bus.subscribe("plan.task.completed", async () => {
    invalidateCache(userId, ["tasks"]);
  }));

  // ── 5. Calendar synced → invalidate calendar cache ───────────────
  unsubs.push(bus.subscribe("calendar.synced", async () => {
    invalidateCache(userId, ["calendar"]);
  }));

  // ── 5b. Cleo/manual calendar adds → invalidate calendar cache ────
  // Previously a dead event: after Cleo's agent added an event, her own
  // retrieval cache stayed stale for up to 5 minutes.
  unsubs.push(bus.subscribe("plan.calendar.event.added", async () => {
    invalidateCache(userId, ["calendar"]);
  }));

  // ── 6. Cleo conversation ended → memory writeback v2 ─────────────
  unsubs.push(bus.subscribe("cleo.conversation.ended", async (e: any) => {
    const { messages } = e.payload ?? {};
    if (!messages?.length) return;

    // Extract preference signals from conversation
    const userMessages = messages
      .filter((m: any) => m.role === "user")
      .map((m: any) => m.content as string)
      .join(" ");

    // Simple preference detection — propose if strong signal. Proposals are
    // inferred, so they wait for the user's yes before Cleo uses them.
    const prefPatterns: Array<{ pattern: RegExp; title: string; content: string }> = [
      {
        pattern: /prefer.*sunday|sunday.*planning|plan.*sunday/i,
        title:   "Prefers Sunday planning",
        content: "User prefers to do household planning on Sundays.",
      },
      {
        pattern: /emergency fund.*first|protect.*emergency|emergency.*before/i,
        title:   "Prioritizes emergency fund",
        content: "User prefers to protect the emergency fund before discretionary spending.",
      },
      {
        pattern: /don't.*remind|stop.*remind|too many.*notif/i,
        title:   "Prefers fewer notifications",
        content: "User has expressed preference for fewer notifications.",
      },
    ];

    for (const { pattern, title, content } of prefPatterns) {
      if (pattern.test(userMessages)) {
        proposeMemory(userId, {
          type:                "preference",
          title,
          content,
          sourceModule:        "cleo",
          confidence:          "medium",
          sensitivity:         "low",
          evidenceDescription: "Detected in Cleo conversation",
        }).catch(() => {});
        break; // one preference per conversation
      }
    }
  }));

  // ── 7. Memory updated → invalidate memory cache ──────────────────
  unsubs.push(bus.subscribe("cleo.memory.updated", async () => {
    invalidateCache(userId, ["cleo_memory", "cleo_memory_v2"]);
  }));

  // ── 8. Profile updated → clear all user cache + invalidate briefing
  unsubs.push(bus.subscribe("profile.updated", async () => {
    clearUserCache(userId);
    bus.publish("briefing.invalidate", {}, { userId, source: "intelligence" }).catch(() => {});
  }));

  // ── 8b. Key data changes → invalidate briefing ───────────────────
  ["plan.task.created", "plan.task.completed", "trips.trip.created"].forEach(evt => {
    unsubs.push(bus.subscribe(evt as any, async () => {
      bus.publish("briefing.invalidate", {}, { userId, source: "intelligence" }).catch(() => {});
    }));
  });

  // ── 9. Thrive logged → invalidate thrive cache ───────────────────
  unsubs.push(bus.subscribe("thrive.sleep.logged", async () => {
    invalidateCache(userId, ["thrive"]);
    // Last night's sleep arrives once a morning (often after the first look):
    // rewrite the briefing so it includes it, instead of keeping the
    // sleep-less one all day.
    bus.publish("briefing.invalidate", { reason: "sleep_logged" }, { userId, source: "intelligence" }).catch(() => {});
  }));

  unsubs.push(bus.subscribe("thrive.mood.logged", async () => {
    invalidateCache(userId, ["thrive"]);
  }));

  unsubs.push(bus.subscribe("thrive.habit.completed", async () => {
    invalidateCache(userId, ["thrive"]);
  }));

  // ── Style preference → memory (a suggestion until she says yes) ──
  unsubs.push(bus.subscribe("style.preference.updated", async (e: any) => {
    const { vibe, colorSeason } = e.payload ?? {};
    if (vibe || colorSeason) {
      proposeMemory(userId, {
        type: "preference",
        title: "Style preferences",
        content: `Prefers ${vibe || ""}${colorSeason ? " · " + colorSeason + " color season" : ""} style`,
        sourceModule: "cleo",
        confidence: "high",
        sensitivity: "low",
        evidenceDescription: "Set in Style module",
      }).catch(() => {});
    }
  }));

  // Return cleanup function
  return () => unsubs.forEach(unsub => unsub());
}
