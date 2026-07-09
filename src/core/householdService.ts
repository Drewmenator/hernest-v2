// ─── HerNest Household Service ───────────────────────────────────
// Migration Step 1. Resolves + provisions the household for a signed-in user.
// Non-breaking: householdId === owner's uid, so existing data never moves.
//
// A joined partner already has users/{uid}/data/household_link (written by
// /api/invite/accept), pointing at the owner's uid — we reuse it as the resolver.

import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import { useStore, type HouseholdRole, type HouseholdMember } from "./store";
import { pullCloudEvents } from "./eventLog";

export interface Household {
  id: string; // === the owner's uid (stable, zero-migration)
  ownerUid: string;
  createdAt: number;
  name?: string;
}

// Resolve which household this user belongs to.
//   joined partner → household_link.primaryUid (the owner's uid)
//   everyone else  → their own uid (they own their household)
export async function resolveHouseholdId(
  uid: string,
): Promise<{ householdId: string; role: HouseholdRole }> {
  try {
    const link = await getDoc(doc(db, "users", uid, "data", "household_link"));
    if (link.exists()) {
      const primaryUid = link.data()?.primaryUid as string | undefined;
      if (primaryUid && primaryUid !== uid) {
        return { householdId: primaryUid, role: (link.data()?.role as HouseholdRole) || "partner" };
      }
    }
  } catch (e) {
    console.warn("[Household] resolve link failed (non-fatal):", e);
  }
  return { householdId: uid, role: "owner" };
}

// Ensure households/{id} and households/{id}/members/{uid} exist. Each user only
// ever writes their OWN member doc + the household doc — a clean security boundary
// for the Firestore rules that Step 5 will add.
export async function ensureHousehold(
  uid: string,
  householdId: string,
  role: HouseholdRole,
): Promise<void> {
  const s = useStore.getState();
  const displayName = s.user?.displayName || s.profile?.name || "Member";
  const email = s.user?.email || "";
  try {
    const hRef = doc(db, "households", householdId);
    if (!(await getDoc(hRef)).exists()) {
      const household: Household = { id: householdId, ownerUid: householdId, createdAt: Date.now() };
      await setDoc(hRef, household as unknown as Record<string, unknown>, { merge: true });
    }
    const mRef = doc(db, "households", householdId, "members", uid);
    if (!(await getDoc(mRef)).exists()) {
      const member: HouseholdMember = { uid, role, displayName, email, joinedAt: Date.now() };
      await setDoc(mRef, member as unknown as Record<string, unknown>, { merge: true });
    }
  } catch (e) {
    console.warn("[Household] ensure failed (non-fatal):", e);
  }
}

export async function getHouseholdMembers(householdId: string): Promise<HouseholdMember[]> {
  try {
    const snap = await getDocs(collection(db, "households", householdId, "members"));
    return snap.docs.map((d) => d.data() as HouseholdMember);
  } catch {
    return [];
  }
}

// Called once on sign-in. Resolves → provisions → populates the store.
export async function bootstrapHousehold(
  uid: string,
): Promise<{ householdId: string; role: HouseholdRole }> {
  const { householdId, role } = await resolveHouseholdId(uid);
  await ensureHousehold(uid, householdId, role);
  const members = await getHouseholdMembers(householdId);
  useStore.getState().setHousehold({ householdId, role, members });
  // Hydrate the shared event timeline for this device (migration Step 2)
  pullCloudEvents(householdId).catch(() => {});
  return { householdId, role };
}

// Accept a partner invite (client-side, when ?invite=token is present and the user
// is signed in). Delegates to the existing admin endpoint, which writes the
// household_link that resolveHouseholdId() reads on the next bootstrap.
export async function acceptInvite(token: string, _uid: string): Promise<boolean> {
  try {
    const { auth } = await import("./firebase");
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return false;
    const res = await fetch("/api/invite/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  } catch (e) {
    console.warn("[Household] acceptInvite failed:", e);
    return false;
  }
}
