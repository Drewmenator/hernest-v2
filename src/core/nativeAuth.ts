// ─── Platform-aware Google Sign-In ───────────────────────────────────
// Web uses Firebase's signInWithPopup. That flow can't run inside the native
// iOS shell — Google blocks OAuth in embedded webviews (disallowed_useragent).
// On native we run the Google handshake through the Capacitor plugin, then
// exchange the returned ID token for a Firebase credential on the SAME JS auth
// instance the rest of the app observes. So auth state, listeners, and the
// onboarding gate all behave identically to web — only the first hop differs.
import { GoogleAuthProvider, signInWithPopup, signInWithCredential } from "firebase/auth";
import { auth, googleProvider } from "./firebase";

function isNative(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

// Wrap a promise so a silent hang becomes a visible, timed-out error instead of
// leaving the user staring at a spinner forever.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout:${label}`)), ms)),
  ]);
}

// onStatus surfaces each step to the UI so on-device failures are diagnosable
// without a debugger — the login screen shows the last status reached.
export async function signInWithGoogle(onStatus?: (s: string) => void): Promise<void> {
  if (!isNative()) {
    await signInWithPopup(auth, googleProvider);
    return;
  }

  onStatus?.("opening Google…");
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  const result = await withTimeout(FirebaseAuthentication.signInWithGoogle(), 60_000, "google");

  onStatus?.("got token, verifying…");
  const idToken = result.credential?.idToken;
  if (!idToken) throw new Error("no-idtoken");

  const credential = GoogleAuthProvider.credential(idToken);
  await withTimeout(signInWithCredential(auth, credential), 30_000, "firebase");
  onStatus?.("signed in ✓");
}
