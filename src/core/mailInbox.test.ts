import { describe, it, expect, vi } from "vitest";

vi.mock("./firebase", () => ({ db: {}, auth: {}, loadData: vi.fn(), saveData: vi.fn() }));
vi.mock("./householdItems", () => ({ createItem: vi.fn() }));
vi.mock("../shared/utils/money", () => ({ getCurrency: () => "USD" }));

import { pendingMailItems, taskFromMailItem, eventFromMailItem, whenLabel, dueLabel, type MailItem } from "./mailInbox";

const item = (over: Partial<MailItem> = {}): MailItem => ({
  id: "gmail_m1_sign_form", title: "Sign Emma's field trip form", category: "school", from: "Katy ISD",
  subject: "Field trip", messageId: "m1", foundAt: 1, status: "pending", ...over,
});

describe("From your email", () => {
  it("shows only waiting items, soonest due first", () => {
    const list = pendingMailItems([
      item({ id: "a", dueDate: "2026-11-01" }), item({ id: "b", status: "added" }),
      item({ id: "c" }), item({ id: "d", dueDate: "2026-10-22" }), item({ id: "e", status: "dismissed" }),
    ]);
    expect(list.map(i => i.id)).toEqual(["d", "a", "c"]);
  });

  it("Add makes a confirmed Plan task with the due date", () => {
    expect(taskFromMailItem(item({ dueDate: "2026-10-22" }), "u1", 7)).toMatchObject({
      id: "task_gmail_m1_sign_form", title: "Sign Emma's field trip form", category: "School", source: "school", createdBy: "u1",
      userConfirmed: true, status: "pending", dueDate: "2026-10-22", priority: "high", createdAt: 7,
    });
    expect(taskFromMailItem(item({ category: "travel" }), "u1")).toMatchObject({ category: "travel", source: "email", priority: "medium" });
  });

  it("a date from her email becomes a calendar entry only when she adds it", () => {
    const flight = item({ kind: "event", title: "UA 123 Houston to Denver", date: "2026-11-02", time: "7:05 AM", category: "travel" });
    expect(eventFromMailItem(flight)).toEqual({ id: "cal_gmail_m1_sign_form", title: "UA 123 Houston to Denver", date: "2026-11-02", source: "email", allDay: false, time: "7:05 AM" });
    expect(whenLabel(flight)).toBe("Mon, Nov 2 at 7:05 AM");
  });

  it("says when things are due in plain words", () => {
    expect(dueLabel("2026-10-21", "2026-10-21")).toBe("due today");
    expect(dueLabel("2026-10-22", "2026-10-21")).toBe("due tomorrow");
    expect(dueLabel("2026-10-25", "2026-10-21")).toBe("due in 4 days");
    expect(dueLabel("2026-11-15", "2026-10-21")).toBe("due Nov 15");
    expect(dueLabel(undefined, "2026-10-21")).toBe("");
  });
});
