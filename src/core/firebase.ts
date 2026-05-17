/// <reference types="vite/client" />
// ─── Firebase Config ─────────────────────────────────────────────
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs } from "firebase/firestore";

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

// ── Data Helpers ──────────────────────────────────────────────────
// Strip undefined values recursively — Firestore rejects undefined
function stripUndefined(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    );
  }
  return obj;
}

export async function saveData(
  uid: string,
  collection: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const clean = stripUndefined(data) as Record<string, unknown>;
    await setDoc(doc(db, "users", uid, "data", collection), clean, { merge: true });
  } catch (e) {
    console.error(`[Firebase] saveData failed: ${collection}`, e);
  }
}

export async function loadData(
  uid: string,
  col: string
): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getDoc(doc(db, "users", uid, "data", col));
    return snap.exists() ? snap.data() as Record<string, unknown> : null;
  } catch (e) {
    console.error(`[Firebase] loadData failed: ${col}`, e);
    return null;
  }
}
