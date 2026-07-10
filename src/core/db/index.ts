// ─── HerNest Local Database (Dexie/IndexedDB) ────────────────────
import Dexie, { type Table } from "dexie";

// ── Types ──────────────────────────────────────────────────────────
export interface LocalDoc {
  id: string;
  collection: string;
  data: Record<string, unknown>;
  syncStatus: "synced" | "pending" | "conflict" | "error";
  lastModified: number;
  userId: string;
}

export interface SyncQueueItem {
  id?: number;
  operation: "create" | "update" | "delete";
  collection: string;
  documentId: string;
  data?: Record<string, unknown>;
  timestamp: number;
  status: "pending" | "processing" | "completed" | "failed";
  retryCount: number;
  nextRetry?: number;
  error?: string;
}

export interface CachedBriefing {
  date: string; // YYYY-MM-DD — primary key
  data: Record<string, unknown>;
  generatedAt: number;
  stale: boolean;
}

export interface ChatSession {
  sessionId: string;
  messages: Array<{ role: string; content: string; timestamp: number }>;
  lastMessageAt: number;
  userId: string;
}

// migration Step 2: durable, household-scoped event log entry
export interface LoggedEvent {
  id: string;
  householdId: string;
  type: string;
  source: string;
  actorUserId: string;
  subjectMemberId?: string;
  payload: Record<string, unknown>;
  visibility: string;
  confidence: number;
  occurredAt: number;
  recordedAt: number;
  schemaVersion: number;
}

// ── Database ───────────────────────────────────────────────────────
class HerNestDB extends Dexie {
  docs!: Table<LocalDoc>;
  // Offline write queue — LIVE as of 2026-07-10: saveData failures enqueue
  // here (core/firebase.ts) and core/offlineSync.ts drains on 'online',
  // app start, and a 2-minute interval.
  syncQueue!: Table<SyncQueueItem>;
  briefings!: Table<CachedBriefing>;
  chatSessions!: Table<ChatSession>;
  events!: Table<LoggedEvent>;

  constructor() {
    super("HerNestV2");
    this.version(1).stores({
      docs: "id, collection, syncStatus, lastModified, userId",
      syncQueue: "++id, status, timestamp, nextRetry",
      briefings: "date, generatedAt, stale",
      chatSessions: "sessionId, lastMessageAt, userId",
    });
    // migration Step 2: durable household event log (existing tables carry over)
    this.version(2).stores({
      events: "id, householdId, type, occurredAt",
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────
  async upsertDoc(doc: LocalDoc): Promise<void> {
    await this.docs.put(doc);
  }

  async getDoc(id: string): Promise<LocalDoc | undefined> {
    return this.docs.get(id);
  }

  async getPendingSync(): Promise<SyncQueueItem[]> {
    const now = Date.now();
    return this.syncQueue
      .where("status")
      .equals("pending")
      .filter((item) => !item.nextRetry || item.nextRetry <= now)
      .limit(50)
      .toArray();
  }

  async queueSync(item: Omit<SyncQueueItem, "id" | "status" | "retryCount">): Promise<void> {
    await this.syncQueue.add({
      ...item,
      status: "pending",
      retryCount: 0,
    });
  }

  getWindowKey(): string {
    const hour = new Date().getHours();
    const today = new Date().toISOString().split("T")[0];
    if (hour >= 6 && hour < 12) return `morning_${today}`;
    if (hour >= 12 && hour < 17) return `afternoon_${today}`;
    return `evening_${today}`;
  }

  async getTodayBriefing(): Promise<CachedBriefing | undefined> {
    return this.briefings.get(this.getWindowKey());
  }

  async cacheBriefing(data: Record<string, unknown>): Promise<void> {
    await this.briefings.put({
      date: this.getWindowKey(),
      data,
      generatedAt: Date.now(),
      stale: false,
    });
  }

  // Sign-out / account-switch hygiene: local caches are NOT uid-scoped
  // (briefings key on date+window only), so they MUST be wiped when the
  // user changes — otherwise User B can see User A's cached briefing.
  async clearAllLocal(): Promise<void> {
    await Promise.all([
      this.docs.clear(),
      this.syncQueue.clear(),
      this.briefings.clear(),
      this.chatSessions.clear(),
      this.events.clear(),
    ]);
  }

  async clearBriefing(): Promise<void> {
    try {
      await this.briefings.clear();
    } catch (e) {
      console.warn("[DB] clearBriefing failed:", e);
    }
  }
}

export const db = new HerNestDB();
