import { describe, it, expect } from "vitest";
import { isOnboarded } from "./onboarding";

describe("isOnboarded — the onboarding gate", () => {
  it("brand-new user (no profile) → needs onboarding", () => {
    expect(isOnboarded(null)).toBe(false);
    expect(isOnboarded(undefined)).toBe(false);
    expect(isOnboarded({})).toBe(false);
  });

  it("finished setup (onboardedAt) → onboarded", () => {
    expect(isOnboarded({ onboardedAt: 1720000000000 })).toBe(true);
  });

  it("skipped setup → onboarded (never re-prompt)", () => {
    expect(isOnboarded({ onboardingSkipped: true })).toBe(true);
  });

  it("existing user with a name → onboarded (never trapped)", () => {
    expect(isOnboarded({ name: "Andrew" })).toBe(true);
  });

  it("a blank name does NOT count as onboarded", () => {
    expect(isOnboarded({ name: "   " })).toBe(false);
    expect(isOnboarded({ name: "" })).toBe(false);
  });
});
