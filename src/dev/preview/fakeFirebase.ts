// ─── Design preview: stand-in for core/firebase ────────────────────
// Reads come from the sample household; writes stay in memory. Swapped in
// only by vite.preview.config.ts, never in the app build.
import { sampleDocs, sampleBills, sampleTasks, PREVIEW_UID } from "./sampleData";

type LoadResult = Record<string, unknown> | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const auth: any = { currentUser: { uid: PREVIEW_UID, getIdToken: async () => "" } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = {};
export const googleProvider = {};
export const ownerFor = (uid: string) => uid;
export const invalidateDataCache = () => {};

const store: Record<string, Record<string, unknown>> = { ...sampleDocs };
export async function saveDataDirect(_uid: string, col: string, data: Record<string, unknown>) {
  store[col] = { ...(store[col] || {}), ...data };
}
export const saveData = saveDataDirect;
export async function loadData(_uid: string, col: string): Promise<LoadResult> {
  await new Promise(r => setTimeout(r, 350)); // show the loading states briefly
  if (col === "bills") return { bills: sampleBills };
  if (col === "tasks") return { tasks: sampleTasks };
  return store[col] ?? null;
}
