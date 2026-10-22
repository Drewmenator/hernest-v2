// ─── Motion helpers ────────────────────────────────────────────────
// One scroll listener for the whole app, read once per frame, so headers
// and cards can respond to scrolling without slowing it down. Everything
// here moves things with transform and opacity only.
import { useEffect, useLayoutEffect, useRef } from "react";
import { haptic } from "./haptics";

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

// ── Scroll, once per frame ─────────────────────────────────────────
type ScrollFn = (y: number) => void;
const scrollSubs = new Set<ScrollFn>();
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const y = window.scrollY;
    scrollSubs.forEach(fn => fn(y));
  });
}
export function onScrollFrame(fn: ScrollFn): () => void {
  if (!scrollSubs.size) window.addEventListener("scroll", onScroll, { passive: true });
  scrollSubs.add(fn);
  fn(window.scrollY);
  return () => {
    scrollSubs.delete(fn);
    if (!scrollSubs.size) window.removeEventListener("scroll", onScroll);
  };
}

// ── Reveal ─────────────────────────────────────────────────────────
// Cards already on screen show at once (the screen has its own fade).
// Cards further down start slightly lower and transparent, then settle
// into place the first time they scroll into view.
let io: IntersectionObserver | null = null;
function observer(): IntersectionObserver | null {
  if (io || typeof IntersectionObserver === "undefined") return io;
  io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("is-in");
      io!.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.01 });
  return io;
}

export function useReveal<E extends HTMLElement>(enabled = true) {
  const ref = useRef<E>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const obs = observer();
    if (!enabled || !el || !obs || prefersReducedMotion()) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already visible
    el.classList.add("hn-reveal");
    obs.observe(el);
    return () => obs.unobserve(el);
  }, [enabled]);
  return ref;
}

// ── Pull to refresh ────────────────────────────────────────────────
// Pull down from the top of the page past the line and let go to reload.
// The indicator is moved directly (no re-render while the finger moves).
// iOS keeps its own rubber-band bounce; this only listens.
export const PULL_TRIGGER = 72;

export function usePullToRefresh(onRefresh: () => Promise<unknown> | void) {
  const indicator = useRef<HTMLDivElement>(null);
  const cb = useRef(onRefresh);
  useEffect(() => { cb.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    let startY: number | null = null;
    let pull = 0;
    let busy = false;
    const paint = (p: number, spinning = false) => {
      const el = indicator.current;
      if (!el) return;
      const t = Math.min(p / PULL_TRIGGER, 1);
      el.style.opacity = String(spinning ? 1 : t);
      el.style.transform = `translate3d(-50%, ${spinning ? 18 : Math.min(p * 0.45, 40) - 24}px, 0) scale(${0.6 + t * 0.4})`;
      const icon = el.firstElementChild as HTMLElement | null;
      if (icon) {
        icon.style.animation = spinning && !prefersReducedMotion() ? "hnSpinSoft 0.9s linear infinite" : "none";
        if (!spinning) icon.style.transform = `rotate(${p * 3}deg)`;
      }
    };
    const start = (e: TouchEvent) => {
      if (busy || window.scrollY > 0 || e.touches.length !== 1) { startY = null; return; }
      startY = e.touches[0].clientY;
      pull = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY == null) return;
      pull = Math.max(0, e.touches[0].clientY - startY);
      if (window.scrollY > 0 && pull === 0) { startY = null; return; }
      paint(pull);
    };
    const end = async () => {
      if (startY == null) return;
      startY = null;
      if (pull < PULL_TRIGGER) { paint(0); return; }
      busy = true;
      haptic("pull");
      paint(PULL_TRIGGER, true);
      try { await cb.current(); } catch { /* the screen shows its own error */ }
      busy = false;
      paint(0);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);
  return indicator;
}
