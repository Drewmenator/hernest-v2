import { describe, it, expect } from "vitest";
import {
  localParts, wallClockNow, pickTimeZone, morningDue, userTimeZones,
  hourlyTriggerAlive, claimMorning, HOURLY_STALE_MS,
} from "./localTime.js";

// 21 Oct 2026: New York is UTC-4 (EDT), Sydney UTC+11 (AEDT), India UTC+5:30.
const at = iso => new Date(iso);

// Minimal in-memory stand-in for the admin Firestore used by claimMorning.
function fakeDb() {
  const docs = new Map();
  return {
    docs,
    doc: path => ({ path }),
    runTransaction: async fn => fn({
      get: async ref => ({ data: () => docs.get(ref.path) }),
      set: (ref, val) => docs.set(ref.path, { ...(docs.get(ref.path) || {}), ...val }),
    }),
  };
}

describe("localParts / wallClockNow", () => {
  it("reads the wall clock in the user's zone", () => {
    expect(localParts(at("2026-10-21T11:30:00Z"), "America/New_York")).toMatchObject({ date: "2026-10-21", hour: 7, minute: 30 });
  });
  it("uses the user's date, not UTC's, when they are ahead", () => {
    // 20:30 UTC on the 20th is 07:30 on the 21st in Sydney.
    expect(localParts(at("2026-10-20T20:30:00Z"), "Australia/Sydney")).toMatchObject({ date: "2026-10-21", hour: 7 });
    const wall = wallClockNow(at("2026-10-20T20:30:00Z"), "Australia/Sydney");
    expect(wall.toISOString()).toBe("2026-10-21T07:30:00.000Z");
  });
  it("returns null / unchanged for an unknown zone", () => {
    const now = at("2026-10-21T11:30:00Z");
    expect(localParts(now, "Mars/Olympus")).toBeNull();
    expect(wallClockNow(now, "Mars/Olympus")).toBe(now);
  });
});

describe("morningDue (local-hour selection + dedupe)", () => {
  const ny = "America/New_York";
  it("sends at 7am local", () => {
    expect(morningDue({ timeZone: ny, now: at("2026-10-21T11:07:00Z"), lastSentDate: null }))
      .toEqual({ send: true, localDate: "2026-10-21" });
  });
  it("does not send before 7am local", () => {
    expect(morningDue({ timeZone: ny, now: at("2026-10-21T10:59:00Z"), lastSentDate: null }).send).toBe(false);
  });
  it("still sends if the 7am run was late or skipped, until 10am", () => {
    expect(morningDue({ timeZone: ny, now: at("2026-10-21T13:59:00Z"), lastSentDate: null }).send).toBe(true);
    expect(morningDue({ timeZone: ny, now: at("2026-10-21T14:00:00Z"), lastSentDate: null }).send).toBe(false);
  });
  it("does not send twice on the same local date", () => {
    expect(morningDue({ timeZone: ny, now: at("2026-10-21T12:07:00Z"), lastSentDate: "2026-10-21" }).send).toBe(false);
    expect(morningDue({ timeZone: ny, now: at("2026-10-22T11:07:00Z"), lastSentDate: "2026-10-21" }).send).toBe(true);
  });
  it("handles half-hour zones (India 07:07 at 01:37 UTC)", () => {
    expect(morningDue({ timeZone: "Asia/Kolkata", now: at("2026-10-21T01:37:00Z"), lastSentDate: null }).send).toBe(true);
  });
  it("never sends for an unknown zone", () => {
    expect(morningDue({ timeZone: "nope", now: at("2026-10-21T11:07:00Z"), lastSentDate: null }))
      .toEqual({ send: false, localDate: null });
  });
});

describe("pickTimeZone / userTimeZones", () => {
  it("uses the most recently updated device with a valid zone", () => {
    expect(pickTimeZone([
      { timeZone: "Europe/London", updatedAt: 100 },
      { timeZone: "America/New_York", updatedAt: 300 },
      { timeZone: "bogus", updatedAt: 999 },
      { updatedAt: 1000 },
    ])).toBe("America/New_York");
  });
  it("is null when no device has a zone (older app builds)", () => {
    expect(pickTimeZone([{ updatedAt: 1 }])).toBeNull();
    expect(pickTimeZone([])).toBeNull();
  });
  it("groups device rows by user", () => {
    const m = userTimeZones([
      { uid: "a", timeZone: "Europe/London", updatedAt: 1 },
      { uid: "a", timeZone: "Asia/Tokyo", updatedAt: 2 },
      { uid: "b", updatedAt: 5 },
      { timeZone: "Europe/London" }, // no uid: ignored
    ]);
    expect([...m]).toEqual([["a", "Asia/Tokyo"], ["b", null]]);
  });
});

describe("hourlyTriggerAlive", () => {
  const now = Date.parse("2026-10-21T06:00:00Z");
  it("is alive if seen within 3 hours", () => {
    expect(hourlyTriggerAlive(now - 60 * 60 * 1000, now)).toBe(true);
  });
  it("is dead if stale or never seen (daily run then covers everyone)", () => {
    expect(hourlyTriggerAlive(now - HOURLY_STALE_MS, now)).toBe(false);
    expect(hourlyTriggerAlive(undefined, now)).toBe(false);
  });
});

describe("claimMorning (dedupe in push_state)", () => {
  it("claims once per local date and reports the previous date", async () => {
    const db = fakeDb();
    expect(await claimMorning(db, "u1", "2026-10-21")).toBeNull();
    expect(await claimMorning(db, "u1", "2026-10-21")).toBeUndefined();
    expect(db.docs.get("users/u1/data/push_state")).toEqual({ morningSentDate: "2026-10-21" });
    expect(await claimMorning(db, "u1", "2026-10-22")).toBe("2026-10-21");
  });
  it("keeps other push_state fields (birthday dedupe)", async () => {
    const db = fakeDb();
    db.docs.set("users/u1/data/push_state", { birthdaySent: { "June:2026": true } });
    await claimMorning(db, "u1", "2026-10-21");
    expect(db.docs.get("users/u1/data/push_state").birthdaySent).toEqual({ "June:2026": true });
  });
  it("a full day of hourly runs sends exactly once, at local 7am", async () => {
    const db = fakeDb();
    const sentAt = [];
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 9, 21, h, 7));
      const { send, localDate } = morningDue({ timeZone: "America/New_York", now, lastSentDate: null });
      if (send && (await claimMorning(db, "u1", localDate)) !== undefined) sentAt.push(h);
    }
    expect(sentAt).toEqual([11]); // 11:07 UTC = 07:07 in New York
  });
});
