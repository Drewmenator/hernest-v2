// ─── Never wait forever ────────────────────────────────────────────
// A network call that never answers (Firestore long-polling in the iOS
// WebView, a request cut off when the phone sleeps) must not leave a
// screen spinning. withTimeout settles after `ms` with the fallback.
export const TIMED_OUT = Symbol("timed_out");

export function withTimeout<T, F = typeof TIMED_OUT>(p: Promise<T>, ms: number, fallback?: F): Promise<T | F> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve((fallback === undefined ? TIMED_OUT : fallback) as F), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve((fallback === undefined ? TIMED_OUT : fallback) as F); });
  });
}

// An abort signal that fires after `ms` (for fetch). Uses the browser's
// AbortSignal.timeout when present, a timer otherwise (older iOS).
export function timeoutSignal(ms: number): AbortSignal {
  const native = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  if (typeof native === "function") return native.call(AbortSignal, ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}
