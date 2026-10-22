// ─── Task ownership (server mirror) ───────────────────────────────
// Mirror of taskIsFor / awaitsAnswerFrom in src/core/taskOwnership.ts (keep
// in sync; src/core/tasks.mirror.test.ts checks both give the same answers).
// A task given to another adult only reminds them once they accept it.

const isHandoff = t => !!t?.assigneeUid && !!t?.state;
const isDone = t => t?.status === "completed" || t?.status === "done" || t?.state === "done";

export function taskIsFor(t, uid) {
  if (!isHandoff(t)) return true;
  if (t.state === "accepted" || t.state === "done") return t.assigneeUid === uid;
  if (t.state === "declined") return t.createdBy === uid;
  return false;
}

export function awaitsAnswerFrom(t, uid) {
  return isHandoff(t) && t.state === "proposed" && t.assigneeUid === uid && !isDone(t);
}
