// ─── HerNest V2 Config ───────────────────────────────────────────

export const APP = {
  NAME: "HerNest",
  VERSION: "2.0.0",
  URL: "https://hernest.app",
};

export const EMAILS = {
  PRIVACY: "privacy@hernest.app",
  HELLO: "hello@hernest.app",
};

export const AI = {
  HAIKU: "claude-haiku-4-5",
  SONNET: "claude-sonnet-4-5",
  FREE_LIMIT: 10,
  PRO_LIMIT: 1000,
};

export const FLAGS = {
  // ── Canonical context layer (migration Step 3) ──
  // "snapshot" = current 4-source path. "graph" = converged single source of truth.
  // Flip to "graph" only after the graph backfill lands. Override via VITE_CANONICAL_CONTEXT.
  CANONICAL_CONTEXT:
    (((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CANONICAL_CONTEXT) as
      | "graph"
      | "snapshot"
      | undefined) ?? "snapshot",

  // ── Multi-login households (migration Step 1) ──
  // When true, household-scoped collections resolve to the shared household namespace
  // so partners read/write the same data. Safe for solo users (householdId === uid).
  HOUSEHOLD_IDENTITY: true,
} as const;

export const ROUTES = {
  HOME: "/",
  NORA: "/cleo",
  PLAN: "/plan",
  BUDGET: "/budget",
  THRIVE: "/thrive",
  STYLE: "/style",
  TRIPS: "/trips",
  CIRCLE: "/circle",
  PROFILE: "/profile",
  BRIEFING: "/briefing",
  ONBOARDING: "/onboarding",
  LOGIN: "/login",
};
