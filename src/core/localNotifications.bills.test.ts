import { describe, it, expect, vi, beforeEach } from "vitest";

const LN = {
  checkPermissions: vi.fn(async () => ({ display: "granted" })),
  registerActionTypes: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  schedule: vi.fn(async () => {}),
};
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: LN }));
vi.mock("./thriveCheckin", () => ({ pickNudge: vi.fn() }));
vi.mock("./wellnessAutoTrack", () => ({ readWearable: vi.fn() }));
vi.mock("./billReminders", () => ({
  FIRST_ID: 30000, MAX_REMINDERS: 2, setBillFocus: vi.fn(),
  planBillReminders: (bills: { id: string; name: string }[]) =>
    bills.map((b, i) => ({ id: 30000 + i, at: new Date(Date.now() + 86400000), kind: "before", billId: b.id, title: b.name, body: "", canMarkPaid: true })),
}));

let onBills: ((items: unknown[]) => void) | null = null;
const stopItems = vi.fn();
const subscribeItems = vi.fn((_uid: string, _kind: string, cb: (items: unknown[]) => void) => { onBills = cb; return stopItems; });
vi.mock("./householdItems", () => ({ subscribeItems }));

const flush = () => new Promise(r => setTimeout(r, 0));
const scheduledTitles = () => LN.schedule.mock.calls.map(c => (c as unknown as [{ notifications: { title: string }[] }])[0].notifications.map(n => n.title));

describe("watchBillReminders", () => {
  beforeEach(() => {
    (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true };
  });

  it("rebuilds bill reminders on each change, once per sign-in", async () => {
    const { watchBillReminders } = await import("./localNotifications");
    await Promise.all([watchBillReminders("u1"), watchBillReminders("u1")]);
    expect(subscribeItems).toHaveBeenCalledTimes(1);
    expect(subscribeItems).toHaveBeenCalledWith("u1", "bills", expect.any(Function));

    onBills!([{ id: "a", name: "Rent" }, { id: "b", name: "Power" }]);
    await flush(); await flush();
    // Partner marks Power paid and it drops out of the list.
    onBills!([{ id: "a", name: "Rent" }]);
    await flush(); await flush();

    expect(LN.cancel).toHaveBeenCalledTimes(2);
    expect(scheduledTitles()).toEqual([["Rent", "Power"], ["Rent"]]);
  });

  it("rebuilds on resume only after the gap", async () => {
    const { watchBillReminders } = await import("./localNotifications");
    await watchBillReminders("u1");
    const before = LN.schedule.mock.calls.length;
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await flush(); await flush();
    expect(LN.schedule.mock.calls.length).toBe(before);   // synced moments ago

    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      await flush(); await flush();
    } finally { Date.now = realNow; }
    expect(LN.schedule.mock.calls.length).toBe(before + 1);
  });

  it("stops the old watcher when someone else signs in", async () => {
    const { watchBillReminders } = await import("./localNotifications");
    await watchBillReminders("u2");
    expect(stopItems).toHaveBeenCalled();
    expect(subscribeItems).toHaveBeenLastCalledWith("u2", "bills", expect.any(Function));
  });
});
