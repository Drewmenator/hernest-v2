// ─── Household items (server read) ─────────────────────────────────
// Tasks, chores and bills are one doc per item under users/{owner}/{kind}
// (see src/core/householdItemsCore.ts). Until a household's app has copied
// its old list over (data/items_migration says which kinds are done), read
// the old list doc instead.
const LEGACY = {
  tasks:  { doc: "tasks",  field: "tasks" },
  chores: { doc: "family", field: "tasks" },
  bills:  { doc: "bills",  field: "bills" },
};

export async function readHouseholdItems(db, owner, kind) {
  const legacy = LEGACY[kind];
  if (!legacy) throw new Error(`unknown item kind: ${kind}`);
  const marker = (await db.doc(`users/${owner}/data/items_migration`).get()).data() || {};
  if (marker[kind]) {
    const snap = await db.collection(`users/${owner}/${kind}`).get();
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
  }
  const old = (await db.doc(`users/${owner}/data/${legacy.doc}`).get()).data() || {};
  return Array.isArray(old[legacy.field]) ? old[legacy.field] : [];
}
