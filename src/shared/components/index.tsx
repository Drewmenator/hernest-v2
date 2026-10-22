// ─── HerNest Shared Components: Wisteria ──────────────────────────
// One set of building blocks for all five tabs, so a change to a button,
// card or heading carries everywhere. Older components keep their names
// and props; new screens should prefer the Wisteria pieces below them
// (SectionHeader, ListRow, StatusChip, TintCard, QuickAction, ...).
import React from "react";
import { T, F, R, S, TYPE, SHADOWS, alpha } from "../../config/theme";
import { SparkleIcon, CheckIcon } from "./Icons";
import { useReveal } from "../motion";
import { haptic } from "../haptics";
import { LargeTitle } from "./atmosphere";
export { GlowCard, HeroNumber, Headline, Detail, LargeTitle, PullToRefresh, type AtmosTint } from "./atmosphere";
export { DayTimeline, MiniBars, SparkArea, ProgressRing } from "./charts";
export { Emoji } from "./Emoji";

// ── Card ──────────────────────────────────────────────────────────
// Standard white information card.
export function Card({
  children,
  style,
  onClick,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      onClick={onClick}
      style={{
        background: T.surface,
        borderRadius: R.card,
        padding: S.lg,
        boxShadow: SHADOWS.sm,
        marginBottom: S.md,
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── TintCard ──────────────────────────────────────────────────────
// Tinted cards carry context: Cleo (lavender), household and money
// (sage), personal wellbeing (blush), planning (pale blue).
export type Tint = "cleo" | "household" | "personal" | "plan";
const TINT: Record<Tint, { bg: string; ink: string }> = {
  cleo:      { bg: T.cleoBg,      ink: T.action },
  household: { bg: T.householdBg, ink: T.householdInk },
  personal:  { bg: T.personalBg,  ink: T.personalInk },
  plan:      { bg: T.planBg,      ink: T.planInk },
};

export function TintCard({
  tint,
  eyebrow,
  title,
  children,
  style,
}: {
  tint: Tint;
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const c = TINT[tint];
  return (
    <section style={{ background: c.bg, borderRadius: R.card, padding: S.lg, marginBottom: S.md, ...style }}>
      {eyebrow && (
        <p style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 700, color: c.ink, margin: "0 0 6px" }}>
          {tint === "cleo" && <SparkleIcon size={16} color={c.ink} filled />}
          {eyebrow}
        </p>
      )}
      {title && <p style={{ fontFamily: F.sans, fontSize: TYPE.card, fontWeight: 600, color: T.text, margin: 0, lineHeight: 1.45 }}>{title}</p>}
      {children}
    </section>
  );
}

// ── HeroCard ──────────────────────────────────────────────────────
// Kept for older screens: now a Cleo-lavender card with indigo text.
export function HeroCard({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  color?: string;
}) {
  return (
    <div style={{ background: T.cleoBg, borderRadius: R.card, padding: S.xl, marginBottom: S.lg }}>
      {eyebrow && (
        <p style={{ fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.action, margin: "0 0 6px" }}>{eyebrow}</p>
      )}
      <h2 style={{ fontFamily: F.sans, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: T.text, margin: 0, lineHeight: 1.2 }}>{title}</h2>
      {subtitle && <p style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text2, margin: "6px 0 0" }}>{subtitle}</p>}
      {children}
    </div>
  );
}

// ── PageTitle ─────────────────────────────────────────────────────
// Main screen heading: 32 serif (Fraunces), optional small line above and below.
// `collapse` (top-level tab screens only): the title lifts away as you
// scroll and a compact frosted bar takes its place.
export function PageTitle({ eyebrow, title, subtitle, right, collapse }: { eyebrow?: string; title: string; subtitle?: string; right?: React.ReactNode; collapse?: boolean }) {
  if (collapse) return <LargeTitle eyebrow={eyebrow} title={title} subtitle={subtitle} right={right} />;
  return (
    <header style={{ display: "flex", alignItems: "flex-start", gap: S.md, marginBottom: S.xl, paddingTop: S.xs }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <p style={{ fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text2, margin: "0 0 4px" }}>{eyebrow}</p>
        )}
        <h1 style={{ fontFamily: F.display, fontSize: TYPE.screen + 4, fontWeight: 500, letterSpacing: "-0.02em", color: T.text, margin: 0, lineHeight: 1.1 }}>{title}</h1>
        {subtitle && <p style={{ fontFamily: F.sans, fontSize: TYPE.body, color: T.text2, margin: "4px 0 0" }}>{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

// ── SectionHeader ─────────────────────────────────────────────────
// Section heading (22 serif) with an optional text action on the right.
export function SectionHeader({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: S.md, margin: `${S.xxl}px 0 ${S.sm}px`, ...style }}>
      <h2 style={{ fontFamily: F.display, fontSize: TYPE.section + 3, fontWeight: 500, letterSpacing: "-0.012em", color: T.text, margin: 0 }}>{title}</h2>
      {action && onAction && <TextButton onClick={onAction}>{action}</TextButton>}
    </div>
  );
}

// ── TextButton ────────────────────────────────────────────────────
export function TextButton({ children, onClick, color = T.action, style }: { children: React.ReactNode; onClick: () => void; color?: string; style?: React.CSSProperties }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", padding: "0 2px", minHeight: 44, display: "inline-flex", alignItems: "center", gap: 4, fontFamily: F.sans, fontSize: 15, fontWeight: 600, color, cursor: "pointer", touchAction: "manipulation", ...style }}>
      {children}
    </button>
  );
}

// ── ListRow ───────────────────────────────────────────────────────
// One row inside a Card: optional leading element, title + detail, and
// an optional trailing element (chip, amount, button). Rows inside the
// same card are separated by a hairline.
export function ListRow({
  leading, title, detail, trailing, actions, onClick, divider = true, ariaLabel,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
  // Buttons under the text (used when two buttons would squeeze the title).
  actions?: React.ReactNode;
  onClick?: () => void;
  divider?: boolean;
  ariaLabel?: string;
}) {
  const inner = (
    <>
      {leading}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: F.sans, fontSize: TYPE.card, fontWeight: 600, color: T.text, lineHeight: 1.35, overflowWrap: "anywhere" }}>{title}</div>
        {detail && <div style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text2, marginTop: 2, lineHeight: 1.4 }}>{detail}</div>}
        {actions && <div style={{ display: "flex", gap: S.sm, marginTop: S.sm, flexWrap: "wrap" }}>{actions}</div>}
      </div>
      {trailing}
    </>
  );
  const style: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: S.md, minHeight: 60, padding: `${S.md}px 0`,
    width: "100%", textAlign: "left", background: "none",
    borderStyle: "solid", borderColor: T.divider, borderWidth: `${divider ? 1 : 0}px 0 0 0`,
  };
  return onClick
    ? <button onClick={onClick} aria-label={ariaLabel} style={{ ...style, cursor: "pointer", touchAction: "manipulation" }}>{inner}</button>
    : <div style={style}>{inner}</div>;
}

