// ─── Design preview: stand-in for core/householdItems ──────────────
import { sampleBills, sampleTasks } from "./sampleData";
export { changedFields } from "../../core/householdItemsCore";
type Kind = string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const lists: Record<Kind, Any[]> = { bills: [...sampleBills], tasks: [...sampleTasks], chores: [] };
const subs: Record<Kind, Set<(items: Any[]) => void>> = {};
const emit = (k: Kind) => subs[k]?.forEach(cb => cb([...(lists[k] || [])]));

export const ensureMigrated = async () => true;
export const migrateAllItems = async () => {};
export const listItems = async (_u: string, k: Kind) => [...(lists[k] || [])];
export const loadItemsAsDoc = async (_u: string, k: Kind) => ({ [k]: [...(lists[k] || [])] });
export function subscribeItems(_u: string, k: Kind, cb: (items: Any[]) => void) {
  (subs[k] ||= new Set()).add(cb);
  const t = setTimeout(() => cb([...(lists[k] || [])]), 400);
  return () => { clearTimeout(t); subs[k].delete(cb); };
}
export async function createItem(_u: string, k: Kind, item: Any) { (lists[k] ||= []).push(item); emit(k); }
export async function updateItem(_u: string, k: Kind, id: string, patch: Any) { lists[k] = lists[k].map(x => x.id === id ? { ...x, ...patch } : x); emit(k); }
export async function removeItem(_u: string, k: Kind, id: string) { lists[k] = lists[k].filter(x => x.id !== id); emit(k); }
export async function mutateItem(_u: string, k: Kind, id: string, fn: (cur: Any) => Any) {
  const cur = lists[k].find(x => x.id === id); const next = cur ? fn(cur) : null;
  if (next) { lists[k] = lists[k].map(x => x.id === id ? next : x); emit(k); }
  return next;
}
