import { describe, it, expect } from "vitest";
import { mergePeople, normalizeName, checkInDueIn, relationLabel, type Person } from "./familyPeople";
import type { FamilyMember } from "./store";

let n = 0;
const ids = () => `id${++n}`;

describe("mergePeople", () => {
  it("copies profile and circle people into an empty list", () => {
    const { members, added } = mergePeople([], [
      { id: "c1", name: "Jess", relationship: "friend", birthday: "1990-04-02", contactFrequency: "monthly" },
    ], {
      partner: { name: "Sam", birthday: "1985-06-01" },
      kids: [{ id: "k1", name: "Maya", birthDate: "2018-03-04", school: "Oak Elementary", allergies: ["nuts"] }],
      parents: [{ name: "Grandma Rose", birthday: "1955-01-20" }],
      inlaws: [{ name: "Pat" }],
    }, ids);
    expect(added).toBe(5);
    const byName = Object.fromEntries(members.map(m => [m.name, m as Person]));
    expect(byName.Sam.role).toBe("partner");
    expect(byName.Sam.birthDate).toBe("1985-06-01");
    expect(byName.Maya).toMatchObject({ id: "k1", role: "child", birthDate: "2018-03-04", notes: "allergies: nuts" });
    expect(byName.Maya.schoolInfo?.schoolName).toBe("Oak Elementary");
    expect(byName["Grandma Rose"]).toMatchObject({ role: "parent", relation: "grandparent" });
    expect(byName.Pat.role).toBe("inlaw");
    expect(byName.Jess).toMatchObject({ role: "other", relation: "friend", birthDate: "1990-04-02" });
    expect(byName.Jess.checkIn).toBeUndefined(); // copied reminders start off
  });

  it("skips duplicates by name (case and spacing ignored) and keeps existing data", () => {
    const existing: FamilyMember[] = [{ id: "m1", name: "Maya", role: "child", color: "#000", notes: "soccer Tuesdays" }];
    const { members, added } = mergePeople(existing, [{ name: " maya ", relationship: "child", birthday: "2018-03-04", notes: "from circle" }],
      { kids: [{ name: "MAYA", birthDate: "2018-03-04" }] }, ids);
    expect(added).toBe(0);
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe("m1");
    expect(members[0].notes).toBe("soccer Tuesdays");     // never overwritten
    expect(members[0].birthDate).toBe("2018-03-04");      // gap filled
  });

  it("never removes existing members", () => {
    const existing: FamilyMember[] = [
      { id: "a", name: "Alex", role: "partner", color: "#1" },
      { id: "b", name: "Ben", role: "child", color: "#2" },
    ];
    const { members } = mergePeople(existing, [], null, ids);
    expect(members.map(m => m.id)).toEqual(["a", "b"]);
  });

  it("dedupes between circle and profile too", () => {
    const { members, added } = mergePeople([], [{ name: "Rose", relationship: "parent" }], { parents: [{ name: "rose", birthday: "1950-02-02" }] }, ids);
    expect(added).toBe(1);
    expect(members[0].birthDate).toBe("1950-02-02");
  });

  it("keeps year-less birthdays in `birthday` so the birthday push still finds them", () => {
    const { members } = mergePeople([], [{ name: "Kim", relationship: "friend", birthday: "07-14" }], null, ids);
    expect((members[0] as Person).birthday).toBe("07-14");
    expect(members[0].birthDate).toBeUndefined();
  });

  it("starts every copied check-in reminder switched off", () => {
    const { members } = mergePeople([], [
      { name: "Sam", relationship: "partner", contactFrequency: "daily" },
      { name: "Lea", relationship: "sibling", contactFrequency: "daily" },
    ], null, ids);
    expect((members[0] as Person).checkIn).toBeUndefined();
    expect((members[1] as Person).checkIn).toBeUndefined();
    expect(relationLabel(members[1] as Person)).toBe("sibling");
  });

  it("handles a legacy string partner and missing names", () => {
    const { members } = mergePeople([], [{ name: "" }, { relationship: "friend" }], { partner: "Chris", kids: [{ name: "  " }] }, ids);
    expect(members.map(m => m.name)).toEqual(["Chris"]);
  });

  it("does not reuse an id that is already taken", () => {
    const { members } = mergePeople([{ id: "k1", name: "Other", role: "other", color: "#1" }], [], { kids: [{ id: "k1", name: "Maya" }] }, () => "fresh");
    expect(members[1].id).toBe("fresh");
  });
});

describe("helpers", () => {
  it("normalizeName", () => {
    expect(normalizeName("  Grandma   Rose ")).toBe("grandma rose");
    expect(normalizeName(undefined)).toBe("");
  });
  it("checkInDueIn", () => {
    const p = { id: "1", name: "Jo", role: "other", color: "", checkIn: "weekly", lastCheckIn: "2026-10-10" } as Person;
    expect(checkInDueIn(p, "2026-10-21")).toBe(-4);
    expect(checkInDueIn({ ...p, checkIn: undefined }, "2026-10-21")).toBeNull();
    expect(checkInDueIn({ ...p, lastCheckIn: undefined }, "2026-10-21")).toBe(0);
  });
});