// ── StatusChip ────────────────────────────────────────────────────
// Status is always written out; color only supports the word.
export type Status = "paid" | "unpaid" | "autopay" | "overdue" | "handled" | "dueSoon" | "neutral";
const STATUS: Record<Status, { bg: string; fg: string }> = {
  paid:    { bg: T.householdBg, fg: T.householdInk },
  handled: { bg: T.householdBg, fg: T.householdInk },
  unpaid:  { bg: T.personalBg,  fg: T.personalInk },
  dueSoon: { bg: T.warnBg,      fg: T.warn },
  autopay: { bg: T.planBg,      fg: T.planInk },
  overdue: { bg: T.dangerBg,    fg: T.danger },
  neutral: { bg: T.sand,        fg: T.text2 },
};
export function StatusChip({ status, children }: { status: Status; children: React.ReactNode }) {
  const c = STATUS[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: c.bg, color: c.fg, borderRadius: R.chip, padding: "4px 10px", fontFamily: F.sans, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
      {(status === "paid" || status === "handled") && <CheckIcon size={13} color={c.fg} strokeWidth={2.6} />}
      {status === "overdue" && <span aria-hidden="true" style={{ fontWeight: 800 }}>!</span>}
      {children}
    </span>
  );
}

// ── QuickAction ───────────────────────────────────────────────────
export function QuickAction({ label, icon, tint, onClick }: { label: string; icon?: React.ReactNode; tint: Tint; onClick: () => void }) {
  const c = TINT[tint];
  return (
    <button onClick={onClick} style={{ flex: 1, minWidth: 0, minHeight: 52, borderRadius: R.button + 2, border: "none", background: c.bg, color: c.ink, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 8px", fontFamily: F.sans, fontSize: 15, fontWeight: 600, cursor: "pointer", touchAction: "manipulation" }}>
      {icon}{label}
    </button>
  );
}

// ── CheckCircle ───────────────────────────────────────────────────
// A 44pt tap target around a 26pt rounded checkbox.
export function CheckBox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button onClick={() => { haptic(checked ? "select" : "success"); onToggle(); }} aria-pressed={checked} aria-label={label}
      style={{ width: 44, height: 44, margin: "-9px -9px -9px -9px", flex: "none", display: "grid", placeItems: "center", background: "none", border: "none", cursor: "pointer", touchAction: "manipulation" }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, border: `2px solid ${checked ? T.householdInk : T.border}`, background: checked ? T.householdInk : T.surface, display: "grid", placeItems: "center" }}>
        {checked && <CheckIcon size={15} color={T.onAction} strokeWidth={3} />}
      </span>
    </button>
  );
}

