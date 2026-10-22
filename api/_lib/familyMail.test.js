import { describe, it, expect, vi } from "vitest";
import {
  buildQueries, looksLikeSchoolDomain, senderDomain, messageText, routeExtraction, scanFamilyMail, EXTRACT_SCHEMA,
} from "./familyMail.js";
import { buildUpstreamBody } from "./claudeRequest.js";
import { fakeDb } from "./fakeDb.testutil.js";

const b64 = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

describe("finding family email", () => {
  it("searches US school platforms, district names, subject words, travel and due dates", () => {
    const all = buildQueries().map((q) => q.q).join("\n");
    for (const s of ["skyward.com", "parentsquare.com", "schoolmessenger.com", "isd", "k12", "\"permission slip\"",
      "teamsnap.com", "dentist", "united.com", "\"boarding pass\"", "\"payment due\"", "schedule", "-category:promotions"]) {
      expect(all).toContain(s);
    }
  });

  it("adds senders it has learned, ignoring junk", () => {
    const q = buildQueries({ learnedDomains: ["katyisd.org", "bad domain!"] });
    expect(q[0].q).toContain("from:(katyisd.org)");
    expect(q[0].q).not.toContain("bad domain");
  });

  it("recognizes district and school addresses", () => {
    expect(looksLikeSchoolDomain("katyisd.org")).toBe(true);
    expect(looksLikeSchoolDomain("lausd.k12.ca.us")).toBe(true);
    expect(looksLikeSchoolDomain("springfieldschools.org")).toBe(true);
    expect(looksLikeSchoolDomain("gmail.com")).toBe(false);
    expect(senderDomain("Katy ISD <noreply@KatyISD.org>")).toBe("katyisd.org");
  });
});

describe("reading an email", () => {
  it("prefers the plain text part, inside nested parts", () => {
    const payload = { mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/alternative", parts: [
      { mimeType: "text/plain", body: { data: b64("Field trip Friday.\n\n\nSign the form by Wed.") } },
      { mimeType: "text/html", body: { data: b64("<p>ignored</p>") } },
    ] }] };
    expect(messageText(payload)).toBe("Field trip Friday.\nSign the form by Wed.");
  });

  it("falls back to HTML with tags and styles removed, and trims long mail", () => {
    const html = `<style>.x{}</style><p>Game at <b>5:30</b>&nbsp;PM</p>${"<div>more</div>".repeat(500)}`;
    const text = messageText({ mimeType: "text/html", body: { data: b64(html) } }, 100);
    expect(text.startsWith("Game at 5:30 PM")).toBe(true);
    expect(text).not.toContain("<");
    expect(text.length).toBeLessThanOrEqual(100);
  });
});

describe("sorting what Cleo found", () => {
  const emails = [
    { id: "m1", category: "school", from: "Katy ISD <news@katyisd.org>", subject: "Field trip", date: "", text: "" },
    { id: "m2", category: "travel", from: "United <no-reply@united.com>", subject: "Your trip", date: "", text: "" },
    { id: "m3", category: "other", from: "Coach Sam <sam@gmail.com>", subject: "Practice", date: "", text: "" },
  ];
  const today = "2026-10-21";

  it("routes events and tasks, drops past and malformed ones, learns school senders only", () => {
    const r = routeExtraction({
      events: [
        { email: 0, title: "Zoo field trip", date: "2026-10-24", time: null, category: "school", child: "Emma" },
        { email: 1, title: "UA 123 Houston to Denver", date: "2026-11-02", time: "7:05 AM", category: "travel", child: null },
        { email: 1, title: "Old flight", date: "2026-10-01", time: null, category: "travel", child: null },
        { email: 9, title: "No such email", date: "2026-12-01", time: null, category: "other", child: null },
      ],
      tasks: [
        { email: 0, title: "Sign Emma's field trip form", dueDate: "2026-10-22", category: "school", child: "Emma" },
        { email: 2, title: "Bring orange slices", dueDate: "bad", category: "activities", child: null },
      ],
      receipts: [{ email: 1, merchant: "United", amount: 0, date: "2026-10-20", category: "transport" }],
    }, emails, { today, foundAt: 1 });
    expect(r.events.map((e) => e.title)).toEqual(["Zoo field trip", "UA 123 Houston to Denver"]);
    expect(r.events[0]).toMatchObject({ id: "gmail_m1_zoo_field_trip_2026-10-24", source: "gmail", child: "Emma", allDay: true });
    expect(r.events[1]).toMatchObject({ time: "7:05 AM", allDay: false });
    expect(r.tasks[0]).toMatchObject({ title: "Sign Emma's field trip form", dueDate: "2026-10-22", status: "pending", messageId: "m1", from: "Katy ISD" });
    expect(r.tasks[1].dueDate).toBeUndefined();
    expect(r.receipts).toEqual([]);
    expect(r.learnedDomains).toEqual(["katyisd.org"]); // gmail.com never learned
  });

  it("the extraction schema is accepted by the server request policy", () => {
    const built = buildUpstreamBody({ feature: "gmail_extract", system: "s", prompt: "p", schema: EXTRACT_SCHEMA });
    expect(built.error).toBeUndefined();
  });
});

