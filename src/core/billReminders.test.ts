import { describe, it, expect } from "vitest";
import { planBillReminders, askDateFor, FIRST_ID, MAX_REMINDERS, setBillFocus, takeBillFocus } from "./billReminders";
import { markPaid, type Bill } from "./bills";

// Mon 2026-10-19, 08:00 local (before the 09:00 send time).
const NOW = new Date(2026, 9, 19, 8, 0);

const electric: Bill = { id: "e", name: "Electric", amount: 142, cadence: "monthly", dueDay: 22, addedOn: "2026-10-01" };

function summary(plan: ReturnType<typeof planBillReminders>) {
  return plan.map(r => `${r.kind} ${r.at.getMonth() + 1}/${r.at.getDate()} ${r.at.getHours()}:00`);
}

describe("planBillReminders", () => {
  it("bill you pay: 3 days before, due day, and the morning after", () => {
    const plan = planBillReminders([electric], NOW, { horizonDays: 10 });
    expect(summary(plan)).toEqual(["before 10/19 9:00", "dueday 10/22 9:00", "overdue 10/23 9:00"]);
    expect(plan[0].title).toBe("Electric $142 due Thursday");
    expect(plan.every(r => r.canMarkPaid && r.due === "2026-10-22")).toBe(true);
  });

  it("amount is optional", () => {
    const plan = planBillReminders([{ ...electric, amount: undefined }], NOW, { horizonDays: 10 });
    expect(plan[0].title).toBe("Electric due Thursday");
  });

  it("once paid, the due-day and overdue notices for that repeat drop out", () => {
    const paid = markPaid(electric, NOW);
    const plan = planBillReminders([paid], NOW, { horizonDays: 10 });
    expect(plan).toEqual([]);
  });

  it("autopay: a heads-up the day before and a check the day after, no Paid button", () => {
    const rent: Bill = { id: "r", name: "Rent", amount: 1800, cadence: "monthly", dueDay: 1, autopay: true, addedOn: "2026-10-01" };
    const plan = planBillReminders([rent], NOW, { horizonDays: 20 });
    expect(summary(plan)).toEqual(["autopay 10/31 9:00", "autopay 11/2 9:00"]);
    expect(plan[0].title).toBe("Rent goes out tomorrow");
    expect(plan[0].body).toContain("$1,800");
    expect(plan[1].title).toBe("Did your Rent autopay go through?");
    expect(plan.every(r => !r.canMarkPaid)).toBe(true);
  });

  it("an autopay that didn't go through is reminded like an unpaid bill", () => {
    const water: Bill = { id: "w", name: "Water", cadence: "monthly", dueDay: 18, autopay: true, addedOn: "2026-10-01", autopayFailed: "2026-10-18" };
    const plan = planBillReminders([water], NOW, { horizonDays: 5 });
    expect(plan[0].kind).toBe("overdue");
    expect(plan[0].canMarkPaid).toBe(true);
  });

  it("overdue: one nudge the morning after, and no repeats of it", () => {
    const water: Bill = { id: "w", name: "Water", cadence: "monthly", dueDay: 18, addedOn: "2026-10-01" };
    // Yesterday's bill, still unpaid: the nudge is at 09:00 today.
    const today = planBillReminders([water], NOW, { horizonDays: 5 });
    expect(summary(today)).toEqual(["overdue 10/19 9:00"]);
    // Later the same day the nudge has gone out; nothing more is planned for it.
    const later = planBillReminders([water], new Date(2026, 9, 19, 10), { horizonDays: 5 });
    expect(later).toEqual([]);
  });

  it("schedules next month's repeat too, so reminders keep coming if the app isn't opened", () => {
    const plan = planBillReminders([electric], NOW, { horizonDays: 35 });
    expect(plan.filter(r => r.due === "2026-11-22").map(r => r.kind)).toEqual(["before", "dueday", "overdue"]);
  });

  it("skips times that have already passed", () => {
    const plan = planBillReminders([electric], new Date(2026, 9, 19, 9, 30), { horizonDays: 10 });
    expect(plan.map(r => r.kind)).toEqual(["dueday", "overdue"]);
  });

  it("'Not sure' bills: asks once, on the 1st of the month after it was added", () => {
    const unsure: Bill = { id: "u", name: "Gas", cadence: "monthly", dueUnknown: true, addedOn: "2026-10-12" };
    const plan = planBillReminders([unsure], NOW);
    expect(summary(plan)).toEqual(["askdate 11/1 9:00"]);
    expect(plan[0].title).toBe("Did your Gas bill come yet?");
    expect(plan[0].canMarkPaid).toBe(false);
    // After that day it is never planned again.
    expect(planBillReminders([unsure], new Date(2026, 10, 2))).toEqual([]);
    expect(askDateFor({ ...unsure, addedOn: "2026-12-31" })?.getMonth()).toBe(0);
  });

  it("who pays: reminders only go to that person", () => {
    const mine = { ...electric, id: "m", payer: "me" };
    const theirs = { ...electric, id: "t", payer: "partner" };
    const either = { ...electric, id: "x" };
    const ids = (uid: string) => [...new Set(planBillReminders([mine, theirs, either], NOW, { uid, horizonDays: 10 }).map(r => r.billId))].sort();
    expect(ids("me")).toEqual(["m", "x"]);
    expect(ids("partner")).toEqual(["t", "x"]);
  });

  it("ids are a fixed block, soonest first, capped for the iOS limit", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...electric, id: `b${i}`, dueDay: (i % 28) + 1 }));
    const plan = planBillReminders(many, NOW);
    expect(plan.length).toBe(MAX_REMINDERS);
    expect(plan[0].id).toBe(FIRST_ID);
    expect(plan[MAX_REMINDERS - 1].id).toBe(FIRST_ID + MAX_REMINDERS - 1);
    for (let i = 1; i < plan.length; i++) expect(plan[i].at.getTime()).toBeGreaterThanOrEqual(plan[i - 1].at.getTime());
  });

  it("the same bills give the same plan (no duplicate notifications on re-sync)", () => {
    expect(planBillReminders([electric], NOW)).toEqual(planBillReminders([electric], NOW));
  });

  it("one-time bills stop after their date", () => {
    const once: Bill = { id: "o", name: "Camp fee", amount: 250, cadence: "once", dueDate: "2026-10-25", addedOn: "2026-10-01" };
    expect(planBillReminders([once], NOW).map(r => r.kind)).toEqual(["before", "dueday", "overdue"]);
  });
});

describe("bill focus hand-off", () => {
  it("is taken once", () => {
    setBillFocus({ billId: "e", markPaid: true, due: "2026-10-22" });
    expect(takeBillFocus()).toEqual({ billId: "e", markPaid: true, due: "2026-10-22" });
    expect(takeBillFocus()).toBeNull();
  });
});
