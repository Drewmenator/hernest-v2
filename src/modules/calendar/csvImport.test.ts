import { describe, it, expect } from "vitest";
import { parseCsvEvents, normalizeDate } from "./csvImport";

describe("normalizeDate", () => {
  it("ISO passes through, zero-padded", () => {
    expect(normalizeDate("2026-7-5")).toBe("2026-07-05");
    expect(normalizeDate("2026-07-05")).toBe("2026-07-05");
  });
  it("day-first slashes (ambiguous → day-first)", () => {
    expect(normalizeDate("05/07/2026")).toBe("2026-07-05");
  });
  it("detects month when a part is > 12", () => {
    expect(normalizeDate("13/07/2026")).toBe("2026-07-13"); // 13 must be the day
    expect(normalizeDate("07/13/2026")).toBe("2026-07-13"); // 13 must be the day
  });
  it("textual dates", () => {
    expect(normalizeDate("5 Jul 2026")).toBe("2026-07-05");
    expect(normalizeDate("July 5, 2026")).toBe("2026-07-05");
  });
  it("2-digit year", () => {
    expect(normalizeDate("05/07/26")).toBe("2026-07-05");
  });
  it("junk → null", () => {
    expect(normalizeDate("next week")).toBeNull();
    expect(normalizeDate("")).toBeNull();
  });
});

describe("parseCsvEvents", () => {
  it("parses a standard CSV with title + date", () => {
    const csv = "Title,Date\nSports Day,2026-09-12\nHalf Term,2026-10-24";
    expect(parseCsvEvents(csv)).toEqual([
      { title: "Sports Day", date: "2026-09-12", endDate: undefined },
      { title: "Half Term", date: "2026-10-24", endDate: undefined },
    ]);
  });
  it("is column-order independent and reads end dates", () => {
    const csv = "date,end,event\n2026-09-12,2026-09-14,Camp";
    expect(parseCsvEvents(csv)).toEqual([{ title: "Camp", date: "2026-09-12", endDate: "2026-09-14" }]);
  });
  it("honours quoted fields with commas", () => {
    const csv = 'Event,Date\n"Exam, Maths Paper 1",2026-05-14';
    expect(parseCsvEvents(csv)[0].title).toBe("Exam, Maths Paper 1");
  });
  it("handles tab-separated and alternate headers", () => {
    const tsv = "Subject\tStart\nPTA Meeting\t14/05/2026";
    expect(parseCsvEvents(tsv)).toEqual([{ title: "PTA Meeting", date: "2026-05-14", endDate: undefined }]);
  });
  it("skips rows with unparseable dates, keeps good ones", () => {
    const csv = "Title,Date\nGood,2026-01-05\nBad,sometime\nAlso Good,2026-02-10";
    expect(parseCsvEvents(csv).map(e => e.title)).toEqual(["Good", "Also Good"]);
  });
  it("returns [] without a usable header", () => {
    expect(parseCsvEvents("foo,bar\n1,2")).toEqual([]);
    expect(parseCsvEvents("")).toEqual([]);
  });
});
