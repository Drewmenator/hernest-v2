// ─── Atmosphere: Wisteria with depth ──────────────────────────────
// Layered cards whose color says which part of life they're about
// (Cleo lavender, household and money sage, personal blush, plan blue),
// one big number per card, a short serif headline in plain words, and a
// small picture of the data. Plus the large page title that shrinks into
// a frosted bar as you scroll, and the pull-to-refresh sparkle.
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { T, F, R, S, TYPE, ATMOS, ATMOS_TEXT2 } from "../../config/theme";
import { SparkleIcon } from "./Icons";
import { onScrollFrame, prefersReducedMotion, useReveal, usePullToRefresh } from "../motion";

export type AtmosTint = keyof typeof ATMOS;

// ── GlowCard ──────────────────────────────────────────────────────
// The atmospheric card. Pass onClick to make the whole card a button.
export function GlowCard({ tint, eyebrow, children, onClick, ariaLabel, ariaExpanded, style, as = "section", reveal = true, grain }: {
  tint: AtmosTint;
  grain?: boolean;             // fine paper grain (Cleo's hero only)
  eyebrow?: React.ReactNode;
  children?: React.ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  style?: React.CSSProperties;
  as?: "section" | "div";
  reveal?: boolean;
}) {
  const a = ATMOS[tint];
  const ref = useReveal<HTMLElement>(reveal);
  const box: React.CSSProperties = {
    position: "relative", display: "block", width: "100%", textAlign: "left",
    background: a.base, borderRadius: R.card + 6, padding: S.xl, marginBottom: S.md,
    boxShadow: a.shadow, border: "1px solid rgba(255,255,255,.55)", overflow: "hidden",
    color: T.text, fontFamily: F.sans, ...style,
  };
  const head = eyebrow && (
    <p style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 700, color: a.ink, margin: "0 0 10px", letterSpacing: 0.1 }}>
      {tint === "cleo" && <SparkleIcon size={15} color={a.ink} filled />}
      {eyebrow}
    </p>
  );
  if (onClick) {
    return (
      <button ref={ref as React.Ref<HTMLButtonElement>} onClick={onClick} aria-label={ariaLabel} aria-expanded={ariaExpanded}
        className={grain ? "hn-press hn-grain" : "hn-press"} style={{ ...box, cursor: "pointer", touchAction: "manipulation" }}>
        {head}{children}
      </button>
    );
  }
  const Tag = as;
  return <Tag ref={ref as React.Ref<HTMLElement & HTMLDivElement>} aria-label={ariaLabel} className={grain ? "hn-grain" : undefined} style={box}>{head}{children}</Tag>;
}

