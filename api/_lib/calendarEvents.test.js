import { describe, it, expect } from "vitest";
import {
  localDate, zonedMidnight, wallClock, mapGoogleEvent, fetchGoogleEvents, mapOutlookEvent,
  outlookHeaders, parseICSEvents, mergeSyncedEvents, combineFetches, zoneOr,
} from "./calendarEvents.js";

const CHI = "America/Chicago"; // UTC-5 in October (CDT)

describe("local dates and midnight", () => {
  it("uses the user's date, not UTC's", () => {
    const evening = new Date("2026-10-23T02:30:00Z"); // 9:30pm Oct 22 in Chicago
    expect(localDate(evening, CHI)).toBe("2026-10-22");
    expect(localDate(evening, null)).toBe("2026-10-23");
    expect(localDate(evening, "Not/AZone")).toBe("2026-10-23");
  });

  it("finds the instant local midnight starts, across DST", () => {
    expect(zonedMidnight("2026-10-22", CHI).toISOString()).toBe("2026-10-22T05:00:00.000Z");
    expect(zonedMidnight("2026-12-01", CHI).toISOString()).toBe("2026-12-01T06:00:00.000Z");
    // Nov 1 2026: DST ends at 2am, midnight is still CDT
    expect(zonedMidnight("2026-11-01", CHI).toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(zonedMidnight("2026-10-22", "Australia/Sydney").toISOString()).toBe("2026-10-21T13:00:00.000Z");
    expect(zonedMidnight("2026-10-22", null).toISOString()).toBe("2026-10-22T00:00:00.000Z");
  });

  it("zoneOr falls back to the US pilot zone", () => {
    expect(zoneOr("Europe/London")).toBe("Europe/London");
    expect(zoneOr("")).toBe(CHI);
    expect(zoneOr("nope")).toBe(CHI);
  });

  it("wallClock converts an instant, or reads the string literally without a zone", () => {
    expect(wallClock("2026-10-22T19:30:00-05:00", "America/New_York")).toEqual({ date: "2026-10-22", time: "20:30" });
    expect(wallClock("2026-10-22T19:30:00-05:00", null)).toEqual({ date: "2026-10-22", time: "19:30" });
  });
});

describe("Google mapping", () => {
  it("keeps an evening event on its local day with a 24h time", () => {
    const e = { id: "a", summary: "Dinner", start: { dateTime: "2026-10-23T01:00:00Z" } };
    expect(mapGoogleEvent(e, { backgroundColor: "#111", summary: "Family" }, CHI)).toEqual({
      id: "google_a", title: "Dinner", date: "2026-10-22", time: "20:00",
      source: "google", color: "#111", allDay: false, calendar: "Family",
    });
  });

  it("all-day events have no time", () => {
    const m = mapGoogleEvent({ id: "b", start: { date: "2026-10-24" } }, {}, CHI);
    expect(m).toMatchObject({ date: "2026-10-24", allDay: true, title: "Event" });
    expect(m.time).toBeUndefined();
  });
});

describe("fetchGoogleEvents", () => {
  const fake = (routes) => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      const hit = routes.find(([re]) => re.test(url));
      if (!hit) throw new Error(`unexpected ${url}`);
      const body = typeof hit[1] === "function" ? hit[1](url) : hit[1];
      return { json: async () => body };
    };
    return { fetchImpl, calls };
  };
  const NOW = new Date("2026-10-22T18:00:00Z"); // 1pm Chicago

  it("starts at local midnight, maps events, and reports a complete fetch", async () => {
    const { fetchImpl, calls } = fake([
      [/calendarList/, { items: [{ id: "cal1", summary: "Home" }, { id: "busy", accessRole: "freeBusyReader" }] }],
      [/calendars\/cal1\/events/, { items: [{ id: "x", summary: "School run", start: { dateTime: "2026-10-22T13:00:00Z" } }] }],
    ]);
    const r = await fetchGoogleEvents("tok", { tz: CHI, now: NOW, fetchImpl });
    expect(r.complete).toBe(true);
    expect(r.from).toBe("2026-10-22");
    expect(r.to).toBe("2026-12-21");
    expect(r.events).toEqual([expect.objectContaining({ id: "google_x", date: "2026-10-22", time: "08:00" })]);
    expect(decodeURIComponent(calls[1])).toContain("timeMin=2026-10-22T05:00:00.000Z");
    expect(calls.some(u => u.includes("busy"))).toBe(false);
  });

  it("follows pages", async () => {
    const { fetchImpl } = fake([
      [/calendarList/, { items: [{ id: "c" }] }],
      [/pageToken=p2/, { items: [{ id: "2", start: { date: "2026-10-25" } }] }],
      [/calendars\/c\/events/, { items: [{ id: "1", start: { date: "2026-10-24" } }], nextPageToken: "p2" }],
    ]);
    const r = await fetchGoogleEvents("tok", { tz: CHI, now: NOW, fetchImpl });
    expect(r.events.map(e => e.id)).toEqual(["google_1", "google_2"]);
    expect(r.complete).toBe(true);
  });

  it("is incomplete when a calendar errors, the list fails, or there are no calendars", async () => {
    const errored = fake([
      [/calendarList/, { items: [{ id: "ok" }, { id: "bad" }] }],
      [/calendars\/ok\/events/, { items: [] }],
      [/calendars\/bad\/events/, { error: { code: 403 } }],
    ]);
    expect((await fetchGoogleEvents("t", { tz: CHI, now: NOW, fetchImpl: errored.fetchImpl })).complete).toBe(false);
    const listFail = fake([[/calendarList/, { error: { code: 401 } }]]);
    expect((await fetchGoogleEvents("t", { tz: CHI, now: NOW, fetchImpl: listFail.fetchImpl })).complete).toBe(false);
    const none = fake([[/calendarList/, { items: [] }]]);
    expect((await fetchGoogleEvents("t", { tz: CHI, now: NOW, fetchImpl: none.fetchImpl })).complete).toBe(false);
  });

  it("without a zone, starts early enough and reads Google's own offset", async () => {
    const { fetchImpl, calls } = fake([
      [/calendarList/, { items: [{ id: "c" }] }],
      [/events/, { items: [{ id: "e", start: { dateTime: "2026-10-22T20:00:00-05:00" } }] }],
    ]);
    const r = await fetchGoogleEvents("t", { now: NOW, fetchImpl });
    expect(r.events[0]).toMatchObject({ date: "2026-10-22", time: "20:00" });
    expect(decodeURIComponent(calls[1])).toContain("timeMin=2026-10-21T10:00:00.000Z");
  });
});

