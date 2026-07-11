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
  // Display-only mirror of the server's authoritative limit (api/claude.js
  // FREE_DAILY_AI_LIMIT, default 500). The server enforces; keep these in sync.
  FREE_LIMIT: 500,
  PRO_LIMIT: 100000,
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

  // ── Cleo v2 agent (Phase 2) ──
  // When true, Cleo chat runs a tool-use loop so she can take real actions
  // (add tasks, schedule events, complete tasks), not just answer. Falls back
  // to single-shot chat on any error. Disable via VITE_CLEO_AGENT="off".
  CLEO_AGENT:
    (((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CLEO_AGENT) as
      | string
      | undefined) !== "off",

  // ── Cleo streaming (perf / perceived speed) ──
  // When true, Cleo's reply streams token-by-token instead of arriving all at
  // once. Falls back to a normal call on any error. Disable via
  // VITE_CLEO_STREAMING="off".
  CLEO_STREAMING:
    (((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CLEO_STREAMING) as
      | string
      | undefined) !== "off",
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
