import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("./firebase", () => ({ db: {}, auth: { currentUser: { getIdToken: async () => "tok" } }, loadData: vi.fn(), saveData: vi.fn() }));
vi.mock("./householdItems", () => ({ createItem: vi.fn() }));
import { autoScanMail, onMailUpdated } from "./mailInbox";

describe("autoScanMail", () => {
  beforeEach(() => { vi.useRealTimers(); localStorage.clear(); });

  it("scans at most every 2 hours and tells screens when mail came in", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ scanned: 2, eventsAdded: 1, tasksFound: 0, receiptsFound: 0 }) }));
    vi.stubGlobal("fetch", fetchMock);
    const heard = vi.fn();
    const stop = onMailUpdated(heard);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T15:00:00Z"));
    await autoScanMail();
    await autoScanMail(); // right away: skipped
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-22T17:01:00Z"));
    await autoScanMail();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
    vi.unstubAllGlobals();
  });
});
