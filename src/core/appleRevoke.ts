// ─── Sign in with Apple: cut-off on account deletion ────────────────
// Apple requires apps that offer Sign in with Apple to revoke the user's Apple
// tokens when they delete their account. Firebase does the revoke for us using
// the Apple key configured in the Firebase console (Authentication → Apple →
// OAuth code flow configuration); we only have to hand it a fresh token from
// Apple, which means showing the Apple sheet once more.
//
// Web: Firebase's revokeAccessToken() with the access token from a popup.
// Native: the Capacitor plugin returns an authorization CODE, which the JS
// SDK's revokeAccessToken() can't send (it hardcodes ACCESS_TOKEN), so we call
// the same Identity Toolkit endpoint the iOS SDK uses, with tokenType CODE.
import { OAuthProvider, revokeAccessToken, signInWithPopup, type Auth } from "firebase/auth";

export type AppleRevokeResult = "not_apple" | "revoked" | "cancelled" | "failed";

export function usesAppleSignIn(auth: Auth): boolean {
  return !!auth.currentUser?.providerData.some(p => p.providerId === "apple.com");
}

// The request body for Identity Toolkit's accounts:revokeToken with an Apple
// authorization code.
export function appleCodeRevokeBody(authorizationCode: string, idToken: string) {
  return { providerId: "apple.com", tokenType: "CODE", token: authorizationCode, idToken };
}

function isCancel(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "auth/popup-closed-by-user" || err?.code === "1001" || /cancel/i.test(err?.message || "");
}

export async function revokeAppleSignIn(auth: Auth, isNative: boolean): Promise<AppleRevokeResult> {
  if (!usesAppleSignIn(auth) || !auth.currentUser) return "not_apple";
  try {
    if (!isNative) {
      const result = await signInWithPopup(auth, new OAuthProvider("apple.com"));
      const accessToken = OAuthProvider.credentialFromResult(result)?.accessToken;
      if (!accessToken) return "failed";
      await revokeAccessToken(auth, accessToken);
      return "revoked";
    }

    const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
    const result = await FirebaseAuthentication.signInWithApple();
    const code = result.credential?.authorizationCode;
    if (!code) return "failed";
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=${encodeURIComponent(auth.app.options.apiKey || "")}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(appleCodeRevokeBody(code, idToken)) },
    );
    if (!res.ok) {
      console.error("[AppleRevoke] revoke failed:", res.status, await res.text().catch(() => ""));
      return "failed";
    }
    return "revoked";
  } catch (e) {
    if (isCancel(e)) return "cancelled";
    console.error("[AppleRevoke] error:", e);
    return "failed";
  }
}
