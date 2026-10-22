// ─── Household items: one Firestore doc per item (core) ────────────
// Tasks, chores and bills used to live as one array per household doc
// (users/{owner}/data/tasks → {tasks: [...]}) and every change rewrote the
// whole array. Two people editing at once meant the last save silently
// erased the other's change. Now each item is its own doc:
//
//   users/{owner}/tasks/{id}   users/{owner}/chores/{id}   users/{owner}/bills/{id}
//
// {owner} is the household id (the owner's uid; see identity.ts), so this
// sits next to the rest of the household's data, is covered by account
// deletion's recursive delete of users/{uid}, and the server's existing
// owner lookup works unchanged.
//
// This file takes a Firestore instance and never imports firebase.ts, so the
// rules emulator tests can run the real migration and transactions.
// App code uses householdItems.ts.
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField,
  runTransaction, type Firestore,
} from "firebase/firestore";

export type ItemKind = "tasks" | "chores" | "bills";
export const ITEM_KINDS: ItemKind[] = ["tasks", "chores", "bills"];

// Where each kind used to live. The old doc is never changed or deleted by
// the migration: it stays as a backup.
export const LEGACY: Record<ItemKind, { doc: string; field: string }> = {
  tasks:  { doc: "tasks",  field: "tasks" },
  chores: { doc: "family", field: "tasks" },
  bills:  { doc: "bills",  field: "bills" },
};

// users/{owner}/data/items_migration → { tasks: {at, by, count}, ... }
export const MIGRATION_DOC = "items_migration";

export type Item = { id: string };
type Rec = Record<string, unknown>;

// A Firestore doc id from an old list item. Old items almost always have an
// id; anything unusable gets a stable fallback so a re-run picks the same doc.
export function legacyItemId(item: unknown, index: number): string {
  const raw = item && typeof item === "object" ? (item as { id?: unknown }).id : undefined;
  const id = raw == null ? "" : String(raw);
  if (!id || id.includes("/") || id === "." || id === ".." || id.length > 500 || /^__.*__$/.test(id)) return `legacy_${index}`;
  return id;
}

// Firestore rejects undefined values; a JSON round trip drops them.
export function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? null));
}

// The top-level fields that differ between two versions of an item.
// A field that was removed comes back as undefined.
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (k === "id") continue;
    const a = before?.[k], b = after?.[k];
    if (b === undefined) { if (a !== undefined) out[k] = undefined; continue; }
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = b;
  }
  return out;
}

// A per-field patch Firestore can apply: undefined becomes "delete this field".
export function toFirestorePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "id") continue;
    out[k] = v === undefined ? deleteField() : clean(v);
  }
  return out;
}

const itemsCol = (db: Firestore, owner: string, kind: ItemKind) => collection(db, "users", owner, kind);
const itemRef = (db: Firestore, owner: string, kind: ItemKind, id: string) => doc(db, "users", owner, kind, id);
const markerRef = (db: Firestore, owner: string) => doc(db, "users", owner, "data", MIGRATION_DOC);

export async function isMigrated(db: Firestore, owner: string, kind: ItemKind): Promise<boolean> {
  const snap = await getDoc(markerRef(db, owner));
  return !!(snap.exists() && snap.data()?.[kind]);
}

// The old list, as stored in the old doc.
export async function readLegacyItems(db: Firestore, owner: string, kind: ItemKind): Promise<Item[]> {
  const { doc: d, field } = LEGACY[kind];
  const snap = await getDoc(doc(db, "users", owner, "data", d));
  const list = snap.exists() ? (snap.data()?.[field] as unknown[]) : null;
  return (Array.isArray(list) ? list : [])
    .filter(x => x && typeof x === "object")
    .map((x, i) => ({ ...(x as Record<string, unknown>), id: legacyItemId(x, i) }));
}

// One-time copy of the old list into per-item docs. Safe to run any number
// of times, from any device, at the same moment:
//  - it runs in a transaction that checks the marker, so only one copy wins;
//  - an item doc that already exists (an edit made before the copy) keeps
//    its newer fields, and the old list only fills in what is missing;
//  - the old doc is only read, never written.
export async function migrateKind(
  db: Firestore, owner: string, kind: ItemKind, byUid: string,
): Promise<{ migrated: boolean; count: number }> {
  const { doc: d, field } = LEGACY[kind];
  return runTransaction(db, async tx => {
    const marker = await tx.get(markerRef(db, owner));
    if (marker.exists() && marker.data()?.[kind]) return { migrated: false, count: 0 };

    const legacySnap = await tx.get(doc(db, "users", owner, "data", d));
    const raw = legacySnap.exists() ? (legacySnap.data()?.[field] as unknown[]) : null;
    const list = (Array.isArray(raw) ? raw : []).filter(x => x && typeof x === "object") as Record<string, unknown>[];

    // De-duplicate ids (the first one wins, the rest get fallback ids).
    const seen = new Set<string>();
    const items = list.map((x, i) => {
      let id = legacyItemId(x, i);
      if (seen.has(id)) id = `legacy_${i}`;
      seen.add(id);
      return { ...clean(x), id };
    });

    // All transaction reads must happen before any write.
    const existing = await Promise.all(items.map(it => tx.get(itemRef(db, owner, kind, it.id))));
    items.forEach((it, i) => {
      const cur = existing[i];
      tx.set(itemRef(db, owner, kind, it.id), cur.exists() ? { ...it, ...cur.data(), id: it.id } : it);
    });
    tx.set(markerRef(db, owner), { [kind]: { at: Date.now(), by: byUid, count: items.length } }, { merge: true });
    return { migrated: true, count: items.length };
  });
}

export async function readItems<T extends Item = Item>(db: Firestore, owner: string, kind: ItemKind): Promise<T[]> {
  const snap = await getDocs(itemsCol(db, owner, kind));
  return snap.docs.map(s => ({ ...s.data(), id: s.id }) as unknown as T);
}

export async function createItemDoc(db: Firestore, owner: string, kind: ItemKind, item: Item): Promise<void> {
  await setDoc(itemRef(db, owner, kind, item.id), clean(item));
}

// Change only the given fields. Someone else's change to a different field
// of the same item is kept.
export async function updateItemDoc(db: Firestore, owner: string, kind: ItemKind, id: string, patch: Record<string, unknown>): Promise<void> {
  const p = toFirestorePatch(patch);
  if (!Object.keys(p).length) return;
  await updateDoc(itemRef(db, owner, kind, id), p);
}

export async function deleteItemDoc(db: Firestore, owner: string, kind: ItemKind, id: string): Promise<void> {
  await deleteDoc(itemRef(db, owner, kind, id));
}

// Read the item as it is right now, decide the change, and write it, all in
// one transaction: if someone else changed it in between, Firestore re-runs
// `fn` on their version. Used where two people could act on the same item
// at once (marking a bill paid, accepting a task). `fn` returns the new
// item, or null for "no change" (e.g. already paid). Returns the item as
// saved, or null if it no longer exists or nothing changed.
export async function mutateItemDoc<T extends Item = Item>(
  db: Firestore, owner: string, kind: ItemKind, id: string, fn: (cur: T) => T | null,
): Promise<{ before: T; after: T } | null> {
  return runTransaction(db, async tx => {
    const ref = itemRef(db, owner, kind, id);
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const cur = { ...snap.data(), id } as unknown as T;
    const next = fn(cur);
    if (!next) return null;
    const p = toFirestorePatch(changedFields(cur as unknown as Rec, next as unknown as Rec));
    if (Object.keys(p).length) tx.update(ref, p);
    return { before: cur, after: next };
  });
}