describe("Outlook mapping", () => {
  it("asks Graph for the user's zone", () => {
    expect(outlookHeaders("T", "America/New_York")).toEqual({ Authorization: "Bearer T", Prefer: 'outlook.timezone="America/New_York"' });
    expect(outlookHeaders("T").Prefer).toBe(`outlook.timezone="${CHI}"`);
  });

  it("takes the wall clock as-is when Graph honoured the zone", () => {
    const e = { id: "o", subject: "1:1", start: { dateTime: "2026-10-22T19:00:00.0000000", timeZone: CHI } };
    expect(mapOutlookEvent(e, CHI)).toEqual({ id: "outlook_o", title: "1:1", date: "2026-10-22", time: "19:00", source: "work", color: "#0078D4", allDay: false });
  });

  it("converts a UTC answer to the user's day and time", () => {
    const e = { id: "o", subject: "Late call", start: { dateTime: "2026-10-23T01:00:00.0000000", timeZone: "UTC" } };
    expect(mapOutlookEvent(e, CHI)).toMatchObject({ date: "2026-10-22", time: "20:00" });
  });

  it("all-day events have the date and no time", () => {
    const m = mapOutlookEvent({ id: "o", isAllDay: true, start: { dateTime: "2026-10-24T00:00:00.0000000", timeZone: CHI } }, CHI);
    expect(m).toMatchObject({ date: "2026-10-24", allDay: true });
    expect(m.time).toBeUndefined();
  });
});

