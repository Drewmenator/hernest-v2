// Test-only helper (not imported by any endpoint).
// Minimal in-memory Firestore: doc get/set (merge, nested maps, increments)
// and a transaction that runs reads and writes against the same store.
export function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  const apply = (target, patch) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v && v.constructor?.name === "NumericIncrementTransform") target[k] = (target[k] || 0) + v.operand;
      else if (v && typeof v === "object" && !Array.isArray(v)) target[k] = apply({ ...(target[k] || {}) }, v);
      else target[k] = v;
    }
    return target;
  };
  const doc = (path) => ({
    path,
    async get() { const d = store.get(path); return { exists: !!d, data: () => d }; },
    async set(data, opts) { store.set(path, apply(opts?.merge ? { ...(store.get(path) || {}) } : {}, data)); },
  });
  return {
    store,
    doc,
    async runTransaction(fn) {
      return fn({ get: (ref) => ref.get(), set: (ref, data, opts) => { ref.set(data, opts); } });
    },
  };
}
