import { describe, it, expect } from "vitest";
import { mondayOf, weekDates, sundayWeekDates, ymd, choresToTasks, choreIdOf, buildWeekItems, familyDinnersToPlan, birthdayEvents } from "./planHelpers";

describe("mondayOf (meal plan week start)", () => {
  it("on a Sunday returns the Monday six days earlier, not tomorrow", () => {
    expect(ymd(mondayOf(new Date(2026, 9, 25, 10)))).toBe("2026-10-19");   // Sun 25 Oct
  });
  it("on a Monday returns the same day", () => {
    expect(ymd(mondayOf(new Date(2026, 9, 19, 8)))).toBe("2026-10-19");
  });
  it("midweek and late evening", () => {
    expect(ymd(mondayOf(new Date(2026, 9, 21, 23, 30)))).toBe("2026-10-19"); // Wed 11:30pm
  });
  it("across a month boundary", () => {
    expect(ymd(mondayOf(new Date(2026, 10, 1)))).toBe("2026-10-26");        // Sun 1 Nov
  });
  it("sundayWeekDates gives Sun..Sat, with Sunday starting its own week", () => {
    expect(sundayWeekDates(new Date(2026, 9, 21, 23, 30))).toEqual([  // Wed 11:30pm
      "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24",
    ]);
    expect(sundayWeekDates(new Date(2026, 10, 1))[0]).toBe("2026-11-01"); // Sun 1 Nov
    expect(sundayWeekDates(new Date(2026, 9, 31))[6]).toBe("2026-10-31"); // Sat 31 Oct
  });
  it("weekDates gives Mon..Sun in local time", () => {
    expect(weekDates(new Date(2026, 9, 25, 21))).toEqual([
      "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25",
    ]);
  });
});

describe("choresToTasks", () => {
  it("turns family chores into Plan tasks with a who name", () => {
    const tasks = choresToTasks([
      { id: "c1", title: "Empty dishwasher", assignedTo: "Maya", done: false },
      { id: "c2", title: "Walk dog", done: true, dueDate: "2026-10-22" },
      { id: "", title: "broken" },
    ]);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ id: "chore:c1", title: "Empty dishwasher", who: "Maya", status: "pending", isChore: true, source: "chore" });
    expect(tasks[1]).toMatchObject({ who: "Everyone", status: "completed", dueDate: "2026-10-22" });
    expect(choreIdOf(tasks[0].id)).toBe("c1");
    expect(choreIdOf("abc")).toBeNull();
  });
  it("copes with missing data", () => {
    expect(choresToTasks(undefined)).toEqual([]);
  });
});

describe("buildWeekItems", () => {
  const week = weekDates(new Date(2026, 9, 21));
  it("puts calendar, school, tasks and chores in one list by day", () => {
    const { byDay, undated } = buildWeekItems({
      week,
      events: [
        { id: "e1", title: "Dentist", date: "2026-10-20", time: "15:00", source: "manual" },
        { id: "e2", title: "Book fair", date: "2026-10-20", source: "school", child: "Maya" },
        { id: "e3", title: "Out of week", date: "2026-11-20" },
      ],
      schoolEvents: [{ id: "s1", title: "book fair", date: "2026-10-20" }, { id: "s2", title: "Picture day", date: "2026-10-23T00:00:00" }],
      tasks: [{ id: "t1", title: "Pay field trip", dueDate: "2026-10-22" }, { id: "t2", title: "done", dueDate: "2026-10-22", status: "completed" }],
      chores: [{ id: "c1", title: "Laundry", assignedTo: "Sam" }, { id: "c2", title: "Trash", dueDate: "2026-10-21" }, { id: "c3", title: "x", done: true }],
    });
    expect(byDay["2026-10-20"].map(i => i.title)).toEqual(["Book fair", "Dentist"]);   // school dup dropped; untimed first
    expect(byDay["2026-10-23"][0]).toMatchObject({ title: "Picture day", kind: "school" });
    expect(byDay["2026-10-22"].map(i => i.kind)).toEqual(["task"]);
    expect(byDay["2026-10-21"][0]).toMatchObject({ kind: "chore", who: "Everyone" });
    expect(undated).toEqual([expect.objectContaining({ title: "Laundry", who: "Sam" })]);
    expect(Object.values(byDay).flat().some(i => i.title === "Out of week")).toBe(false);
  });
});

describe("birthdayEvents", () => {
  it("handles full dates and MM-DD across New Year", () => {
    const ev = birthdayEvents([{ id: "a", name: "Maya", birthDate: "2018-01-02" }, { id: "b", name: "Kim", birthday: "7-4" }], 2026);
    expect(ev.map(e => e.date)).toEqual(["2026-01-02", "2027-01-02", "2026-07-04", "2027-07-04"]);
  });
});

describe("familyDinnersToPlan", () => {
  it("maps old Family dinners onto this week's dates in order", () => {
    const plan = familyDinnersToPlan([
      { day: "Wednesday", dinner: "Tacos" },
      { day: "Monday", dinner: "Pasta" },
      { day: "Funday", dinner: "?" },
      { dayName: "Sunday", dinner: "Roast" },
    ], new Date(2026, 9, 25));
    expect(plan?.days).toEqual([
      { date: "2026-10-19", dayName: "Monday", dinner: "Pasta" },
      { date: "2026-10-21", dayName: "Wednesday", dinner: "Tacos" },
      { date: "2026-10-25", dayName: "Sunday", dinner: "Roast" },
    ]);
  });
  it("returns null when there is nothing to show", () => {
    expect(familyDinnersToPlan([])).toBeNull();
    expect(familyDinnersToPlan(undefined)).toBeNull();
  });
});
