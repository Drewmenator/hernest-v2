import { describe, it, expect, vi } from "vitest";
import type { Auth } from "firebase/auth";
import { appleCodeRevokeBody, revokeAppleSignIn, usesAppleSignIn } from "./appleRevoke";

const fakeAuth = (providers: string[]) =>
  ({ currentUser: { providerData: providers.map(providerId => ({ providerId })), getIdToken: vi.fn() } } as unknown as Auth);

describe("appleRevoke", () => {
  it("only applies to accounts that signed in with Apple", async () => {
    expect(usesAppleSignIn(fakeAuth(["google.com"]))).toBe(false);
    expect(usesAppleSignIn(fakeAuth(["apple.com"]))).toBe(true);
    expect(await revokeAppleSignIn(fakeAuth(["google.com"]), true)).toBe("not_apple");
  });

  it("builds the authorization-code revoke request", () => {
    expect(appleCodeRevokeBody("code123", "id456")).toEqual({
      providerId: "apple.com", tokenType: "CODE", token: "code123", idToken: "id456",
    });
  });
});