// ── Pill ──────────────────────────────────────────────────────────
export function Pill({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? (color || T.action) : T.surface,
        color: active ? T.onAction : T.text,
        border: `1px solid ${active ? (color || T.action) : T.divider}`,
        borderRadius: R.chip,
        padding: "8px 14px",
        minHeight: 36,
        fontFamily: F.sans,
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        transition: "background .15s, color .15s",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

// ── Spinner ───────────────────────────────────────────────────────
export function Spinner({ size = 24, color = T.action }: { size?: number; color?: string }) {
  return (
    <div role="status" aria-label="Loading" style={{
      width: size, height: size, borderRadius: "50%",
      border: `2px solid ${alpha(color, 0.19)}`,
      borderTop: `2px solid ${color}`,
      animation: "spin 0.8s linear infinite",
    }} />
  );
}

// ── Skeleton ──────────────────────────────────────────────────────
// Placeholder blocks while data loads, so the layout doesn't jump.
// onTint: lighter, for use inside a colored card.
export function Skeleton({ width = "100%", height = 14, radius = 8, style, onTint }: { width?: number | string; height?: number; radius?: number; style?: React.CSSProperties; onTint?: boolean }) {
  return <div aria-hidden="true" className={onTint ? "hn-skeleton on-tint" : "hn-skeleton"} style={{ width, height, borderRadius: radius, ...style }} />;
}
export function SkeletonRows({ rows = 2 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: S.md, padding: `${S.md}px 0`, borderTop: i ? `1px solid ${T.divider}` : "none" }}>
          <Skeleton width={26} height={26} radius={8} />
          <div style={{ flex: 1 }}><Skeleton width="65%" height={13} /><Skeleton width="35%" height={11} style={{ marginTop: 8 }} /></div>
        </div>
      ))}
    </div>
  );
}

// ── AIBadge ───────────────────────────────────────────────────────
export function AIBadge({ label = "Generated by Cleo" }: { label?: string }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: T.cleoBg, borderRadius: R.chip, padding: "4px 10px",
    }}>
      <SparkleIcon size={13} color={T.action} filled />
      <span style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: T.action }}>{label}</span>
    </div>
  );
}

// ── CleoCallout ───────────────────────────────────────────────────
// A Cleo insight card.
export function CleoCallout({
  message,
  eyebrow = "Cleo noticed",
}: {
  message: string;
  eyebrow?: string;
}) {
  return <TintCard tint="cleo" eyebrow={sentenceCase(eyebrow)} title={message} />;
}

function sentenceCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// ── CleoActionCard ────────────────────────────────────────────────
// Cleo shows when she's preparing an action, waiting for approval, or
// has finished. Suggestions never look like completed actions.
export function CleoActionCard({
  state, title, detail, confirmLabel = "Yes, do it", declineLabel = "Not now", onConfirm, onDecline,
}: {
  state: "preparing" | "waiting" | "done";
  title: React.ReactNode;
  detail?: React.ReactNode;
  confirmLabel?: string;
  declineLabel?: string;
  onConfirm?: () => void;
  onDecline?: () => void;
}) {
  const done = state === "done";
  const label = state === "preparing" ? "Preparing" : state === "waiting" ? "Waiting for your OK" : "Done";
  return (
    <div role={state === "preparing" ? "status" : undefined} style={{ background: T.surface, borderRadius: R.card, padding: "12px 14px", boxShadow: `inset 0 0 0 1.5px ${done ? T.householdBg : T.cleoBg}`, marginBottom: S.sm }}>
      <p style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: F.sans, fontSize: 13, fontWeight: 700, color: done ? T.householdInk : T.action, margin: 0 }}>
        {state === "preparing" && <Spinner size={13} />}
        {state === "waiting" && <SparkleIcon size={14} color={T.action} filled />}
        {done && <CheckIcon size={14} color={T.householdInk} strokeWidth={2.6} />}
        {label}
      </p>
      <div style={{ fontFamily: F.sans, fontSize: TYPE.card, fontWeight: 600, color: T.text, marginTop: 6, lineHeight: 1.4 }}>{title}</div>
      {detail && <div style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text2, marginTop: 2 }}>{detail}</div>}
      {state === "waiting" && (onConfirm || onDecline) && (
        <div style={{ display: "flex", gap: S.sm, marginTop: S.md }}>
          {onConfirm && <Button size="sm" onClick={onConfirm} style={{ width: "auto" }}>{confirmLabel}</Button>}
          {onDecline && <Button size="sm" variant="secondary" onClick={onDecline} style={{ width: "auto" }}>{declineLabel}</Button>}
        </div>
      )}
    </div>
  );
}

// ── Input ─────────────────────────────────────────────────────────
let _inputId = 0;

export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  style,
  label,
  required = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  style?: React.CSSProperties;
  // A visible, programmatically-associated label. Placeholder-only inputs
  // have no accessible name once the user types — pass a label wherever the
  // field's purpose isn't obvious from immediate context.
  label?: string;
  required?: boolean;
}) {
  const [id] = React.useState(() => `hn-input-${++_inputId}`);
  const field = (
    <input
      id={label ? id : undefined}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      aria-label={!label ? placeholder : undefined}
      style={{
        width: "100%",
        background: T.surface,
        border: `1.5px solid ${T.divider}`,
        borderRadius: R.button,
        padding: "12px 14px",
        minHeight: 48,
        fontFamily: F.sans,
        fontSize: 16, // 16px prevents iOS zoom on focus
        color: T.text,
        outline: "none",
        boxSizing: "border-box",
        WebkitAppearance: "none",
        ...style,
      }}
    />
  );
  if (!label) return field;
  return (
    <div>
      <label htmlFor={id} style={{ display: "block", fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text, margin: "0 0 6px" }}>
        {label}{required && <span aria-hidden="true" style={{ color: T.danger }}> *</span>}
      </label>
      {field}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────
// Primary (deep violet), Secondary (white, outlined), Gentle (lavender),
// Completed (sage, with a check). Older variant names still work.
export type ButtonVariant = "primary" | "secondary" | "gentle" | "completed" | "ghost" | "gold";
export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  style,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  disabled?: boolean;
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  const styles: Record<ButtonVariant, React.CSSProperties> = {
    primary:   { background: T.action, color: T.onAction, border: "none" },
    gold:      { background: T.action, color: T.onAction, border: "none" },
    secondary: { background: T.surface, color: T.text, border: `1.5px solid ${T.divider}` },
    ghost:     { background: "transparent", color: T.text, border: `1.5px solid ${T.divider}` },
    gentle:    { background: T.cleoBg, color: T.action, border: "none" },
    completed: { background: T.householdBg, color: T.householdInk, border: "none" },
  };
  const sm = size === "sm";
  return (
    <button
      onClick={onClick && (() => { if (variant === "primary" || variant === "gold" || variant === "completed") haptic("tap"); onClick(); })}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        ...styles[variant],
        borderRadius: R.button,
        padding: sm ? "0 14px" : "0 20px",
        minHeight: sm ? 40 : 50,
        fontFamily: F.sans,
        fontSize: sm ? 14 : 16,
        fontWeight: 600,
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "transform .1s ease-out, background .15s",
        width: "100%",
        whiteSpace: "nowrap",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        ...style,
      }}
    >
      {variant === "completed" && <CheckIcon size={sm ? 14 : 16} color={T.householdInk} strokeWidth={2.6} />}
      {children}
    </button>
  );
}

