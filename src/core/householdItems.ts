// ─── Household items (app layer) ──────────────────────────────────
// The one way app code reads and writes tasks, chores and bills. Each item
// is its own doc (see householdItemsCore.ts for why and where), so two
// people changing different items, or different fields of one item, can no
// longer overwrite each other.
//
//   listItems / subscribeItems   read (subscribe = live, both phones)
//   createItem / updateItem      write one item / some fields of one item
//   mutateItem                   read-decide-write in a transaction
//   removeItem                   delete one item
//
// Before the first read or write of a kind, the old list doc is copied into
// per-item docs once (ensureMigrated). The old doc is kept as a backup.
import { collection, onSnapshot, doc, setDoc } from "firebase/firestore";
import { db, ownerFor } from "./firebase";
import { withTimeout, TIMED_OUT } from "./timeout";
import {
  type ItemKind, type Item, LEGACY, migrateKind, readItems, readLegacyItems, createItemDoc,
  updateItemDoc, deleteItemDoc, mutateItemDoc, changedFields, toFirestorePatch, clean,
} from "./householdItemsCore";

export type { ItemKind, Item } from "./householdItemsCore";
export { changedFields } from "./householdItemsCore";

const owner = (uid: string, kind: ItemKind) => ownerFor(uid, kind);

// ── Migration (once per household per kind) ───────────────────────
// true = items live in per-item docs; false = migration could not run
// (usually offline on the very first open) and reads fall back to the old doc.
const _migrations = new Map<string, Promise<boolean>>();

export function ensureMigrated(uid: string, kind: ItemKind): Promise<boolean> {
  const o = owner(uid, kind);
  const key = `${o}::${kind}`;
  const hit = _migrations.get(key);
  if (hit) return hit;
  const p = migrateKind(db, o, kind, uid)
    .then(r => {
      if (r.migrated) console.log(`[Items] moved ${r.count} ${kind} to per-item records`);
      return true;
    })
    .catch(e => {
      console.warn(`[Items] ${kind} migration not run yet (will retry):`, e?.code || e);
      _migrations.delete(key);
      return false;
    });
  _migrations.set(key, p);
  return p;
}

// Run the migration for every kind on app open. Never throws.
export async function migrateAllItems(uid: string): Promise<void> {
  await Promise.all((["tasks", "chores", "bills"] as ItemKind[]).map(k => ensureMigrated(uid, k)));
}

// ── Reads ─────────────────────────────────────────────────────────
// Short cache so the many screens that read tasks/bills on open share one
// fetch. Local writes and live snapshots refresh it.
const CACHE_TTL = 30_000;
const _cache = new Map<string, { items: Item[]; expires: number }>();
const cacheKey = (uid: string, kind: ItemKind) => `${owner(uid, kind)}::${kind}`;
function dropCache(uid: string, kind: ItemKind) { _cache.delete(cacheKey(uid, kind)); }
export function clearItemsCache() { _cache.clear(); }

export async function listItems<T extends Item = Item>(uid: string, kind: ItemKind): Promise<T[]> {
  const key = cacheKey(uid, kind);
  const hit = _cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.items as unknown as T[];
  let items: Item[];
  try {
    // Never wait forever: a read that hasn't answered in 10s gives an empty
    // list this time (screens show their empty or retry state).
    const r = await withTimeout((async () => {
      const migrated = await ensureMigrated(uid, kind);
      let list = await readItems(db, owner(uid, kind), kind);
      if (!migrated && !list.length) list = await readLegacyItems(db, owner(uid, kind), kind);
      return list;
    })(), 10_000);
    if (r === TIMED_OUT) { console.warn(`[Items] list ${kind} timed out`); return []; }
    items = r;
  } catch (e) {
    console.error(`[Items] list ${kind} failed`, e);
    return [];
  }
  _cache.set(key, { items, expires: Date.now() + CACHE_TTL });
  return items as unknown as T[];
}

// Old-shape read for code that still expects { tasks: [...] } / { bills: [...] }
// from loadData. Chores are not served this way (Plan reads them directly).
export async function loadItemsAsDoc(uid: string, kind: "tasks" | "bills"): Promise<Record<string, unknown>> {
  return { [LEGACY[kind].field]: await listItems(uid, kind) };
}

// Live list. Fires once with the current items, then on every change from
// any device (including this one, instantly, before the server confirms).
export function subscribeItems<T extends Item = Item>(uid: string, kind: ItemKind, cb: (items: T[]) => void): () => void {
  let unsub: (() => void) | null = null;
  let stopped = false;
  ensureMigrated(uid, kind).then(async migrated => {
    if (stopped) return;
    const o = owner(uid, kind);
    const legacy = migrated ? [] : await readLegacyItems(db, o, kind).catch(() => []);
    if (stopped) return;
    unsub = onSnapshot(collection(db, "users", o, kind), snap => {
      let items = snap.docs.map(s => ({ ...s.data(), id: s.id }) as Item);
      if (!migrated && !items.length) items = legacy;
      _cache.set(cacheKey(uid, kind), { items, expires: Date.now() + CACHE_TTL });
      cb(items as unknown as T[]);
    }, e => console.error(`[Items] ${kind} live updates stopped`, e));
  });
  return () => { stopped = true; unsub?.(); };
}

// ── Writes ────────────────────────────────────────────────────────
// Writes go to the device's local copy right away (the screen updates at
// once, even offline) and reach the server when it can.
export async function createItem<T extends Item>(uid: string, kind: ItemKind, item: T): Promise<void> {
  await ensureMigrated(uid, kind);
  dropCache(uid, kind);
  await createItemDoc(db, owner(uid, kind), kind, item);
}

// Change only these fields (undefined removes a field).
export async function updateItem(uid: string, kind: ItemKind, id: string, patch: Record<string, unknown>): Promise<void> {
  await ensureMigrated(uid, kind);
  dropCache(uid, kind);
  await updateItemDoc(db, owner(uid, kind), kind, id, patch);
}

export async function removeItem(uid: string, kind: ItemKind, id: string): Promise<void> {
  await ensureMigrated(uid, kind);
  dropCache(uid, kind);
  await deleteItemDoc(db, owner(uid, kind), kind, id);
}

// Transaction: decide the change from the item as it is on the server right
// now. `fn` returns the new item or null for "no change". Transactions need
// a connection; offline we apply `fn` to `fallback` (what the screen shows)
// and write just the changed fields, which Firestore sends when back online.
export async function mutateItem<T extends Item>(
  uid: string, kind: ItemKind, id: string, fn: (cur: T) => T | null, fallback?: T,
): Promise<T | null> {
  await ensureMigrated(uid, kind);
  dropCache(uid, kind);
  const o = owner(uid, kind);
  try {
    const r = await mutateItemDoc<T>(db, o, kind, id, fn);
    return r ? r.after : null;
  } catch (e) {
    const code = (e as { code?: string })?.code || "";
    if (!fallback || !["unavailable", "deadline-exceeded", "failed-precondition"].includes(code)) throw e;
    const next = fn(fallback);
    if (!next) return null;
    // merge-set (not update) so the write also lands if the copy from the old
    // list has not run yet; the full item is sent so it is never half there.
    const patch = toFirestorePatch(changedFields(fallback as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>));
    void setDoc(doc(db, "users", o, kind, id), { ...clean(next), ...patch }, { merge: true })
      .catch(err => console.error(`[Items] offline ${kind} write failed`, err));
    return next;
  }
}
