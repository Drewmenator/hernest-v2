/// <reference types="vite/client" />
// ─── Firebase Config ─────────────────────────────────────────────
import { initializeApp, getApps } from "firebase/app";
import { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence, GoogleAuthProvider } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, persistentSingleTabManager, doc, setDoc, getDoc, getDocFromCache, collection, query, where, getDocs } from "firebase/firestore";
import { withTimeout, TIMED_OUT } from "./timeout";
import { isHouseholdCollection, getHouseholdId } from "./identity";
import { FLAGS } from "../config";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Auth persistence: the default getAuth() prefers IndexedDB, which can hang
// inside the native iOS WKWebView (served from capacitor://localhost) and leave
// sign-in stuck forever. On native we initialize with an explicit fallback chain
// (IndexedDB → localStorage → in-memory) so a blocked store degrades instead of
// hanging. Web keeps the default getAuth().
const isNativePlatform = !!(window as any).Capacitor?.isNativePlatform?.();
export const auth = isNativePlatform
  ? initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence] })
  : getAuth(app);

// Firestore transport: the default streaming (fetch/WebChannel) transport is
// unreliable inside the native iOS WKWebView — reads can hang forever, which
// looks like the app freezing right after sign-in. Forcing long-polling on
// native fixes that; the web build keeps auto-detection (fast path when it works).
const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
// ignoreUndefinedProperties: optional event fields (e.g. subjectMemberId) are
// often undefined; Firestore rejects undefined values with invalid-argument
// unless told to drop them. Dropping is exactly what we want here.
// localCache: keep a copy of the user's data on the device so screens still
// show it offline (writes already queue via offlineSync). If the browser's
// storage is unavailable Firestore falls back to memory on its own. Sign-out
// clears this copy (signOut.ts).
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({
    tabManager: isNative ? persistentSingleTabManager({}) : persistentMultipleTabManager(),
  }),
  ...(isNative
    ? { experimentalForceLongPolling: true }
    : { experimentalAutoDetectLongPolling: true }),
});

export const googleProvider = new GoogleAuthProvider();

// ── Household scoping (migration Step 1) ──────────────────────────
// Household-scoped collections resolve to the shared household namespace
// (the owner's uid); everything else stays personal to the signed-in user.
// For solo users getHouseholdId() === uid, so this is a no-op for them.
export function ownerFor(uid: string, collection: string): string {
  if (!FLAGS.HOUSEHOLD_IDENTITY) return uid;
  if (!isHouseholdCollection(collection)) return uid;
  return getHouseholdId() || uid;
}

// ── Read cache (perf) ─────────────────────────────────────────────
// Many screens/paths re-read the same docs in a short window (the home screen
// fans the same collections across several cards; the AI orchestrator rebuilds
// context per message). Without a cache each is a fresh getDoc. A short TTL +
// in-flight coalescing collapses that to one network read; writes invalidate.
type LoadResult = Record<string, unknown> | null;
const DOC_CACHE_TTL = 60_000; // 60s — writes invalidate instantly, so staleness only affects cross-device edits
const _docCache = new Map<string, { data: LoadResult; expires: number }>();
const _inflight = new Map<string, Promise<LoadResult>>();
const cacheKey = (uid: string, col: string) => `${ownerFor(uid, col)}::${col}`;

export function invalidateDataCache(uid: string, col: string): void {
  _docCache.delete(cacheKey(uid, col));
}

// Pull to refresh / app resume: forget every cached read so the next one
// goes to the server (a partner's edits from the last minute show up).
export function clearDataCaches(): void {
  _docCache.clear();
  import("./householdItems").then(m => m.clearItemsCache()).catch(() => {});
}

// A read that hasn't answered after this long falls back to the copy saved
// on the phone (or nothing), so no screen waits forever.
const READ_TIMEOUT_MS = 10_000;

// ── Data Helpers ──────────────────────────────────────────────────
// Raw write used by the offline-sync replay — throws on failure and never
// re-queues (that would loop). App code should use saveData below.
export async function saveDataDirect(
  uid: string,
  collection: string,
  data: Record<string, unknown>
): Promise<void> {
  invalidateDataCache(uid, collection);
  try {
    await setDoc(doc(db, "users", ownerFor(uid, collection), "data", collection), data, { merge: true });
  } finally {
    invalidateDataCache(uid, collection);
  }
}

export async function saveData(
  uid: string,
  collection: string,
  data: Record<string, unknown>
): Promise<void> {
  // Invalidate before AND after the write so a concurrent read can't re-cache
  // stale data mid-flight. setDoc uses merge, so we drop the entry rather than
  // cache the partial — the next read re-fetches the full merged doc.
  try {
    await saveDataDirect(uid, collection, data);
  } catch (e) {
    // Offline or transient failure: queue for replay instead of losing the write
    console.error(`[Firebase] saveData failed: ${collection} — queueing for retry`, e);
    const { enqueueFailedWrite } = await import("./offlineSync");
    await enqueueFailedWrite(uid, collection, data);
  }
}

export async function loadData(
  uid: string,
  col: string
): Promise<LoadResult> {
  // Tasks and bills are one doc per item now (householdItems.ts). Callers that
  // still read the old { tasks: [...] } / { bills: [...] } shape get it here.
  if (col === "tasks" || col === "bills") {
    try { return await (await import("./householdItems")).loadItemsAsDoc(uid, col); }
    catch (e) { console.error(`[Firebase] loadData failed: ${col}`, e); return null; }
  }
  const key = cacheKey(uid, col);
  const hit = _docCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  const pending = _inflight.get(key);
  if (pending) return pending;          // coalesce concurrent identical reads

  const p = (async (): Promise<LoadResult> => {
    try {
      const ref = doc(db, "users", ownerFor(uid, col), "data", col);
      const snap = await withTimeout(getDoc(ref), READ_TIMEOUT_MS);
      if (snap === TIMED_OUT) {
        console.warn(`[Firebase] loadData slow, using the saved copy: ${col}`);
        const cached = await withTimeout(getDocFromCache(ref), 2000);
        return cached !== TIMED_OUT && cached.exists() ? (cached.data() as Record<string, unknown>) : null;
      }
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      _docCache.set(key, { data, expires: Date.now() + DOC_CACHE_TTL });
      return data;
    } catch (e) {
      console.error(`[Firebase] loadData failed: ${col}`, e);
      return null;
    } finally {
      _inflight.delete(key);
    }
  })();
  _inflight.set(key, p);
  return p;
}
