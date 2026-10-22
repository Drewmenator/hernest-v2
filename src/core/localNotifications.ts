// ─── On-device wellness notifications ────────────────────────────────
// Wellness nudges (sedentary / high-stress evening) depend on live wearable
// data the server can't see, so they're delivered as LOCAL notifications from
// the device. Bill reminders are local too, so they land at a local morning
// hour (see billReminders.ts). Wellness does two things:
//   1. maybeScheduleWellnessNudge — evaluates pickNudge on app open and fires a
//      nudge (at most once per type per day) so it lands even after backgrounding.
//   2. ensureDailyCheckinReminder — a standing evening reminder to check in.
// No-op on web (the plugin only exists in the native shell).
import { pickNudge } from "./thriveCheckin";
import { readWearable } from "./wellnessAutoTrack";
import type { Bill } from "./bills";
import { planBillReminders, setBillFocus, FIRST_ID, MAX_REMINDERS } from "./billReminders";

function isNative(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

const NUDGE_ID = 1001;
const CHECKIN_ID = 2001;

// Check-only — never prompts. The single permission ask lives in
// pushNotifications.enablePush() (iOS shares one notification permission across
// push + local), so these on-app-open paths must not trigger a cold prompt.
async function hasPermission(LN: any): Promise<boolean> {
  try { return (await LN.checkPermissions()).display === "granted"; } catch { return false; }
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Fire a wellness nudge if one applies right now — capped at once per type per
// day (localStorage dedup). pickNudge already gates on the right hour windows.
export async function maybeScheduleWellnessNudge(uid: string): Promise<void> {
  if (!isNative()) return;
  try {
    const wearable = await readWearable(uid).catch(() => null);
    const nudge = pickNudge(wearable, 8, new Date().getHours());
    if (!nudge) return;
    const dedupKey = `hn_nudge_${nudge.id}_${todayKey()}`;
    if (localStorage.getItem(dedupKey)) return;

    const { LocalNotifications } = await import("@capacitor/local-notifications");
    if (!(await hasPermission(LocalNotifications))) return;
    await LocalNotifications.schedule({
      notifications: [{
        id: NUDGE_ID,
        title: "A gentle nudge",
        body: nudge.text,
        // A minute out so it still lands if the user backgrounds the app now.
        schedule: { at: new Date(Date.now() + 60 * 1000) },
        extra: { screen: "thrive" },
      }],
    });
    localStorage.setItem(dedupKey, "1");
  } catch (e) {
    console.warn("[LocalNotif] wellness nudge failed (non-fatal):", e);
  }
}

// Standing daily evening (19:00 local) reminder to log a check-in. Scheduled
// once per device; the plugin persists the repeating schedule.
export async function ensureDailyCheckinReminder(): Promise<void> {
  if (!isNative()) return;
  try {
    if (localStorage.getItem("hn_checkin_reminder_set")) return;
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    if (!(await hasPermission(LocalNotifications))) return;
    await LocalNotifications.schedule({
      notifications: [{
        id: CHECKIN_ID,
        title: "Evening check-in",
        body: "How did today feel? A quick check-in helps Cleo tune tomorrow.",
        schedule: { on: { hour: 19, minute: 0 }, repeats: true },
        extra: { screen: "thrive" },
      }],
    });
    localStorage.setItem("hn_checkin_reminder_set", "1");
  } catch (e) {
    console.warn("[LocalNotif] check-in reminder failed (non-fatal):", e);
  }
}

// ── Bill reminders ────────────────────────────────────────────────
// Replace this device's bill notifications with a fresh plan (billReminders.ts).
// Called whenever the bills change and once per launch, so a bill marked paid
// (here or, after the next launch, by a partner) stops reminding.
const BILL_ACTIONS = "BILL_DUE";

export async function syncBillReminders(bills: Bill[], uid: string): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    if (!(await hasPermission(LocalNotifications))) return;
    // "Paid" opens the app (foreground) so the write runs with the user signed
    // in and the household resolved; the bill is ticked off as it opens.
    await LocalNotifications.registerActionTypes({
      types: [{ id: BILL_ACTIONS, actions: [{ id: "paid", title: "Paid", foreground: true }] }],
    });
    await LocalNotifications.cancel({
      notifications: Array.from({ length: MAX_REMINDERS }, (_, i) => ({ id: FIRST_ID + i })),
    });
    const plan = planBillReminders(bills, new Date(), { uid });
    if (!plan.length) return;
    await LocalNotifications.schedule({
      notifications: plan.map(r => ({
        id: r.id,
        title: r.title,
        body: r.body,
        schedule: { at: r.at, allowWhileIdle: true },
        // Autopay notices are quiet: no sound (iOS plays none unless one is set).
        ...(r.kind === "autopay" ? {} : { sound: "default" }),
        ...(r.canMarkPaid ? { actionTypeId: BILL_ACTIONS } : {}),
        extra: { screen: "budget", billId: r.billId, due: r.due || "", kind: r.kind },
      })),
    });
  } catch (e) {
    console.warn("[LocalNotif] bill reminders failed (non-fatal):", e);
  }
}

// On launch: load the household's bills and refresh the plan. Skips when the
// bills doc can't be read, so a failed read never wipes good reminders.
export async function syncBillRemindersFromCloud(uid: string): Promise<void> {
  if (!isNative()) return;
  try {
    const { loadData } = await import("./firebase");
    const d = await loadData(uid, "bills");
    if (!d) return;
    await syncBillReminders(((d.bills as Bill[]) || []).filter(b => b && b.name), uid);
  } catch { /* non-fatal */ }
}

// Route a local-notification tap to the right tab (mirrors push handling).
export async function initLocalNotificationTaps(): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.addListener("localNotificationActionPerformed", (e: any) => {
      const extra = e?.notification?.extra || {};
      const tab = extra.screen;
      // Bill notifications: hand the bill (and a Paid tap) to the Bills screen.
      if (extra.billId) {
        setBillFocus({
          billId: String(extra.billId),
          due: extra.due || undefined,
          markPaid: e?.actionId === "paid",
          askDate: extra.kind === "askdate",
        });
      }
      if (tab) {
        import("./store").then((m: any) => {
          const st = m?.useStore?.getState?.();
          st?.setScreen?.("app");
          st?.setActiveTab?.(tab);
        }).catch(() => {});
      }
    });
  } catch { /* non-fatal */ }
}
