// ─── On-device wellness notifications ────────────────────────────────
// Wellness nudges (sedentary / high-stress evening) depend on live wearable
// data the server can't see, so they're delivered as LOCAL notifications from
// the device. Two things:
//   1. maybeScheduleWellnessNudge — evaluates pickNudge on app open and fires a
//      nudge (at most once per type per day) so it lands even after backgrounding.
//   2. ensureDailyCheckinReminder — a standing evening reminder to check in.
// No-op on web (the plugin only exists in the native shell).
import { pickNudge } from "./thriveCheckin";
import { readWearable } from "./wellnessAutoTrack";

function isNative(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

const NUDGE_ID = 1001;
const CHECKIN_ID = 2001;

async function ensurePermission(LN: any): Promise<boolean> {
  try {
    const p = await LN.checkPermissions();
    if (p.display === "granted") return true;
    const r = await LN.requestPermissions();
    return r.display === "granted";
  } catch { return false; }
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
    if (!(await ensurePermission(LocalNotifications))) return;
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
    if (!(await ensurePermission(LocalNotifications))) return;
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

// Route a local-notification tap to the right tab (mirrors push handling).
export async function initLocalNotificationTaps(): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.addListener("localNotificationActionPerformed", (e: any) => {
      const tab = e?.notification?.extra?.screen;
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
