import { describe, it, expect } from "vitest";
import { parseIcs, toSchoolEvents, replaceChildSchool } from "./schoolCalendar";

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261126", "DTEND;VALUE=DATE:20261128", "SUMMARY:Thanksgiving break", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261103T150000Z", "SUMMARY:Picture day\\, bring", "  a smile", "END:VEVENT",
  "BEGIN:VEVENT", "SUMMARY:No date here", "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("school calendar import", () => {
  it("reads .ics: all-day end dates are exclusive, folded lines and escapes are cleaned", () => {
    expect(parseIcs(ICS)).toEqual([
      { title: "Thanksgiving break", date: "2026-11-26", endDate: "2026-11-27" },
      { title: "Picture day, bring a smile", date: "2026-11-03", endDate: null },
    ]);
  });

  it("makes one event per day for the chosen child, multi-day breaks fill each day", () => {
    const ev = toSchoolEvents(parseIcs(ICS), { name: "Maya", color: "#123456" });
    expect(ev.map(e => e.date)).toEqual(["2026-11-03", "2026-11-26", "2026-11-27"]);
    expect(ev.every(e => e.source === "school" && e.child === "Maya" && e.allDay)).toBe(true);
  });

  it("skips bad dates and caps long spans", () => {
    expect(toSchoolEvents([{ title: "x", date: "11/03/2026" }], { name: "Leo" })).toEqual([]);
    expect(toSchoolEvents([{ title: "Summer", date: "2026-06-01", endDate: "2026-08-30" }], { name: "Leo" })).toHaveLength(14);
  });

  it("re-uploading replaces only that child's school dates", () => {
    const existing = [
      { id: "a", title: "Old", date: "2026-10-01", source: "school", child: "Maya" },
      { id: "b", title: "Leo's", date: "2026-10-01", source: "school", child: "Leo" },
      { id: "c", title: "Dentist", date: "2026-10-02", source: "manual" },
    ];
    const next = replaceChildSchool(existing, "Maya", toSchoolEvents([{ title: "New", date: "2026-11-01" }], { name: "Maya" }));
    expect(next.map(e => e.title)).toEqual(["Leo's", "Dentist", "New"]);
  });
});
