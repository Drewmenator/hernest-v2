// ─── Onboarding gate ───────────────────────────────────────────────
// Decides whether a signed-in user sees the guided Cleo setup. Getting this
// wrong in either direction is bad: a false "new" traps an existing user in
// setup; a false "onboarded" drops a brand-new user onto an empty Home.
// A user is onboarded if they finished setup (onboardedAt), skipped it
// (onboardingSkipped), or simply already have a profile name — every
// pre-existing user has a name, so the gate can never re-onboard them.
export function isOnboarded(profile: { onboardedAt?: unknown; name?: unknown; onboardingSkipped?: unknown } | null | undefined): boolean {
  if (!profile) return false;
  return !!(profile.onboardedAt || profile.onboardingSkipped || (typeof profile.name === "string" && profile.name.trim()));
}
