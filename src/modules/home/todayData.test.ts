import { describe, it, expect } from "vitest";
import { buildNeedsYou, billsThisWeek, eventsTodayTomorrow, nextTrip, NEEDS_MAX } from "./todayData";
import type { Bill } from "../../core/bills";

const NOW = new Date(2026, 9, 21, 8); // Wed 2026-10-21, 8am local

const bill = (id: string, dueDate: string, extra: Partial<Bill> = {}): Bill =>
  ({ id, name: id, cadence: "once", dueDate, amount: 100, ...extra });

describe("buildNeedsYou", () => {
  it("is empty when nothing is due", () => {
    expect(buildNeedsYou({}, { tripsOn: true, now: NOW })).toEqual([]);
  });

  it("lists overdue and due-today bills with a Paid target, skips autopay and later bills", () => {
    const items = buildNeedsYou({ bills: [
      bill("Rent", "2026-10-21"),
      bill("Water", "2026-10-18"),
      bill("Netflix", "2026-10-21", { autopay: true }),
      bill("Phone", "2026-10-25"),
    ] }, { tripsOn: false, now: NOW });
    expect(items.map(i => i.label)).toEqual(["Rent is due today", "Water is overdue"]);
    expect(items[0].billId).toBe("Rent");
    expect(items[1].detail).toBe("$100 · 3 days late");
  });

  it("collapses overdue tasks into one line and ignores done ones", () => {
    const items = buildNeedsYou({ tasks: [
      { title: "Call dentist", dueDate: "2026-10-19" },
      { title: "Sign form", dueDate: "2026-10-20" },
      { title: "Old", dueDate: "2026-10-01", status: "completed" },
      { title: "Later", dueDate: "2026-10-30" },
    ] }, { tripsOn: false, now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("2 tasks are overdue");
  });

  it("includes school actions due within 3 days and birthdays within 7", () => {
    const items = buildNeedsYou({
      school: [
        { title: "Field trip form", requiresAction: true, actionDeadline: "2026-10-23", child: "Ava" },
        { title: "Book fair", requiresAction: true, date: "2026-10-30" },
        { title: "Picture day", requiresAction: false, date: "2026-10-22" },
      ],
      people: [{ name: "Grandma", birthday: "1950-10-26" }, { name: "grandma", birthday: "10-26" }, { name: "Sam", birthDate: "2018-12-01" }],
    }, { tripsOn: false, now: NOW });
    expect(items.map(i => i.label)).toEqual(["Field trip form", "Grandma's birthday is in 5 days"]);
    expect(items[0].detail).toBe("Ava · needed in 2 days");
  });

  it("shows trip prep only when Trips is switched on", () => {
    const trips = [{ destination: "Orlando", departureDate: "2026-10-30", packingList: [{ done: true }, { done: false }, { done: false }] }];
    expect(buildNeedsYou({ trips }, { tripsOn: false, now: NOW })).toEqual([]);
    const items = buildNeedsYou({ trips }, { tripsOn: true, now: NOW });
    expect(items[0].label).toBe("Pack for Orlando");
    expect(items[0].detail).toBe("Leaves in 9 days · packing 33% done");
  });

  it("never shows more than 5, urgent first", () => {
    const bills = ["A", "B", "C", "D", "E", "F"].map(n => bill(n, "2026-10-21"));
    const items = buildNeedsYou({ bills, people: [{ name: "Kim", birthday: "10-24" }] }, { tripsOn: false, now: NOW });
    expect(items).toHaveLength(NEEDS_MAX);
    expect(items.every(i => i.kind === "bill")).toBe(true);
  });
});

describe("billsThisWeek", () => {
  it("counts unpaid bills due today through 6 days out, with their total", () => {
    const r = billsThisWeek([
      bill("Rent", "2026-10-21", { amount: 1200 }),
      bill("Phone", "2026-10-27", { amount: 80 }),
      bill("Gym", "2026-10-28", { amount: 30 }),
      bill("Water", "2026-10-18"),
      bill("Gift", "2026-10-22", { amount: undefined }),
    ], NOW);
    expect(r).toEqual({ count: 3, total: 1280 });
  });
});

describe("eventsTodayTomorrow", () => {
  it("splits and sorts by time, untimed last", () => {
    const r = eventsTodayTomorrow([
      { title: "Soccer", date: "2026-10-21", time: "16:00" },
      { title: "School run", date: "2026-10-21", time: "07:50" },
      { title: "Bake sale", date: "2026-10-21" },
      { title: "Dentist", date: "2026-10-22", time: "10:00" },
      { title: "Next week", date: "2026-10-28" },
    ], NOW);
    expect(r.today.map(e => e.title)).toEqual(["School run", "Soccer", "Bake sale"]);
    expect(r.tomorrow.map(e => e.title)).toEqual(["Dentist"]);
  });
});

describe("nextTrip", () => {
  it("picks the soonest trip that hasn't started", () => {
    const r = nextTrip([
      { destination: "Past", departureDate: "2026-10-01" },
      { destination: "Later", departureDate: "2026-12-20" },
      { destination: "Soon", departureDate: "2026-11-02" },
    ], NOW);
    expect(r?.trip.destination).toBe("Soon");
    expect(r?.days).toBe(12);
  });
});

describe("buildNeedsYou with task ownership", () => {
  const ago = (days: number) => NOW.getTime() - days * 86400000;
  const ask = { id: "t1", title: "Pick up dry cleaning", status: "pending", createdBy: "alex", createdByName: "Alex", assigneeUid: "sam", assigneeName: "Sam", state: "proposed" as const, proposedAt: ago(0.1) };

  it("asks the assignee to accept or decline", () => {
    const items = buildNeedsYou({ tasks: [ask] }, { tripsOn: false, now: NOW, viewerUid: "sam" });
    expect(items).toEqual([expect.objectContaining({ taskId: "t1", label: "Alex asked you: Pick up dry cleaning" })]);
  });

  it("shows the asker nothing while it's fresh, then Not accepted yet after 2 days", () => {
    expect(buildNeedsYou({ tasks: [ask] }, { tripsOn: false, now: NOW, viewerUid: "alex" })).toEqual([]);
    const late = buildNeedsYou({ tasks: [{ ...ask, proposedAt: ago(3) }] }, { tripsOn: false, now: NOW, viewerUid: "alex" });
    expect(late[0]).toMatchObject({ label: "Not accepted yet: Pick up dry cleaning" });
    expect(late[0].taskId).toBeUndefined();
  });

  it("tells the asker when it was declined", () => {
    const items = buildNeedsYou({ tasks: [{ ...ask, state: "declined" as const }] }, { tripsOn: false, now: NOW, viewerUid: "alex" });
    expect(items[0].label).toBe("Sam declined: Pick up dry cleaning");
  });

  it("an overdue task Sam accepted is Sam's, not Alex's", () => {
    const t = { ...ask, state: "accepted" as const, dueDate: "2026-10-19" };
    expect(buildNeedsYou({ tasks: [t] }, { tripsOn: false, now: NOW, viewerUid: "alex" })).toEqual([]);
    expect(buildNeedsYou({ tasks: [t] }, { tripsOn: false, now: NOW, viewerUid: "sam" })[0].label).toContain("is overdue");
  });

  it("a bill set to the other person stays off your Today", () => {
    const bills = [bill("Rent", "2026-10-21", { payer: "sam" })];
    expect(buildNeedsYou({ bills }, { tripsOn: false, now: NOW, viewerUid: "alex" })).toEqual([]);
    expect(buildNeedsYou({ bills }, { tripsOn: false, now: NOW, viewerUid: "sam" })).toHaveLength(1);
  });
});
