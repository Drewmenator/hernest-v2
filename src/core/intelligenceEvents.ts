// ─── HerNest Intelligence Event Subscriptions ────────────────────
// Wires the event bus to the intelligence layer.
// Called once on app init alongside connectModules().
//
// What this does:
//   Module events → intelligence layer reactions
//
// Budget expense logged    → check insight rules, propose memory
// Budget threshold hit     → invalidate retrieval cache, flag state
// Trip created             → invalidate cache, flag travel_prep
// Task completed           → invalidate cache
// Nora conversation ended  → memory writeback v2
// Nora memory updated      → invalidate retrieval cache
// Profile updated          → invalidate all cache
// Thrive logged            → invalidate cache for wellness

import { bus } from "./events";
import { invalidateCache, clearUserCache } from "./contextRetrieval";
import { proposeMemory } from "./memoryServiceV2";

// ─── Helper: extract spending pattern from expense ────────────────
function buildSpendingMemoryCandidate(category: string, pct: number) {
  return {
    type:                "pattern" as const,
    title:               `${category} spending tends to run high`,
    content:             `${category} spending reached ${pct}% of budget. This may indicate a recurring pattern worth tracking.`,
    sourceModule:        "finances" as const,
    confidence:          pct >= 95 ? "high" as const : "medium" as const,
    sensitivity:         "low" as const,
    evidenceDescription: `${category} at ${pct}% of monthly budget`,
  };
}

// ─── Main setup function ──────────────────────────────────────────
export function connectIntelligenceLayer(userId: string): () => void {
  const unsubs: Array<() => void> = [];

  // ── 1. Budget expense logged → invalidate budget cache ──────────
  unsubs.push(bus.subscribe("budget.expense.logged", async () => {
    invalidateCache(userId, ["budget_v2", "budget"]);
  }));

  // ── 2. Budget threshold hit → propose memory + invalidate ────────
  unsubs.push(bus.subscribe("budget.threshold.hit", async (e: any) => {
    const { category, percentUsed } = e.payload;
    invalidateCache(userId, ["budget_v2", "budget"]);

    // Only propose memory for consistently high spending (≥90%)
    if (percentUsed >= 90) {
      proposeMemory(userId, buildSpendingMemoryCandidate(category, percentUsed))
        .catch(() => {}); // non-fatal
    }

    // Auto-trigger insight generation for critical overspend
    if (percentUsed >= 100) {
      bus.publish("budget.threshold.hit", { trigger: "budget_overspend", category, percentUsed }, { userId, source: "intelligence" }).catch(() => {});
    }
  }));

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

  // ── 6. Nora conversation ended → memory writeback v2 ─────────────
  unsubs.push(bus.subscribe("nora.conversation.ended", async (e: any) => {
    const { messages } = e.payload ?? {};
    if (!messages?.length) return;

    // Extract preference signals from conversation
    const userMessages = messages
      .filter((m: any) => m.role === "user")
      .map((m: any) => m.content as string)
      .join(" ");

    // Simple preference detection — propose if strong signal
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
          sourceModule:        "nora",
          confidence:          "medium",
          sensitivity:         "low",
          evidenceDescription: "Detected in Nora conversation",
        }).catch(() => {});
        break; // one preference per conversation
      }
    }
  }));

  // ── 7. Memory updated → invalidate memory cache ──────────────────
  unsubs.push(bus.subscribe("nora.memory.updated", async () => {
    invalidateCache(userId, ["nora_memory", "nora_memory_v2"]);
  }));

  // ── 8. Profile updated → clear all user cache ────────────────────
  unsubs.push(bus.subscribe("profile.updated", async () => {
    clearUserCache(userId);
  }));

  // ── 9. Thrive logged → invalidate thrive cache ───────────────────
  unsubs.push(bus.subscribe("thrive.sleep.logged", async () => {
    invalidateCache(userId, ["thrive"]);
  }));

  unsubs.push(bus.subscribe("thrive.mood.logged", async () => {
    invalidateCache(userId, ["thrive"]);
  }));

  unsubs.push(bus.subscribe("thrive.habit.completed", async () => {
    invalidateCache(userId, ["thrive"]);
  }));

  // ── 10. Goals updated → invalidate budget cache ──────────────────
  unsubs.push(bus.subscribe("budget.savings.goal.created", async () => {
    invalidateCache(userId, ["budget_v2"]);
  }));

  // Return cleanup function
  return () => unsubs.forEach(unsub => unsub());
}
