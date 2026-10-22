// ─── HerNest Analytics (PostHog) ─────────────────────────────────
// Off unless VITE_POSTHOG_KEY is set. Privacy-first for a family/health app:
// no autocapture, no session recording, no names or emails — only the named
// events the app sends (trackEvent) and screen names. Loaded lazily so it adds
// nothing to startup when switched off.
type PostHog = typeof import("posthog-js").default;

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://us.i.posthog.com";

let client: Promise<PostHog | null> | null = null;

function ph(): Promise<PostHog | null> {
  if (!KEY) return Promise.resolve(null);
  if (!client) {
    client = import("posthog-js").then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        person_profiles: "identified_only",
        persistence: "localStorage",
      });
      return posthog;
    }).catch(() => null);
  }
  return client;
}

export function initAnalytics() { void ph(); }

// Only the uid (never name, email or health/financial data).
export async function identifyUser(uid: string) {
  (await ph())?.identify(uid);
}

export async function trackEvent(event: string, properties?: Record<string, unknown>) {
  (await ph())?.capture(event, properties);
}

export async function trackScreen(screen: string) {
  (await ph())?.capture("screen_viewed", { screen });
}

export async function resetAnalytics() {
  (await ph())?.reset();
}
