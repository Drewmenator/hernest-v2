import { describe, it, expect } from "vitest";
import {
  parseRemindAt, reminderFromToolInput, taskRemindsMe, planTaskReminders, formatRemindAt,
  FIRST_TASK_ID, MAX_TASK_REMINDERS, type RemindableTask,
} from "./taskReminders";

const NOW = new Date(2026, 9, 21, 10, 0); // Wed Oct 21 2026, 10:00 AM local
const me = "me", sam = "sam";
const task = (over: Partial<RemindableTask> = {}): RemindableTask =>
  ({ id: "t1", title: "Call the dentist", status: "pending", createdBy: me, remindAt: "2026-10-21T15:00", ...over });

describe("parseRemindAt", () => {
  it("keeps a local date and time", () => {
    expect(parseRemindAt("2026-10-21T15:00")).toBe("2026-10-21T15:00");
    expect(parseRemindAt("2026-10-22 09:00:00")).toBe("2026-10-22T09:00");
    expect(parseRemindAt("2026-10-22T9:05")).toBe("2026-10-22T09:05");
  });
  it("turns a time with a zone into local time", () => {
    const d = new Date("2026-10-21T19:00:00Z");
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(parseRemindAt("2026-10-21T19:00:00Z"))
      .toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
  });
  it("rejects anything else", () => {
    for (const bad of [undefined, null, 15, "", "3pm", "tomorrow morning", "2026-10-21", "2026-02-30T09:00", "2026-10-21T25:00", "2026-10-21T10:61"]) {
      expect(parseRemindAt(bad)).toBeNull();
    }
  });
});

describe("reminderFromToolInput (Cleo's add_task)", () => {
  it("no remindAt: nothing to set", () => {
    expect(reminderFromToolInput({}, NOW)).toEqual({});
    expect(reminderFromToolInput({ remindAt: "" }, NOW)).toEqual({});
  });
  it("a future time is kept", () => {
    expect(reminderFromToolInput({ remindAt: "2026-10-22T09:00" }, NOW)).toEqual({ remindAt: "2026-10-22T09:00" });
  });
  it("an unreadable or past time is not saved, with a reason", () => {
    expect(reminderFromToolInput({ remindAt: "3pm" }, NOW).remindAt).toBeUndefined();
    expect(reminderFromToolInput({ remindAt: "3pm" }, NOW).problem).toMatch(/couldn't read/);
    expect(reminderFromToolInput({ remindAt: "2026-10-21T08:00" }, NOW).problem).toMatch(/already passed/);
  });
});

describe("formatRemindAt", () => {
  it("says today / tomorrow / the day", () => {
    expect(formatRemindAt("2026-10-21T15:00", NOW)).toBe("today at 3:00 PM");
    expect(formatRemindAt("2026-10-22T09:00", NOW)).toBe("tomorrow at 9:00 AM");
    expect(formatRemindAt("2026-10-24T09:30", NOW)).toBe("Sat, Oct 24 at 9:30 AM");
  });
});

describe("taskRemindsMe: whose phone", () => {
  it("my own plain task reminds me, not my partner", () => {
    expect(taskRemindsMe(task(), me)).toBe(true);
    expect(taskRemindsMe(task(), sam)).toBe(false);
  });
  it("an older task with no creator reminds whoever has the app", () => {
    expect(taskRemindsMe(task({ createdBy: undefined }), sam)).toBe(true);
  });
  it("a task asked of Sam reminds nobody until Sam accepts, then only Sam", () => {
    const asked = task({ assigneeUid: sam, assigneeName: "Sam", state: "proposed" });
    expect(taskRemindsMe(asked, me)).toBe(false);
    expect(taskRemindsMe(asked, sam)).toBe(false);
    const accepted = { ...asked, state: "accepted" as const };
    expect(taskRemindsMe(accepted, sam)).toBe(true);
    expect(taskRemindsMe(accepted, me)).toBe(false);
  });
  it("declined goes back to whoever asked", () => {
    const declined = task({ assigneeUid: sam, state: "declined" });
    expect(taskRemindsMe(declined, me)).toBe(true);
    expect(taskRemindsMe(declined, sam)).toBe(false);
  });
  it("done, unconfirmed, or no reminder: no alert", () => {
    expect(taskRemindsMe(task({ status: "completed" }), me)).toBe(false);
    expect(taskRemindsMe(task({ assigneeUid: sam, state: "done" }), sam)).toBe(false);
    expect(taskRemindsMe(task({ userConfirmed: false }), me)).toBe(false);
    expect(taskRemindsMe(task({ remindAt: undefined }), me)).toBe(false);
  });
});

describe("planTaskReminders", () => {
  it("schedules only my future reminders, soonest first, with stable ids", () => {
    const plan = planTaskReminders([
      task({ id: "later", title: "Later", remindAt: "2026-10-23T09:00" }),
      task({ id: "soon", title: "Soon", remindAt: "2026-10-21T15:00" }),
      task({ id: "past", remindAt: "2026-10-21T08:00" }),
      task({ id: "done", status: "completed" }),
      task({ id: "partner", createdBy: sam }),
    ], NOW, me);
    expect(plan.map(r => r.taskId)).toEqual(["soon", "later"]);
    expect(plan.map(r => r.id)).toEqual([FIRST_TASK_ID, FIRST_TASK_ID + 1]);
    expect(plan[0].title).toBe("Soon");
    expect(plan[0].at).toEqual(new Date(2026, 9, 21, 15, 0));
  });
  it("a task ticked off or deleted drops out of the next plan (so its alert is cancelled)", () => {
    const tasks = [task({ id: "a" }), task({ id: "b", remindAt: "2026-10-22T09:00" })];
    expect(planTaskReminders(tasks, NOW, me)).toHaveLength(2);
    expect(planTaskReminders([{ ...tasks[0], status: "completed" }, tasks[1]], NOW, me).map(r => r.taskId)).toEqual(["b"]);
    expect(planTaskReminders([tasks[1]], NOW, me).map(r => r.taskId)).toEqual(["b"]);
  });
  it("a task handed to Sam leaves my plan", () => {
    const handed = task({ assigneeUid: sam, state: "accepted" });
    expect(planTaskReminders([handed], NOW, me)).toEqual([]);
    expect(planTaskReminders([handed], NOW, sam)).toHaveLength(1);
  });
  it("caps how many go to the phone", () => {
    const many = Array.from({ length: 20 }, (_, i) => task({ id: `t${i}`, remindAt: `2026-10-${String(22 + (i % 5)).padStart(2, "0")}T${String(8 + i % 10).padStart(2, "0")}:00` }));
    expect(planTaskReminders(many, NOW, me)).toHaveLength(MAX_TASK_REMINDERS);
  });
});