// ── HeroNumber ────────────────────────────────────────────────────
// The one number a card is about, with an optional unit and a label.
export function HeroNumber({ value, unit, label, color = T.text, size = 52 }: {
  value: React.ReactNode;
  unit?: string;
  label?: React.ReactNode;
  color?: string;
  size?: number;
}) {
  return (
    <div>
      <p style={{ display: "flex", alignItems: "baseline", gap: 6, margin: 0, fontFamily: F.sans, color, lineHeight: 1 }}>
        <span style={{ fontSize: size, fontWeight: 800, letterSpacing: "-0.045em", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{value}</span>
        {unit && <span style={{ fontSize: Math.round(size * 0.34), fontWeight: 700, letterSpacing: "-0.01em", opacity: 0.85 }}>{unit}</span>}
      </p>
      {label && <p style={{ fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: ATMOS_TEXT2, margin: "6px 0 0" }}>{label}</p>}
    </div>
  );
}

// ── Headline ──────────────────────────────────────────────────────
// A plain-language line in the serif, the "what this means" of a card.
export function Headline({ children, size = 23, style }: { children: React.ReactNode; size?: number; style?: React.CSSProperties }) {
  return (
    <p style={{ fontFamily: F.display, fontSize: size, fontWeight: 500, lineHeight: 1.22, letterSpacing: "-0.012em", color: T.text, margin: 0, fontOpticalSizing: "auto", ...style } as React.CSSProperties}>
      {children}
    </p>
  );
}

// Supporting line under a headline, dark enough for every tint.
export function Detail({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ fontFamily: F.sans, fontSize: TYPE.support + 1, color: ATMOS_TEXT2, lineHeight: 1.45, margin: "6px 0 0", ...style }}>{children}</p>;
}

// ── LargeTitle ────────────────────────────────────────────────────
// The big page title. As you scroll it lifts and fades, and a compact
// frosted bar with the same title fades in at the top.
export function LargeTitle({ eyebrow, title, subtitle, right, compactTitle }: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  compactTitle?: string;
}) {
  const big = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const still = prefersReducedMotion();
    return onScrollFrame(y => {
      const p = Math.min(1, Math.max(0, y / 80));
      if (big.current) {
        big.current.style.opacity = String(1 - p * 0.9);
        if (!still) big.current.style.transform = `translate3d(0, ${-p * 10}px, 0) scale(${1 - p * 0.04})`;
      }
      if (bar.current) {
        const q = Math.min(1, Math.max(0, (y - 40) / 40));
        bar.current.style.opacity = String(q);
        bar.current.style.pointerEvents = q > 0.5 ? "auto" : "none";
      }
    });
  }, []);
  return (
    <>
      {/* Portaled to <body>: the screen's fade-in leaves a transform on its
          wrapper, which would otherwise pin this "fixed" bar to the page. */}
      {createPortal(<div ref={bar} aria-hidden="true" style={{
        position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, zIndex: 90,
        paddingTop: "env(safe-area-inset-top, 0px)", opacity: 0, pointerEvents: "none",
        background: "rgba(244,238,224,.78)", backdropFilter: "blur(20px) saturate(170%)", WebkitBackdropFilter: "blur(20px) saturate(170%)",
        borderBottom: "1px solid rgba(28,61,90,.08)",
      }}>
        <p style={{ height: 44, display: "grid", placeItems: "center", margin: 0, fontFamily: F.sans, fontSize: 16, fontWeight: 700, color: T.text }}>
          {compactTitle ?? (typeof title === "string" ? title : "")}
        </p>
      </div>, document.body)}
      <header style={{ display: "flex", alignItems: "flex-start", gap: S.md, margin: `${S.xs}px 0 ${S.xl}px` }}>
        <div ref={big} style={{ flex: 1, minWidth: 0, transformOrigin: "0 0", willChange: "transform, opacity" }}>
          {eyebrow && <p style={{ fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text2, margin: "0 0 4px" }}>{eyebrow}</p>}
          <h1 style={{ fontFamily: F.sans, fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em", color: T.text, margin: 0, lineHeight: 1.12, overflowWrap: "anywhere" }}>{title}</h1>
          {subtitle && <p style={{ fontFamily: F.sans, fontSize: TYPE.body, color: T.text2, margin: "4px 0 0" }}>{subtitle}</p>}
        </div>
        {right}
      </header>
    </>
  );
}

// ── PullToRefresh ─────────────────────────────────────────────────
// Drop <PullToRefresh onRefresh={...} /> anywhere on a screen.
export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> | void }) {
  const ref = usePullToRefresh(onRefresh);
  return createPortal(
    <div ref={ref} aria-hidden="true" style={{
      position: "fixed", top: "env(safe-area-inset-top, 0px)", left: "50%", zIndex: 95, opacity: 0,
      transform: "translate3d(-50%, -24px, 0) scale(.6)", pointerEvents: "none",
      width: 40, height: 40, borderRadius: 20, display: "grid", placeItems: "center",
      background: "rgba(255,255,255,.85)", boxShadow: "0 6px 18px rgba(94,74,140,.22)",
    }}>
      <span style={{ display: "grid", placeItems: "center" }}><SparkleIcon size={20} color={T.action} filled /></span>
    </div>,
    document.body,
  );
}
