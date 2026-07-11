import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'

// Native API base: in the Capacitor shell the app is served from
// capacitor://localhost, so relative "/api/..." fetches have no server to hit.
// Rewrite them to the deployed backend. Web builds keep same-origin "/api".
// (VITE_API_BASE overrides the default if the deployment URL ever changes.)
if ((window as any).Capacitor?.isNativePlatform?.()) {
  const API_BASE = (import.meta.env.VITE_API_BASE as string) || "https://hernest-v2.vercel.app";
  const origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/api")) {
      return origFetch(API_BASE + input, init);
    }
    if (input instanceof Request && input.url.startsWith("/api")) {
      return origFetch(new Request(API_BASE + input.url, input), init);
    }
    return origFetch(input as any, init);
  };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// PWA: register service worker (production only — HMR conflicts in dev)
if ("serviceWorker" in navigator && import.meta.env.PROD && !(window as any).Capacitor?.isNativePlatform?.()) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("[SW] registration failed:", e));
  });
}

// Error monitoring: lazy-loaded only when a DSN is configured, so it adds
// zero bytes to the bundle until VITE_SENTRY_DSN is set in Vercel.
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      tracesSampleRate: 0.1,
      // Household data is sensitive — never send user input or breadcrumbs
      // containing form values.
      beforeSend(event) {
        if (event.request?.data) delete event.request.data;
        return event;
      },
    });
  }).catch((e) => console.warn("[Monitoring] init failed:", e));
}
