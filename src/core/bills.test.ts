import { describe, it, expect } from "vitest";
import { nextDueDate, daysUntilDue } from "./bills";

const NOW = new Date(2026, 6, 11); // 2026-07-11 (local)

describe("nextDueDate", () => {
  it("monthly: rolls to next month once the day has passed", () => {
    expect(nextDueDate({ cadence: "monthly", dueDay: 5 }, NOW)).toBe("2026-08-05");
  });
  it("monthly: this month if the day is still ahead", () => {
    expect(nextDueDate({ cadence: "monthly", dueDay: 20 }, NOW)).toBe("2026-07-20");
  });
  it("monthly: due today counts as today", () => {
    expect(nextDueDate({ cadence: "monthly", dueDay: 11 }, NOW)).toBe("2026-07-11");
  });
  it("monthly: clamps day 31 to a short month (Feb)", () => {
    expect(nextDueDate({ cadence: "monthly", dueDay: 31 }, new Date(2026, 1, 1))).toBe("2026-02-28");
  });
  it("yearly: next anniversary of the anchor", () => {
    expect(nextDueDate({ cadence: "yearly", dueDate: "2020-03-15" }, NOW)).toBe("2027-03-15");
    expect(nextDueDate({ cadence: "yearly", dueDate: "2020-09-01" }, NOW)).toBe("2026-09-01");
  });
  it("weekly: advances by 7 from the anchor to on/after today", () => {
    expect(nextDueDate({ cadence: "weekly", dueDate: "2026-07-06" }, NOW)).toBe("2026-07-13");
  });
  it("once: returns the fixed date", () => {
    expect(nextDueDate({ cadence: "once", dueDate: "2026-12-01" }, NOW)).toBe("2026-12-01");
  });
});

describe("daysUntilDue", () => {
  it("0 on the due day", () => {
    expect(daysUntilDue({ cadence: "monthly", dueDay: 11 }, NOW)).toBe(0);
  });
  it("counts forward", () => {
    expect(daysUntilDue({ cadence: "monthly", dueDay: 14 }, NOW)).toBe(3);
  });
  it("null when uncomputable", () => {
    expect(daysUntilDue({ cadence: "once" }, NOW)).toBeNull();
  });
});

// ── Paid / overdue behaviour (Bills redesign, Oct 2026) ──────────────
import { markPaid, undoPaid, settleAutopay, displayAmount, groupOf, monthlyEstimate, dueLabel, paidThisMonth, billKey, type Bill } from "./bills";

const OCT21 = new Date(2026, 9, 21);
const rent = (over: Partial<Bill> = {}): Bill => ({ id: "r", name: "Rent", cadence: "monthly", dueDay: 1, addedOn: "2026-09-15", ...over });

describe("current due date", () => {
  it("a missed monthly bill stays due and goes overdue instead of rolling on", () => {
    // Added 15 Sep, due on the 1st, never paid: the 1 Oct repeat is still due.
    expect(nextDueDate(rent(), OCT21)).toBe("2026-10-01");
    expect(daysUntilDue(rent(), OCT21)).toBe(-20);
    expect(groupOf(rent(), OCT21)).toBe("overdue");
    expect(dueLabel(rent(), OCT21)).toBe("20 days overdue");
    expect(dueLabel(rent({ addedOn: "2026-10-05" }), OCT21)).toBe("Due in 11 days");
    expect(dueLabel({ id: "i", name: "Ins", cadence: "semiannual", dueDate: "2027-03-01" }, OCT21)).toBe("Due Mar 1");
  });
  it("repeats before the bill was added never count as missed", () => {
    expect(nextDueDate(rent({ addedOn: "2026-10-05" }), OCT21)).toBe("2026-11-01");
  });
  it("marking paid moves to the next repeat", () => {
    const paid = markPaid(rent(), OCT21, 1800);
    expect(paid.paidThrough).toBe("2026-10-01");
    expect(nextDueDate(paid, OCT21)).toBe("2026-11-01");
    expect(paid.amount).toBe(1800); // learned on first payment
    expect(paid.payments?.[0]).toMatchObject({ due: "2026-10-01", paidOn: "2026-10-21", amount: 1800 });
  });
  it("paying early ticks off the upcoming repeat, not the one after", () => {
    const b = rent({ addedOn: "2026-10-05" });          // next due 1 Nov
    const paid = markPaid(b, new Date(2026, 9, 29));     // paid 29 Oct
    expect(paid.paidThrough).toBe("2026-11-01");
    expect(nextDueDate(paid, new Date(2026, 10, 2))).toBe("2026-12-01");
  });
  it("undo puts the bill back", () => {
    const back = undoPaid(markPaid(rent(), OCT21));
    expect(back.paidThrough).toBeUndefined();
    expect(nextDueDate(back, OCT21)).toBe("2026-10-01");
  });
  it("a paid one-time bill is done", () => {
    const b: Bill = { id: "o", name: "School trip", cadence: "once", dueDate: "2026-10-25" };
    expect(groupOf(markPaid(b, OCT21), OCT21)).toBe("done");
  });
  it("no date yet goes in its own group", () => {
    const b: Bill = { id: "e", name: "Electric", cadence: "monthly", dueUnknown: true };
    expect(nextDueDate(b, OCT21)).toBeNull();
    expect(groupOf(b, OCT21)).toBe("nodate");
  });
});

