// ─── HerNest Analytics — PostHog (lazy loaded) ──────────────────
const key  = import.meta.env.VITE_POSTHOG_KEY;
const host = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

let _ph: any = null;

async function getPostHog() {
  if (!key) return null;
  if (_ph) return _ph;
  const { default: posthog } = await import("posthog-js");
  // posthog.init(key, {
    api_host: host,
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: false,
  });
  _ph = posthog;
  return _ph;
}

export function initAnalytics() {
  // Lazy init after 3 seconds — don't block app load
  setTimeout(() => getPostHog(), 3000);
}

export async function identifyUser(uid: string, traits?: Record<string, unknown>) {
  const ph = await getPostHog();
  ph?.identify(uid, traits);
}

export async function trackEvent(event: string, properties?: Record<string, unknown>) {
  const ph = await getPostHog();
  ph?.capture(event, properties);
}

export async function trackScreen(screen: string) {
  const ph = await getPostHog();
  ph?.capture("$pageview", { screen, path: `/${screen}` });
}

export async function resetAnalytics() {
  const ph = await getPostHog();
  ph?.reset();
}
