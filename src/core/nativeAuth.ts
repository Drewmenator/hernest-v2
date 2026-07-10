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

export async function signInWithGoogle(): Promise<void> {
  if (!isNative()) {
    await signInWithPopup(auth, googleProvider);
    return;
  }

  // Native path — loaded dynamically so the web bundle never pulls the plugin.
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  if (!idToken) {
    // No token means the user cancelled or the handshake failed before issuing
    // one — surface as a normal failure so the caller shows its retry copy.
    throw new Error("native-google-signin-no-token");
  }
  const credential = GoogleAuthProvider.credential(idToken);
  await signInWithCredential(auth, credential);
}
