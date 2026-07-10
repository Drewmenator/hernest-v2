// ─── Offline write sync ────────────────────────────────────────────
// Until 2026-07-10 the Dexie sync queue was dormant: a failed Firestore
// write was console.error'd and the data was simply LOST. Now:
//   saveData failure → enqueueFailedWrite() → drained when we're back
//   online (window 'online' event), on app start, and every 2 minutes.
// Writes replay in timestamp order with setDoc merge semantics, so the
// final document state matches what sequential online writes would have
// produced. Retries back off and give up (status "failed") after 5 tries.
import { db as localDb, type SyncQueueItem } from "./db";

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 30_000; // 30s, 1m, 2m, 4m, 8m

export async function enqueueFailedWrite(uid: string, collection: string, data: Record<string, unknown>): Promise<void> {
  try {
    await localDb.queueSync({
      operation: "update",
      collection,
      documentId: uid, // owner resolution happens at replay time via saveData
      data,
      timestamp: Date.now(),
    });
    console.warn(`[OfflineSync] queued write for ${collection} — will retry when online`);
  } catch (e) {
    console.error("[OfflineSync] could not queue write (data at risk):", collection, e);
  }
}

// Injectable writer so the replay logic is unit-testable without IndexedDB.
type Writer = (uid: string, collection: string, data: Record<string, unknown>) => Promise<void>;

export async function drainSyncQueue(writer?: Writer): Promise<{ replayed: number; failed: number }> {
  const write: Writer = writer || (await import("./firebase")).saveDataDirect;
  let replayed = 0, failed = 0;
  try {
    const pending = await localDb.getPendingSync();
    // Replay oldest-first so merge semantics converge to the latest state
    pending.sort((a, b) => a.timestamp - b.timestamp);
    for (const item of pending) {
      try {
        if (item.data) await write(item.documentId, item.collection, item.data);
        await localDb.syncQueue.delete(item.id!);
        replayed++;
      } catch (e) {
        failed++;
        const retryCount = (item.retryCount || 0) + 1;
        await localDb.syncQueue.update(item.id!, retryCount >= MAX_RETRIES
          ? { status: "failed" as const, retryCount, error: String(e) }
          : { retryCount, nextRetry: Date.now() + BACKOFF_BASE_MS * 2 ** (retryCount - 1), error: String(e) });
      }
    }
    if (replayed) console.log(`[OfflineSync] replayed ${replayed} queued write${replayed === 1 ? "" : "s"}`);
  } catch (e) {
    console.warn("[OfflineSync] drain failed:", e);
  }
  return { replayed, failed };
}

let wired = false;
export function wireOfflineSync(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("online", () => { drainSyncQueue().catch(() => {}); });
  setInterval(() => { if (navigator.onLine) drainSyncQueue().catch(() => {}); }, 120_000);
  // App start: replay anything left over from the last session
  drainSyncQueue().catch(() => {});
}
