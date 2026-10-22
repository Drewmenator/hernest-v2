// ─── Complete sign-out ─────────────────────────────────────────────
// Firebase signOut alone left Dexie caches, localStorage and sessionStorage
// behind — on a shared device the next account could see the previous
// user's cached briefing and chat. Clear everything, then reset the store.
import { signOut as fbSignOut } from "firebase/auth";
import { terminate, clearIndexedDbPersistence } from "firebase/firestore";
import { auth, db as firestore } from "./firebase";
import { db } from "./db";
import { useStore } from "./store";

export async function signOutCompletely(): Promise<void> {
  try { await db.clearAllLocal(); } catch (e) { console.warn("[SignOut] local clear failed:", e); }
  try {
    // Keys we own; leave third-party (firebase) persistence to fbSignOut
    localStorage.removeItem("hn_getstarted_done");
    localStorage.removeItem("hn_last_uid");
    sessionStorage.clear();
  } catch { /* storage unavailable */ }
  // After account deletion the login is already gone and this can throw;
  // the local clean-up below must still happen.
  try { await fbSignOut(auth); } catch (e) { console.warn("[SignOut] sign-out failed:", e); }
  useStore.getState().reset();
  await import("./analytics").then(a => a.resetAnalytics()).catch(() => {});
  // Wipe the offline copy of this user's data from the device, then restart
  // the app fresh (a terminated Firestore can't be reused in this page).
  try {
    await terminate(firestore);
    await clearIndexedDbPersistence(firestore);
  } catch (e) { console.warn("[SignOut] offline cache clear failed:", e); }
  window.location.reload();
}
