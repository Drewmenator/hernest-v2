// ─── Push notifications (native iOS) ─────────────────────────────────
// Registers the device with Firebase Cloud Messaging, stores its FCM token
// under users/{uid}/devices/{token}, and routes taps back into the app. The
// backend sends to those tokens (see api/push.js). No-op on web — browser push
// isn't part of this build, and the plugin only exists in the native shell.
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "./firebase";

function isNative(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

// FCM tokens are safe Firestore doc ids (no slashes), but long — key devices by
// token so re-registering the same device updates in place instead of piling up.
async function storeToken(uid: string, token: string): Promise<void> {
  await setDoc(doc(db, "users", uid, "devices", token), {
    token,
    platform: "ios",
    updatedAt: Date.now(),
  }, { merge: true });
}

let registered = false;

// Call once after sign-in. Requests permission, gets the FCM token, persists it,
// and wires listeners for token refresh + notification taps.
//
// Called after sign-in — but does NOT prompt for permission (Apple's guidance
// is to ask in context, not on first launch). It only completes registration
// if the user has ALREADY granted permission. Use enablePush() for the ask.
export async function registerPush(uid: string): Promise<void> {
  if (!isNative() || registered) return;
  try {
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    const perm = await FirebaseMessaging.checkPermissions().catch(() => null);
    if (perm?.receive === "granted") await completeRegistration(uid, FirebaseMessaging);
  } catch (e) {
    console.warn("[Push] check failed (non-fatal):", e);
  }
}

// The explicit opt-in: prompt for permission (from a Settings toggle or a
// contextual soft-ask), then register. Returns whether push is now enabled.
export async function enablePush(uid: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    const perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== "granted") return false;
    await completeRegistration(uid, FirebaseMessaging);
    return true;
  } catch (e) {
    console.warn("[Push] enable failed (non-fatal):", e);
    return false;
  }
}

// Shared registration once permission is confirmed granted. No prompting here.
async function completeRegistration(uid: string, FirebaseMessaging: any): Promise<void> {
  if (registered) return;
  registered = true;
  try {
    const { token } = await FirebaseMessaging.getToken();
    if (token) await storeToken(uid, token);

    await FirebaseMessaging.addListener("tokenReceived", (e: any) => {
      if (e?.token) storeToken(uid, e.token).catch(() => {});
    });

    // On-device wellness notifications: standing evening check-in reminder +
    // tap routing (permission is already granted, so these won't prompt).
    import("./localNotifications").then(l => {
      l.ensureDailyCheckinReminder();
      l.initLocalNotificationTaps();
    }).catch(() => {});

    await FirebaseMessaging.addListener("notificationActionPerformed", (e: any) => {
      const tab = e?.notification?.data?.screen;
      if (tab) {
        import("./store").then((m: any) => {
          const st = m?.useStore?.getState?.();
          st?.setScreen?.("app");
          st?.setActiveTab?.(tab);
        }).catch(() => {});
      }
    });
  } catch (e) {
    registered = false;
    console.warn("[Push] registration failed (non-fatal):", e);
  }
}

// Ask the backend to send a test push to this user's devices. Returns how many
// were reached — used by the Settings "Send test notification" button to verify
// the whole APNs → FCM → device chain end-to-end.
export async function sendTestPush(action: "test" | "briefing" = "test"): Promise<{ sent: number } | null> {
  try {
    const { auth } = await import("./firebase");
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return null;
    const res = await fetch(`/api/push?action=${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Notify the other members of this household that the current user did something
// (added a task, planned a trip…). Best-effort, fire-and-forget. Not gated on
// platform — the actor may be on web while a partner is on the native app.
export async function notifyHousehold(summary: string, screen = "home"): Promise<void> {
  try {
    const { auth } = await import("./firebase");
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;
    await fetch("/api/push?action=household", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ summary, screen }),
    });
  } catch { /* best-effort */ }
}

// On full sign-out, drop this device's token so it stops receiving pushes.
export async function unregisterPush(uid: string): Promise<void> {
  if (!isNative()) return;
  try {
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    const { token } = await FirebaseMessaging.getToken().catch(() => ({ token: null as any }));
    if (token) await deleteDoc(doc(db, "users", uid, "devices", token)).catch(() => {});
    await FirebaseMessaging.removeAllListeners();
  } catch { /* non-fatal */ }
  registered = false;
}
