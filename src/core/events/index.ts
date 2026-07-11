// ─── HerNest Event Bus ────────────────────────────────────────────
// Every module communicates through events.
// No module imports from another module directly.

import { getHouseholdId } from "../identity";
import { appendEvent } from "../eventLog";
import type { LoggedEvent } from "../db";

export type EventType =
  // Auth
  | "auth.user.signed_in"
  | "auth.user.signed_out"
  // Profile
  | "profile.updated"
  | "profile.goal.added"
  // Plan
  | "family.updated"
  | "plan.task.created"
  | "plan.task.completed"
  | "plan.task.deleted"
  | "plan.calendar.event.added"
  | "plan.school.newsletter.parsed"
  | "plan.meal.generated"
  // Budget
  | "budget.expense.logged"
  | "budget.expense.anomaly"
  | "budget.threshold.hit"
  | "budget.savings.goal.created"
  | "budget.month.reset"
  // Thrive
  | "thrive.sleep.logged"
  | "thrive.water.logged"
  | "thrive.mood.logged"
  | "thrive.habit.completed"
  | "thrive.score.generated"
  // Style
  | "style.outfit.generated"
  | "style.outfit.saved"
  | "style.preference.updated"
  // Trips
  | "trips.trip.created"
  | "partner.invite.sent"
  | "partner.invite.accepted"
  | "intelligence.insight.requested"
  | "account.deleted"
  | "settings.updated"
  | "briefing.invalidate"
  | "calendar.connected"
  | "calendar.synced"
  | "budget.receipts.found"
  | "trips.trip.approaching"
  | "trips.trip.completed"
  // Circle
  | "circle.checkin.due"
  | "circle.birthday.approaching"
  | "circle.contact.added"
  // Briefing
  | "briefing.generated"
  | "briefing.viewed"
  | "briefing.section.stale"
  // Cleo
  | "cleo.conversation.ended"
  | "cleo.task.extracted"
  | "cleo.crisis.detected"
  | "cleo.memory.updated"
  // System
  | "system.ai.limit.reached"
  | "system.sync.completed"
  | "system.offline"
  | "system.online";

export type EventVisibility = "private" | "partners" | "household" | "cleo_only";

export interface HerNestEvent<T = unknown> {
  id: string;
  type: EventType;
  timestamp: number;
  userId: string;
  payload: T;
  source: string; // which module fired it
  // ── migration Step 2: durable, household-scoped envelope (optional = back-compat) ──
  householdId?: string;
  actorUserId?: string;
  subjectMemberId?: string;
  occurredAt?: number;
  recordedAt?: number;
  visibility?: EventVisibility;
  confidence?: number;
  schemaVersion?: number;
}

// High-frequency / transient events we don't persist to the durable log.
const EPHEMERAL_EVENTS = new Set<EventType>([
  "system.online",
  "system.offline",
  "system.sync.completed",
  "briefing.viewed",
  "briefing.section.stale",
  "briefing.invalidate",
  "intelligence.insight.requested",
]);

// Household push: which shared actions are worth interrupting a partner for,
// and how to phrase them. Deliberately excludes high-frequency/low-signal
// events (e.g. every logged expense). Title is the actor's name (server-set).
const HOUSEHOLD_PUSH: Partial<Record<EventType, { screen: string; summary: (p: any) => string }>> = {
  "plan.task.created":          { screen: "plan",     summary: (p) => `added a task${p?.title || p?.text ? `: ${p.title || p.text}` : ""}` },
  "plan.calendar.event.added":  { screen: "calendar", summary: (p) => `added to the calendar${p?.title ? `: ${p.title}` : ""}` },
  "trips.trip.created":         { screen: "trips",    summary: (p) => `started planning a trip${p?.destination || p?.name ? ` to ${p.destination || p.name}` : ""}` },
  "plan.school.newsletter.parsed": { screen: "plan",  summary: () => `added school events to the calendar` },
  "budget.savings.goal.created": { screen: "budget",  summary: (p) => `set a savings goal${p?.name ? `: ${p.name}` : ""}` },
};

function toLoggedEvent(e: HerNestEvent): LoggedEvent {
  return {
    id: e.id,
    householdId: e.householdId ?? e.userId,
    type: e.type,
    source: e.source,
    actorUserId: e.actorUserId ?? e.userId,
    subjectMemberId: e.subjectMemberId,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    visibility: e.visibility ?? "household",
    confidence: e.confidence ?? 1,
    occurredAt: e.occurredAt ?? e.timestamp,
    recordedAt: e.recordedAt ?? e.timestamp,
    schemaVersion: e.schemaVersion ?? 1,
  };
}

type Handler<T = unknown> = (event: HerNestEvent<T>) => void | Promise<void>;

class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  subscribe<T = unknown>(type: EventType | "*", handler: Handler<T>): () => void {
    const key = type;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler as Handler);

    // Return unsubscribe function
    return () => this.handlers.get(key)?.delete(handler as Handler);
  }

  async publish<T = unknown>(
    type: EventType,
    payload: T,
    meta: {
      userId: string;
      source: string;
      subjectMemberId?: string;
      visibility?: EventVisibility;
      occurredAt?: number;
      confidence?: number;
    }
  ): Promise<void> {
    const now = Date.now();
    const event: HerNestEvent<T> = {
      id: crypto.randomUUID(),
      type,
      timestamp: now,
      userId: meta.userId,
      source: meta.source,
      payload,
      householdId: getHouseholdId() ?? meta.userId,
      actorUserId: meta.userId,
      subjectMemberId: meta.subjectMemberId,
      occurredAt: meta.occurredAt ?? now,
      recordedAt: now,
      visibility: meta.visibility ?? "household",
      confidence: meta.confidence ?? 1,
      schemaVersion: 1,
    };

    // ── Durable write-through (migration Step 2) — non-fatal, skips noise ──
    if (!EPHEMERAL_EVENTS.has(type)) {
      try {
        await appendEvent(toLoggedEvent(event as HerNestEvent));
      } catch (e) {
        console.error(`[EventBus] persist failed for ${type}:`, e);
      }
    }

    // ── Household push (best-effort) — tell partners about shared actions ──
    const hp = HOUSEHOLD_PUSH[type];
    if (hp && (event.visibility === "partners" || event.visibility === "household")) {
      import("../pushNotifications")
        .then((m) => m.notifyHousehold(hp.summary(payload), hp.screen))
        .catch(() => {});
    }

    // Specific handlers
    const specific = this.handlers.get(type);
    if (specific) {
      for (const handler of specific) {
        try { await handler(event as HerNestEvent); } catch (e) {
          console.error(`[EventBus] Handler error for ${type}:`, e);
        }
      }
    }

    // Wildcard handlers
    const wildcard = this.handlers.get("*");
    if (wildcard) {
      for (const handler of wildcard) {
        try { await handler(event as HerNestEvent); } catch (e) {
          console.error(`[EventBus] Wildcard handler error:`, e);
        }
      }
    }
  }
}

// Singleton
export const bus = new EventBus();