// ── ProgressBar ───────────────────────────────────────────────────
export function ProgressBar({
  value,
  max = 100,
  color = T.action,
  height = 6,
}: {
  value: number;
  max?: number;
  color?: string;
  height?: number;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ background: `${alpha(color, 0.13)}`, borderRadius: 99, height, overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`, height: "100%",
        background: color, borderRadius: 99,
        transition: "width .6s cubic-bezier(.4,0,.2,1)",
      }} />
    </div>
  );
}

// ── AIErrorCard ───────────────────────────────────────────────────
export function AIErrorCard({
  message = "Something went wrong",
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" style={{
      background: T.surface, borderRadius: R.card, padding: "22px 20px", textAlign: "center", marginBottom: S.md, boxShadow: SHADOWS.sm,
    }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}><SparkleIcon size={22} color={T.wisteria} filled /></div>
      <p style={{ fontFamily: F.sans, fontSize: TYPE.body, color: T.text, margin: "0 0 14px", lineHeight: 1.5 }}>{message}</p>
      <Button size="sm" variant="secondary" onClick={onRetry} style={{ width: "auto" }}>Try again</Button>
    </div>
  );
}

// ── EmptyState ─────────────────────────────────────────────────────
// Friendly explanation and one clear action. Never a blank card.
export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  tint = "cleo",
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  tint?: Tint;
}) {
  const c = TINT[tint];
  return (
    <div style={{ textAlign: "center", padding: "32px 20px" }}>
      <div style={{ width: 60, height: 60, borderRadius: 20, background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: 24, color: c.ink }}>
        {icon ?? <SparkleIcon size={26} color={c.ink} filled />}
      </div>
      <p style={{ fontFamily: F.sans, fontSize: TYPE.section, fontWeight: 700, color: T.text, margin: "0 0 6px" }}>{title}</p>
      <p style={{ fontFamily: F.sans, fontSize: 15, color: T.text2, margin: "0 auto 18px", lineHeight: 1.5, maxWidth: 300 }}>{body}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction} style={{ width: "auto" }}>{actionLabel}</Button>
      )}
    </div>
  );
}

// ── Segmented ─────────────────────────────────────────────────────
// Two to four views of the same screen (Tasks / Week / School / Meals).
export function Segmented<V extends string>({ options, value, onChange, label }: {
  options: { id: V; label: string; badge?: number }[];
  value: V;
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} style={{ display: "flex", gap: 4, padding: 4, background: T.sand, borderRadius: 14, marginBottom: S.lg }}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <button key={o.id} role="tab" aria-selected={on} onClick={() => onChange(o.id)}
            style={{ flex: 1, minWidth: 0, minHeight: 40, borderRadius: 11, border: "none", cursor: "pointer", touchAction: "manipulation",
              background: on ? T.surface : "transparent", boxShadow: on ? "0 1px 3px rgba(28,61,90,.12)" : "none",
              fontFamily: F.sans, fontSize: 14, fontWeight: on ? 700 : 500, color: on ? T.text : T.text2,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "0 6px", whiteSpace: "nowrap" }}>
            {o.label}
            {!!o.badge && <span aria-label={`${o.badge} need attention`} style={{ minWidth: 18, height: 18, borderRadius: 9, background: T.action, color: T.onAction, fontSize: 12, fontWeight: 700, display: "inline-grid", placeItems: "center", padding: "0 5px" }}>{o.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
