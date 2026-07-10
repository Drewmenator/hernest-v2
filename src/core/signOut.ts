// ─── Complete sign-out ─────────────────────────────────────────────
// Firebase signOut alone left Dexie caches, localStorage and sessionStorage
// behind — on a shared device the next account could see the previous
// user's cached briefing and chat. Clear everything, then reset the store.
import { signOut as fbSignOut } from "firebase/auth";
import { auth } from "./firebase";
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
  await fbSignOut(auth);
  useStore.getState().reset();
}