describe("new repeat options", () => {
  it("every 2 weeks from an anchor", () => {
    expect(nextDueDate({ cadence: "biweekly", dueDate: "2026-10-02" }, OCT21)).toBe("2026-10-30");
  });
  it("every 6 months from an anchor", () => {
    expect(nextDueDate({ cadence: "semiannual", dueDate: "2026-03-10" }, OCT21)).toBe("2027-03-10");
    expect(nextDueDate({ cadence: "semiannual", dueDate: "2026-05-10" }, OCT21)).toBe("2026-11-10");
  });
  it("every 3 months clamps the 31st", () => {
    expect(nextDueDate({ cadence: "quarterly", dueDate: "2026-08-31" }, OCT21)).toBe("2026-11-30");
  });
});

describe("amounts and totals", () => {
  it("no amount is fine", () => {
    expect(displayAmount({ id: "x", name: "Phone", cadence: "monthly", dueDay: 3 })).toEqual({ amount: null, estimate: false });
  });
  it("a varying bill shows about the average of recent payments", () => {
    const b: Bill = { id: "e", name: "Electric", cadence: "monthly", dueDay: 9, amountVaries: true,
      payments: [{ due: "2026-10-09", paidOn: "2026-10-08", amount: 150 }, { due: "2026-09-09", paidOn: "2026-09-09", amount: 130 }] };
    expect(displayAmount(b)).toEqual({ amount: 140, estimate: true });
  });
  it("monthly estimate converts cadences and skips unknown amounts", () => {
    const bills: Bill[] = [
      { id: "1", name: "Rent", cadence: "monthly", dueDay: 1, amount: 1800 },
      { id: "2", name: "Insurance", cadence: "semiannual", dueDate: "2026-03-01", amount: 600 },
      { id: "3", name: "Phone", cadence: "monthly", dueDay: 3 },
    ];
    expect(monthlyEstimate(bills)).toBe(1900);
  });
  it("paid this month lists this month's payments only", () => {
    const b = markPaid(rent(), OCT21);
    expect(paidThisMonth([b], OCT21)).toHaveLength(1);
    expect(paidThisMonth([b], new Date(2026, 10, 2))).toHaveLength(0);
  });
  it("billKey matches near-identical names", () => {
    expect(billKey("NETFLIX.COM")).toBe(billKey("Netflix"));
  });
});

describe("autopay", () => {
  it("past autopay repeats tick themselves off, so they never show overdue", () => {
    const b: Bill = { id: "a", name: "Car", cadence: "monthly", dueDay: 5, autopay: true, amount: 320, addedOn: "2026-08-20" };
    const s = settleAutopay(b, OCT21);
    expect(s.payments?.map(p => p.due)).toEqual(["2026-10-05", "2026-09-05"]);
    expect(s.payments?.[0]).toMatchObject({ auto: true, amount: 320 });
    expect(nextDueDate(s, OCT21)).toBe("2026-11-05");
  });
  it("leaves non-autopay and up-to-date bills untouched", () => {
    const manual = rent();
    expect(settleAutopay(manual, OCT21)).toBe(manual);
    const upToDate: Bill = { id: "a", name: "Car", cadence: "monthly", dueDay: 25, autopay: true, addedOn: "2026-10-01" };
    expect(settleAutopay(upToDate, OCT21)).toBe(upToDate);
  });
});
