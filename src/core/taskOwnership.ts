// ─── Task ownership: ask, accept or decline, done ─────────────────
// A task one adult gives another is not "handled" until the other person
// says yes. Before this, assigning a task just showed it as somebody's job,
// whether or not they knew. Now:
//
//   proposed  → the assignee sees it with Accept / Decline
//   accepted  → it is theirs: reminders and the morning push go to them
//   declined  → it goes back to whoever asked (they can do it or ask again)
//   done      → both see "Done by Sam"
//
// Tasks for yourself or for the kids stay simple tasks (no state). Pure
// functions only; the server mirror is api/_lib/tasks.js (keep in sync,
// tasks.mirror.test.ts checks them).

export type TaskState = "proposed" | "accepted" | "declined" | "done";

export interface OwnedTask {
  id: string;
  title?: string;
  status?: string;            // "pending" | "completed" (kept in sync for older readers)
  dueDate?: string;
  createdBy?: string;         // uid of who added it
  createdByName?: string;
  assigneeUid?: string;       // another adult in the household (has an account)
  assigneeName?: string;
  state?: TaskState;          // only on tasks given to another adult
  proposedAt?: number;
  acceptedAt?: number;
  declinedAt?: number;
  completedAt?: number;
  completedBy?: string;
  completedByName?: string;
}

export interface Who { uid: string; name: string }

// After this long with no answer, the asker sees "Not accepted yet".
export const NO_ANSWER_MS = 2 * 86400000;

// A task handed to another adult (as opposed to a plain task).
export function isHandoff(t: Pick<OwnedTask, "assigneeUid" | "state">): boolean {
  return !!t.assigneeUid && !!t.state;
}

export const isTaskDone = (t: Pick<OwnedTask, "status" | "state">) => t.status === "completed" || t.state === "done";

// Ask another adult to take a task. Never creates an accepted task: only the
// assignee can accept (this is also all Cleo can do).
export function proposeTask<T extends { id: string }>(t: T, from: Who, to: Who, now: number): T & OwnedTask {
  return {
    ...t,
    status: "pending",
    createdBy: from.uid, createdByName: from.name,
    assigneeUid: to.uid, assigneeName: to.name,
    state: "proposed", proposedAt: now,
  };
}

// The assignee says yes (also after saying no earlier). null = not allowed / no change.
export function acceptTask<T extends OwnedTask>(t: T, uid: string, now: number): T | null {
  if (!isHandoff(t) || t.assigneeUid !== uid || isTaskDone(t)) return null;
  if (t.state !== "proposed" && t.state !== "declined") return null;
  return { ...t, state: "accepted", acceptedAt: now, declinedAt: undefined };
}

// The assignee says no (before or after accepting). It goes back to the asker.
export function declineTask<T extends OwnedTask>(t: T, uid: string, now: number): T | null {
  if (!isHandoff(t) || t.assigneeUid !== uid || isTaskDone(t)) return null;
  if (t.state !== "proposed" && t.state !== "accepted") return null;
  return { ...t, state: "declined", declinedAt: now, acceptedAt: undefined };
}

export function completeTask<T extends OwnedTask>(t: T, by: Who, now: number): T | null {
  if (isTaskDone(t)) return null;
  return {
    ...t,
    status: "completed", completedAt: now, completedBy: by.uid, completedByName: by.name,
    ...(isHandoff(t) ? { state: "done" as const } : {}),
  };
}

// Un-tick. A hand-off goes back to "accepted" only when the assignee un-ticks
// it; if anyone else does, the assignee is asked again (nobody says yes for them).
export function reopenTask<T extends OwnedTask>(t: T, uid: string, now: number): T | null {
  if (!isTaskDone(t)) return null;
  const reopened = { ...t, status: "pending", completedAt: undefined, completedBy: undefined, completedByName: undefined };
  if (!isHandoff(t)) return reopened;
  return t.assigneeUid === uid && t.acceptedAt
    ? { ...reopened, state: "accepted" }
    : { ...reopened, state: "proposed", proposedAt: now, acceptedAt: undefined };
}

// The asker takes it back as their own plain task (after a no, or no answer).
export function takeBackTask<T extends OwnedTask>(t: T, uid: string): T | null {
  if (!isHandoff(t) || t.createdBy !== uid || isTaskDone(t)) return null;
  return {
    ...t,
    assigneeUid: undefined, assigneeName: undefined, state: undefined,
    proposedAt: undefined, acceptedAt: undefined, declinedAt: undefined,
  };
}

// The asker asks again (after a no, or no answer).
export function askAgain<T extends OwnedTask>(t: T, uid: string, now: number): T | null {
  if (!isHandoff(t) || t.createdBy !== uid || isTaskDone(t)) return null;
  if (t.state !== "declined" && t.state !== "proposed") return null;
  return { ...t, state: "proposed", proposedAt: now, declinedAt: undefined };
}

// Who a task reminds, and whose morning push counts it.
//  - plain task: everyone in the household (as before)
//  - accepted: only the assignee
//  - proposed: nobody yet (the assignee gets a "please answer" nudge instead)
//  - declined: the asker, since it is theirs again
export function taskIsFor(t: OwnedTask, uid: string): boolean {
  if (!isHandoff(t)) return true;
  if (t.state === "accepted" || t.state === "done") return t.assigneeUid === uid;
  if (t.state === "declined") return t.createdBy === uid;
  return false;
}

// A task waiting for this person's yes or no.
export function awaitsAnswerFrom(t: OwnedTask, uid: string): boolean {
  return isHandoff(t) && t.state === "proposed" && t.assigneeUid === uid && !isTaskDone(t);
}

export interface OwnershipView {
  label: string;
  tone: "ask" | "waiting" | "warn" | "ok" | "done";
  needsMyAnswer: boolean;   // show Accept / Decline
  canFollowUp: boolean;     // asker: show "I'll do it" / "Ask again"
}

// The one line shown on a task for this viewer. null = plain task, no line.
// Never says a task is handled before the assignee has said yes.
export function ownershipView(t: OwnedTask, viewerUid: string, now: number): OwnershipView | null {
  const name = t.assigneeName || "them";
  if (isTaskDone(t)) {
    if (!t.completedBy || (!isHandoff(t) && t.completedBy === viewerUid)) return null;
    const by = t.completedBy === viewerUid ? "you" : t.completedByName || "someone";
    return { label: `Done by ${by}`, tone: "done", needsMyAnswer: false, canFollowUp: false };
  }
  if (!isHandoff(t)) return null;
  const mine = t.assigneeUid === viewerUid;
  switch (t.state) {
    case "proposed":
      if (mine) return { label: `${t.createdByName || "Someone"} asked you`, tone: "ask", needsMyAnswer: true, canFollowUp: false };
      if (t.proposedAt && now - t.proposedAt > NO_ANSWER_MS) return { label: "Not accepted yet", tone: "warn", needsMyAnswer: false, canFollowUp: t.createdBy === viewerUid };
      return { label: `Waiting for ${name}`, tone: "waiting", needsMyAnswer: false, canFollowUp: false };
    case "declined":
      if (mine) return { label: "You said no", tone: "warn", needsMyAnswer: false, canFollowUp: false };
      return { label: `${name} declined`, tone: "warn", needsMyAnswer: false, canFollowUp: t.createdBy === viewerUid };
    case "accepted":
      return { label: mine ? "You're on it" : `${name} is on it`, tone: "ok", needsMyAnswer: false, canFollowUp: false };
    default:
      return null;
  }
}
