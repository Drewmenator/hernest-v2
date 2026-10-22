// ─── Task reminders: which tasks alert this phone, and when ──────────
// A task can carry `remindAt`, a local date and time ("2026-10-21T15:00").
// Like bill reminders they go out as LOCAL notifications (see
// syncTaskReminders in localNotifications.ts), and the whole plan is rebuilt
// every time the tasks change, so a task that is ticked off, deleted or handed
// to someone else stops reminding on this phone.
//
// Whose phone: the person the task belongs to (taskOwnership.ts).
//   plain task:    whoever added it (older tasks with no creator: everyone)
//   asked, not yet accepted: nobody
//   accepted:      the person who said yes
//   declined:      whoever asked, since it is theirs again
// Tasks still waiting for Confirm (added by Cleo or from email) don't remind.
import { isHandoff, isTaskDone, type OwnedTask } from "./taskOwnership";

export interface RemindableTask extends OwnedTask {
  remindAt?: string;
  userConfirmed?: boolean;
}

export interface TaskReminder {
  id: number;               // local notification id (FIRST_TASK_ID upward)
  at: Date;
  taskId: string;
  title: string;
  body: string;
}

// iOS keeps at most 64 pending local notifications per app. Bills take up to
// 48 (ids 30000+), wellness two, so tasks get their own block of 12.
export const FIRST_TASK_ID = 40000;
export const MAX_TASK_REMINDERS = 12;

const pad = (n: number) => String(n).padStart(2, "0");

// The stored form: local "YYYY-MM-DDTHH:mm", no time zone, so a reminder for
// 3:00 PM stays 3:00 PM wherever the phone is.
export function toRemindAt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Read a reminder time from a form or from Cleo's tool input. Accepts
// "YYYY-MM-DDTHH:mm" (seconds and a space instead of T are fine). A time with
// a zone ("Z" or "-05:00") is turned into this phone's local time. Anything
// else, or a date that doesn't exist, gives null.
export function parseRemindAt(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (!m) return null;
  if (m[6]) {
    const d = new Date(s.replace(" ", "T"));
    return isNaN(d.getTime()) ? null : toRemindAt(d);
  }
  const [y, mo, day, h, mi] = m.slice(1, 6).map(Number);
  if (h > 23 || mi > 59) return null;
  const d = new Date(y, mo - 1, day, h, mi);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
  return toRemindAt(d);
}

export function remindAtDate(remindAt: string | undefined): Date | null {
  const s = parseRemindAt(remindAt);
  if (!s) return null;
  const [date, time] = s.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

// "today at 3:00 PM" / "tomorrow at 9:00 AM" / "Fri, Oct 24 at 9:00 AM"
export function formatRemindAt(remindAt: string | undefined, now: Date = new Date()): string {
  const d = remindAtDate(remindAt);
  if (!d) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dayDiff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000,
  );
  if (dayDiff === 0) return `today at ${time}`;
  if (dayDiff === 1) return `tomorrow at ${time}`;
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day} at ${time}`;
}

// Should this task's reminder go off on this person's phone?
export function taskRemindsMe(t: RemindableTask, uid: string): boolean {
  if (!t?.id || !t.remindAt || isTaskDone(t) || t.userConfirmed === false) return false;
  if (isHandoff(t)) {
    if (t.state === "accepted") return t.assigneeUid === uid;
    if (t.state === "declined") return t.createdBy === uid;
    return false;
  }
  return !t.createdBy || t.createdBy === uid;
}

export function planTaskReminders(tasks: RemindableTask[], now: Date, uid: string): TaskReminder[] {
  const out: Omit<TaskReminder, "id">[] = [];
  for (const t of tasks) {
    if (!taskRemindsMe(t, uid)) continue;
    const at = remindAtDate(t.remindAt);
    if (!at || at.getTime() <= now.getTime()) continue;
    out.push({ at, taskId: t.id, title: t.title || "Reminder", body: "Tap to open your Plan." });
  }
  return out
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_TASK_REMINDERS)
    .map((r, i) => ({ ...r, id: FIRST_TASK_ID + i }));
}

// Cleo's add_task tool: read its optional remindAt. A time she can't read, or
// one already past, is not saved; `problem` tells her why so she can say so.
export function reminderFromToolInput(input: { remindAt?: unknown }, now: Date = new Date()): { remindAt?: string; problem?: string } {
  if (input.remindAt === undefined || input.remindAt === null || input.remindAt === "") return {};
  const remindAt = parseRemindAt(input.remindAt);
  if (!remindAt) return { problem: "I couldn't read the reminder time" };
  if ((remindAtDate(remindAt) as Date).getTime() <= now.getTime()) return { problem: "that reminder time has already passed" };
  return { remindAt };
}
