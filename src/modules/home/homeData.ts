import { loadData } from "../../core/firebase";

// ── Shared home-data fetch ─────────────────────────────────────────
// Three cards used to fire their own loadData bursts for the same docs.
// One promise per uid per mount-window; each card derives its own state.
let _homeDocs: { uid: string; at: number; p: Promise<Record<string, any>> } | null = null;
export function loadHomeDocs(uid: string): Promise<Record<string, any>> {
  if (_homeDocs && _homeDocs.uid === uid && Date.now() - _homeDocs.at < 30_000) return _homeDocs.p;
  const p = (async () => {
    const [tasks, budgetV2, budgetV1, calendar, school, trips, circle, thrive] = await Promise.all([
      loadData(uid, "tasks"),
      loadData(uid, "budget_v2"),
      loadData(uid, "budget"),
      loadData(uid, "calendar"),
      loadData(uid, "school"),
      loadData(uid, "trips"),
      loadData(uid, "circle"),
      loadData(uid, "thrive"),
    ]);
    return { tasks, budget: budgetV2 || budgetV1, calendar, school, trips, circle, thrive };
  })();
  _homeDocs = { uid, at: Date.now(), p };
  return p;
}