describe("scanning a mailbox", () => {
  const msg = {
    payload: {
      mimeType: "text/plain", body: { data: b64("Picture day is Oct 30. Order forms due Oct 27.") },
      headers: [{ name: "From", value: "Lincoln Elementary <office@katyisd.org>" }, { name: "Subject", value: "Picture day" }, { name: "Date", value: "Mon, 20 Oct 2026" }],
    },
  };
  const answer = {
    events: [{ email: 0, title: "Picture day", date: "2026-10-30", time: null, category: "school", child: null }],
    tasks: [{ email: 0, title: "Send in picture day order form", dueDate: "2026-10-27", category: "school", child: null }],
    receipts: [],
  };
  function fakeFetch({ gmailStatus = 200 } = {}) {
    return vi.fn(async (url) => {
      if (url.includes("/messages?q=")) return { status: gmailStatus, json: async () => ({ messages: [{ id: "m1" }] }) };
      if (url.includes("/messages/m1")) return { status: 200, json: async () => msg };
      if (url.includes("anthropic.com")) return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 900, output_tokens: 120 } }) };
      throw new Error(`unexpected ${url}`);
    });
  }
  const aiCalls = (f) => f.mock.calls.filter(([u]) => u.includes("anthropic.com")).length;

  it("puts dates on the household calendar, to-dos in the inbox, and reads each email once", async () => {
    const db = fakeDb({ "users/bob/data/household_link": { primaryUid: "alice" }, "users/bob/data/profile": { kids: [{ name: "Emma" }] } });
    const f = fakeFetch();
    const r = await scanFamilyMail(db, { uid: "bob", accessToken: "t", today: "2026-10-21", fetchImpl: f, now: 5 });
    expect(r).toMatchObject({ scanned: 1, eventsAdded: 1, tasksFound: 1 });
    expect(db.store.get("users/alice/data/calendar_synced").events[0].title).toBe("Picture day");
    const inbox = db.store.get("users/bob/data/mail_inbox");
    expect(inbox.items[0]).toMatchObject({ title: "Send in picture day order form", status: "pending" });
    expect(inbox.processedIds).toEqual(["m1"]);
    expect(inbox.learnedDomains).toEqual(["katyisd.org"]);
    // the prompt carried the email body and the kids' names
    const sent = JSON.parse(f.mock.calls.find(([u]) => u.includes("anthropic.com"))[1].body);
    expect(sent.messages[0].content).toContain("Order forms due Oct 27");
    expect(sent.system[0].text).toContain("Emma");
    // the call counts against the household's pilot limit and cost report
    expect(db.store.get("ai_usage/" + new Date().toISOString().slice(0, 10) + "/households/alice").features.gmail_extract.calls).toBe(1);

    const again = await scanFamilyMail(db, { uid: "bob", accessToken: "t", today: "2026-10-21", fetchImpl: f });
    expect(again.scanned).toBe(0);
    expect(aiCalls(f)).toBe(1);
  });

  it("over the household limit: no AI call, and the email is tried again next time", async () => {
    vi.stubEnv("AI_HOUSEHOLD_DAILY_LIMIT", "1");
    const db = fakeDb({ [`ai_usage/${new Date().toISOString().slice(0, 10)}/households/u1`]: { calls: 1 } });
    const f = fakeFetch();
    const r = await scanFamilyMail(db, { uid: "u1", accessToken: "t", today: "2026-10-21", fetchImpl: f });
    vi.unstubAllEnvs();
    expect(r.error).toBe("daily_limit_reached");
    expect(aiCalls(f)).toBe(0);
    expect(db.store.get("users/u1/data/mail_inbox")).toBeUndefined();
  });

  it("an expired Google sign-in surfaces as reauth", async () => {
    const db = fakeDb();
    await expect(scanFamilyMail(db, { uid: "u1", accessToken: "t", today: "2026-10-21", fetchImpl: fakeFetch({ gmailStatus: 401 }) }))
      .rejects.toMatchObject({ reauth: true });
  });
});
