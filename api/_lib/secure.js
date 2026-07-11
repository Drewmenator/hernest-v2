// ─── Shared API security helpers ──────────────────────────────────
// CORS whitelist, Firebase token verification, AES-256-GCM secrets.
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
export { encryptSecret, decryptSecret } from "./cryptoUtil.js";

if (!getApps().length) {
  initializeApp({ credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  })});
}

export const adminDb = getFirestore();
export const adminAuth = getAuth();

// ── CORS ───────────────────────────────────────────────────────────
// capacitor://localhost (iOS) and https://localhost (Android) are the native
// Capacitor shell's origin — the app calls this API cross-origin from there.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  "https://hernest-v2.vercel.app,http://localhost:5173,http://localhost:5174,capacitor://localhost,https://localhost"
).split(",").map(o => o.trim());

export function applyCors(req, res, methods = "GET, POST, OPTIONS") {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(200).end(); return true; }
  return false;
}

// ── Auth: verify Firebase idToken, return uid or null ──────────────
export async function verifyAuth(req) {
  const idToken = req.headers["authorization"]?.split("Bearer ")[1];
  if (!idToken) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    return null;
  }
}