describe("Apple ICS parsing", () => {
  const ics = (dtstart) => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:u1\r\nSUMMARY:Swim\r\n${dtstart}\r\nEND:VEVENT\r\nEND:VCALENDAR`;

  it("converts a UTC start to the user's day and time", () => {
    expect(parseICSEvents(ics("DTSTART:20261023T010000Z"), CHI)).toEqual([
      { id: "apple_u1", title: "Swim", date: "2026-10-22", time: "20:00", source: "apple", color: "#6E6E73", allDay: false },
    ]);
  });

  it("keeps a TZID wall clock as written", () => {
    expect(parseICSEvents(ics("DTSTART;TZID=America/Chicago:20261022T173000"), CHI)[0]).toMatchObject({ date: "2026-10-22", time: "17:30", allDay: false });
  });

  it("all-day dates have no time", () => {
    const [e] = parseICSEvents(ics("DTSTART;VALUE=DATE:20261024"), CHI);
    expect(e).toMatchObject({ date: "2026-10-24", allDay: true });
    expect(e.time).toBeUndefined();
  });
});

describe("mergeSyncedEvents", () => {
  const existing = [
    { id: "google_past", source: "google", date: "2026-10-20", time: "09:00" },
    { id: "google_cancelled", source: "google", date: "2026-10-25", time: "10:00" },
    { id: "google_kept", source: "google", date: "2026-10-26", time: "11:00" },
    { id: "google_far", source: "google", date: "2027-02-01" },
    { id: "work_1", source: "work", date: "2026-10-25" },
    { id: "gmail_1", source: "gmail", date: "2026-10-27" },
    { id: "google_old", source: "google", date: "2026-10-01" },
  ];
  const fresh = [{ id: "google_kept", source: "google", date: "2026-10-26", allDay: false }];

  it("replaces the source's future events in the window, keeping past and other sources", () => {
    const out = mergeSyncedEvents(existing, fresh, { replace: { source: "google", from: "2026-10-22", to: "2026-12-21" }, cutoff: "2026-10-15" });
    expect(out.map(e => e.id).sort()).toEqual(["gmail_1", "google_far", "google_kept", "google_past", "work_1"]);
  });

  it("merges only (nothing dropped) when the fetch wasn't complete", () => {
    const out = mergeSyncedEvents(existing, fresh, { cutoff: "2026-10-15" });
    expect(out.map(e => e.id)).toContain("google_cancelled");
    expect(out.map(e => e.id)).not.toContain("google_old");
  });

  it("keeps the stored time when the fresh copy came without one", () => {
    const out = mergeSyncedEvents(existing, fresh, {});
    expect(out.find(e => e.id === "google_kept").time).toBe("11:00");
    const withTime = mergeSyncedEvents(existing, [{ ...fresh[0], time: "12:15" }], {});
    expect(withTime.find(e => e.id === "google_kept").time).toBe("12:15");
  });
});

describe("combineFetches", () => {
  it("unions events and narrows the window; complete only if all parts are", () => {
    const a = { events: [{ id: "google_1" }], complete: true, from: "2026-10-22", to: "2026-12-21" };
    const b = { events: [{ id: "google_1" }, { id: "google_2" }], complete: true, from: "2026-10-23", to: "2026-12-20" };
    expect(combineFetches([a, b])).toEqual({ events: [{ id: "google_1" }, { id: "google_2" }], complete: true, from: "2026-10-23", to: "2026-12-20" });
    expect(combineFetches([a, { ...b, complete: false }]).complete).toBe(false);
    expect(combineFetches([a], false).complete).toBe(false);
    expect(combineFetches([]).complete).toBe(false);
  });
});
