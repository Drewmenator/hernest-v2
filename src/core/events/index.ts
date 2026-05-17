// ─── HerNest Event Bus ────────────────────────────────────────────
// Every module communicates through events.
// No module imports from another module directly.

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
  | "account.deleted"
  | "settings.updated"
  | "briefing.invalidate"
  | "calendar.connected"
  | "calendar.synced"
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
  // Nora
  | "nora.conversation.ended"
  | "nora.task.extracted"
  | "nora.crisis.detected"
  | "nora.memory.updated"
  // System
  | "system.ai.limit.reached"
  | "system.sync.completed"
  | "system.offline"
  | "system.online";

export interface HerNestEvent<T = unknown> {
  id: string;
  type: EventType;
  timestamp: number;
  userId: string;
  payload: T;
  source: string; // which module fired it
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
    meta: { userId: string; source: string }
  ): Promise<void> {
    const event: HerNestEvent<T> = {
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      userId: meta.userId,
      source: meta.source,
      payload,
    };

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
