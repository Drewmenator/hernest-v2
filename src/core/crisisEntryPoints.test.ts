// Every place a person's own words reach the AI runs the same crisis check
// first and shows the same helplines, without calling the AI.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./firebase", () => ({
  auth: { currentUser: { getIdToken: vi.fn(async () => "id-token") } },
  loadData: vi.fn(async () => null),
  saveData: vi.fn(async () => {}),
}));
vi.mock("./events", () => ({ bus: { publish: vi.fn(async () => {}) } }));
vi.mock("../shared/utils/money", () => ({ getCurrency: () => "USD" }));

import { ai } from "./ai";
import { CRISIS_EVENT, crisisResponse } from "./crisis";
import { extractSchoolEvents } from "./schoolNewsletterService";
import { billsFromText } from "../modules/bills/billReader";
import { runCleoAgent, runCleoAgentStreaming } from "./cleoAgent";

const DISTRESS = "honestly I can't go on like this, I want to die";
let fetchSpy: ReturnType<typeof vi.fn>;
let sheets: string[];
const onCrisis = (e: Event) => sheets.push((e as CustomEvent<{ text: string }>).detail.text);

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  sheets = [];
  window.addEventListener(CRISIS_EVENT, onCrisis);
});
afterEach(() => {
  window.removeEventListener(CRISIS_EVENT, onCrisis);
  vi.unstubAllGlobals();
});

function expectCrisisSheetWithUsLines() {
  expect(sheets).toHaveLength(1);
  expect(sheets[0]).toBe(crisisResponse());
  expect(sheets[0]).toContain("988 Suicide and Crisis Lifeline");
  expect(sheets[0]).toContain("Text 988");
  expect(sheets[0]).toContain("911");
}

describe("crisis check on every AI entry point", () => {
  it("ai() with the person's text: no AI call, crisis sheet, crisis_detected", async () => {
    const res = await ai("sys", "Trip to somewhere", "trip_planner", [], { userText: DISTRESS });
    expect(res.error && res.code).toBe("crisis_detected");
    expect(fetchSpy).not.toHaveBeenCalled();
    expectCrisisSheetWithUsLines();
  });

  it("School newsletter paste", async () => {
    const res = await extractSchoolEvents("u1", `Field trip Friday.\n${DISTRESS}`);
    expect(res.error).toBe("crisis_detected");
    expect(fetchSpy).not.toHaveBeenCalled();
    expectCrisisSheetWithUsLines();
  });

  it("Bills typed line", async () => {
    const res = await billsFromText("I want to end it all, rent is due on the 1st", []);
    expect(res.error).toBe("crisis_detected");
    expect(fetchSpy).not.toHaveBeenCalled();
    expectCrisisSheetWithUsLines();
  });

  it("ordinary text still goes to the AI", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "{\"bills\":[]}" }] }) });
    await billsFromText("Netflix 15.49 on the 12th", []);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sheets).toHaveLength(0);
  });

  it("server backstop: a crisis reply opens the sheet for typed text, stays quiet otherwise", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ crisis: true }) });
    const typed = await ai("sys", "hello", "bill_parse", [], { userText: "hello" });
    expect(typed.error && typed.code).toBe("crisis_detected");
    expect(sheets).toHaveLength(1);
    // e.g. background memory extraction: no surprise sheet
    const background = await ai("sys", "Extract facts", "cleo_chat");
    expect(background.error && background.code).toBe("crisis_detected");
    expect(sheets).toHaveLength(1);
  });

  it("Cleo agent (plain and streaming) stops on the server's crisis reply", async () => {
    const json = { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ crisis: true }) };
    fetchSpy.mockResolvedValue(json);
    const msgs = [{ role: "user" as const, content: "hi" }];
    await expect(runCleoAgent({ uid: "u1", system: "s", messages: msgs })).rejects.toThrow("crisis_detected");
    await expect(runCleoAgentStreaming({ uid: "u1", system: "s", messages: msgs, onToken: () => {} })).rejects.toThrow("crisis_detected");
  });

  it("limit replies carry the server's friendly message to the app", async () => {
    const seen: unknown[] = [];
    const onLimit = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("hn_limit_reached", onLimit);
    fetchSpy.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "burst_limit_reached", message: "Give Cleo a minute." }) });
    const res = await ai("sys", "hi", "cleo_chat");
    window.removeEventListener("hn_limit_reached", onLimit);
    expect(res.error && res.code).toBe("burst_limit_reached");
    expect(seen).toEqual([{ code: "burst_limit_reached", message: "Give Cleo a minute." }]);
  });
});
