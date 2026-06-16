/// <reference types="vite/client" />
// ─── Firebase Config ─────────────────────────────────────────────
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { isHouseholdCollection, getHouseholdId } from "./identity";
import { FLAGS } from "../config";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// ── Household scoping (migration Step 1) ──────────────────────────
// Household-scoped collections resolve to the shared household namespace
// (the owner's uid); everything else stays personal to the signed-in user.
// For solo users getHouseholdId() === uid, so this is a no-op for them.
function ownerFor(uid: string, collection: string): string {
  if (!FLAGS.HOUSEHOLD_IDENTITY) return uid;
  if (!isHouseholdCollection(collection)) return uid;
  return getHouseholdId() || uid;
}

// ── Data Helpers ──────────────────────────────────────────────────
export async function saveData(
  uid: string,
  collection: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await setDoc(doc(db, "users", ownerFor(uid, collection), "data", collection), data, { merge: true });
  } catch (e) {
    console.error(`[Firebase] saveData failed: ${collection}`, e);
  }
}

export async function loadData(
  uid: string,
  col: string
): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getDoc(doc(db, "users", ownerFor(uid, col), "data", col));
    return snap.exists() ? snap.data() as Record<string, unknown> : null;
  } catch (e) {
    console.error(`[Firebase] loadData failed: ${col}`, e);
    return null;
  }
}
