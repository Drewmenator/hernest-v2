// Runs the one-time people merge (see familyPeople.ts) against Firestore.
// Safe to call from any screen: it only writes when something was added, and
// marks the family doc so it never runs twice. Circle and Profile docs are
// only read, never written.
import { doc, getDoc } from "firebase/firestore";
import { db, saveData } from "./firebase";
import { isHouseholdCollection, getHouseholdId } from "./identity";
import { FLAGS } from "../config";
import { mergePeople, type Person } from "./familyPeople";
import type { FamilyMember } from "./store";

// Like loadData, but a failed read throws instead of looking like a missing
// doc — otherwise a network blip could be mistaken for "no family yet" and
// the merge would write a list without the existing members. Same household
// routing as firebase.ts (family and circle are shared with a partner).
async function readStrict(uid: string, col: string): Promise<Record<string, unknown> | null> {
  const owner = FLAGS.HOUSEHOLD_IDENTITY && isHouseholdCollection(col) ? (getHouseholdId() || uid) : uid;
  const snap = await getDoc(doc(db, "users", owner, "data", col));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
}

const inflight = new Map<string, Promise<Person[] | null>>();

export function ensurePeopleMerged(uid: string): Promise<Person[] | null> {
  const pending = inflight.get(uid);
  if (pending) return pending;
  const p = (async () => {
    try {
      const family = await readStrict(uid, "family");
      if (family?.peopleMergedAt) return null;
      const [circle, profile] = await Promise.all([readStrict(uid, "circle"), readStrict(uid, "profile")]);
      const { members, added, updated } = mergePeople(
        (family?.members as FamilyMember[]) || [],
        (circle?.contacts as never[]) || [],
        profile as never,
      );
      const data: Record<string, unknown> = { peopleMergedAt: Date.now() };
      if (added || updated) data.members = JSON.parse(JSON.stringify(members));
      await saveData(uid, "family", data);
      return added || updated ? members : null;
    } catch (e) {
      console.warn("[Family] people merge skipped (will retry next open):", e);
      return null;
    } finally {
      inflight.delete(uid);
    }
  })();
  inflight.set(uid, p);
  return p;
}
