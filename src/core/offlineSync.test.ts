import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for the Dexie queue (jsdom has no IndexedDB)
interface Row { id: number; operation: string; collection: string; documentId: string; data?: Record<string, unknown>; timestamp: number; status: string; retryCount: number; nextRetry?: number; error?: string; }
let rows: Row[] = [];
let nextId = 1;

vi.mock("./db", () => ({
  db: {
    getPendingSync: async () => rows.filter(r => r.status === "pending" && (!r.nextRetry || r.nextRetry <= Date.now())),
    queueSync: async (item: Omit<Row, "id" | "status" | "retryCount">) => { rows.push({ ...item, id: nextId++, status: "pending", retryCount: 0 }); },
    syncQueue: {
      delete: async (id: number) => { rows = rows.filter(r => r.id !== id); },
      update: async (id: number, patch: Partial<Row>) => { rows = rows.map(r => r.id === id ? { ...r, ...patch } : r); },
    },
  },
}));

import { enqueueFailedWrite, drainSyncQueue } from "./offlineSync";

beforeEach(() => { rows = []; nextId = 1; });

describe("offline write queue", () => {
  it("queues a failed write and replays it in order", async () => {
    await enqueueFailedWrite("u1", "tasks", { tasks: [1] });
    await enqueueFailedWrite("u1", "tasks", { tasks: [1, 2] });
    const written: Array<[string, string, unknown]> = [];
    const r = await drainSyncQueue(async (uid, col, data) => { written.push([uid, col, data]); });
    expect(r.replayed).toBe(2);
    expect(written[0][2]).toEqual({ tasks: [1] });      // oldest first
    expect(written[1][2]).toEqual({ tasks: [1, 2] });   // latest wins via merge order
    expect(rows).toHaveLength(0);                        // cleared after success
  });

  it("backs off on failure and marks failed after max retries", async () => {
    await enqueueFailedWrite("u1", "budget_v2", { categories: [] });
    const failingWriter = async () => { throw new Error("still offline"); };
    // 5 attempts → failed
    for (let i = 0; i < 5; i++) {
      rows = rows.map(r => ({ ...r, nextRetry: 0 })); // make eligible
      await drainSyncQueue(failingWriter);
    }
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].retryCount).toBe(5);
  });

  it("partial failure leaves failed row queued but replays the rest", async () => {
    await enqueueFailedWrite("u1", "tasks", { a: 1 });
    await enqueueFailedWrite("u1", "circle", { b: 2 });
    const r = await drainSyncQueue(async (_u, col) => { if (col === "tasks") throw new Error("boom"); });
    expect(r.replayed).toBe(1);
    expect(r.failed).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].collection).toBe("tasks");
    expect(rows[0].nextRetry).toBeGreaterThan(Date.now() - 1000);
  });
});
