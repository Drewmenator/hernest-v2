// ─── Task ownership actions (app) ─────────────────────────────────
// Each answer runs as a transaction on the task's own record, so the asker
// and the assignee acting at the same moment can't undo each other.
// Rules live in taskOwnership.ts.
import { useStore } from "./store";
import { bus } from "./events";
import { createItem, mutateItem } from "./householdItems";
import {
  proposeTask, acceptTask, declineTask, completeTask, reopenTask, takeBackTask, askAgain,
  type OwnedTask, type Who,
} from "./taskOwnership";

const firstName = (s?: string | null) => (s || "").trim().split(/\s+/)[0] || "";

// The signed-in person, named the way the other adults will see them.
export function currentWho(): Who | null {
  const s = useStore.getState();
  const uid = s.user?.uid;
  if (!uid) return null;
  const member = s.householdMembers.find(m => m.uid === uid);
  const name = firstName((s.profile as { name?: string } | null)?.name) || firstName(member?.displayName) || firstName(s.user?.displayName) || "Someone";
  return { uid, name };
}

// The other adults in this household who have HerNest (they can say yes or no).
export function otherAdults(): Who[] {
  const s = useStore.getState();
  const me = s.user?.uid;
  return s.householdMembers
    .filter(m => m.uid && m.uid !== me)
    .map(m => ({ uid: m.uid, name: firstName(m.displayName) || "Partner" }));
}

// Find another adult by name (first name or full name, any case).
export function findAdult(name: string): Who | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const s = useStore.getState();
  const me = s.user?.uid;
  const m = s.householdMembers.find(x => x.uid !== me && x.displayName &&
    (x.displayName.trim().toLowerCase() === want || firstName(x.displayName).toLowerCase() === firstName(want).toLowerCase()));
  return m ? { uid: m.uid, name: firstName(m.displayName) } : null;
}

// Give a new task to another adult. It starts as "asked", never accepted.
export async function proposeNewTask<T extends { id: string; title?: string }>(task: T, to: Who): Promise<(T & OwnedTask) | null> {
  const me = currentWho();
  if (!me) return null;
  const t = proposeTask(task, me, to, Date.now());
  await createItem(me.uid, "tasks", t);
  await bus.publish("plan.task.proposed", { id: t.id, title: t.title, assigneeName: to.name }, { userId: me.uid, source: "plan" }).catch(() => {});
  return t;
}

async function change(task: OwnedTask, fn: (cur: OwnedTask, me: Who, now: number) => OwnedTask | null): Promise<OwnedTask | null> {
  const me = currentWho();
  if (!me) return null;
  const now = Date.now();
  return mutateItem<OwnedTask>(me.uid, "tasks", task.id, cur => fn(cur, me, now), task);
}

export async function answerTask(task: OwnedTask, yes: boolean): Promise<OwnedTask | null> {
  const r = await change(task, (cur, me, now) => (yes ? acceptTask(cur, me.uid, now) : declineTask(cur, me.uid, now)));
  const me = currentWho();
  if (r && me) await bus.publish(yes ? "plan.task.accepted" : "plan.task.declined", { id: r.id, title: r.title }, { userId: me.uid, source: "plan" }).catch(() => {});
  return r;
}

export async function setTaskDone(task: OwnedTask, done: boolean): Promise<OwnedTask | null> {
  const r = await change(task, (cur, me, now) => (done ? completeTask(cur, me, now) : reopenTask(cur, me.uid, now)));
  const me = currentWho();
  if (r && done && me) await bus.publish("plan.task.completed", r, { userId: me.uid, source: "plan" }).catch(() => {});
  return r;
}

export const takeBack = (task: OwnedTask) => change(task, (cur, me) => takeBackTask(cur, me.uid));

export async function askAgainTask(task: OwnedTask): Promise<OwnedTask | null> {
  const r = await change(task, (cur, me, now) => askAgain(cur, me.uid, now));
  const me = currentWho();
  if (r && me) await bus.publish("plan.task.proposed", { id: r.id, title: r.title, assigneeName: r.assigneeName }, { userId: me.uid, source: "plan" }).catch(() => {});
  return r;
}
