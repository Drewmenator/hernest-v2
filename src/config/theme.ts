// ─── HerNest 2.0 Design System: Wisteria ─────────────────────────
// Warm ivory canvas, deep indigo for trust, wisteria lavender as Cleo's
// signature. Sage marks household and money, blush marks personal life,
// pale blue marks planning.
//
// Use the semantic roles (bg, surface, text, action, cleoBg, ...) in new
// code. The older names below (cream, esp, gold, sage, ...) are kept so
// every existing screen keeps working; they now point at Wisteria values.
//
// Contrast (WCAG): indigo on ivory 9.7:1, white on deep violet 7.4:1,
// indigo on lavender 8.6:1, indigo on sage 8.9:1. Light lavender is a
// background only, never small text on ivory.

const W = {
  ivory:      "#F4EEE0",
  white:      "#FFFFFF",
  indigo:     "#1C3D5A",
  slate:      "#5B6372",
  wisteria:   "#B5A6C9",
  violet:     "#5E4A8C",
  violetDeep: "#4C3B74",
  lavender:   "#E6DDF0",
  sage:       "#DDE8D9",
  sageInk:    "#2F6B45",
  blush:      "#F5DED5",
  blushInk:   "#8A4A35",
  sky:        "#E3ECF7",
  skyInk:     "#2F5A8F",
  divider:    "#E4DED8",
  danger:     "#B3261E",
  dangerBg:   "#FBE9E7",
  warn:       "#9A5B12",
  warnBg:     "#FCEFD9",
} as const;

export const T = {
  // ── Semantic roles (use these) ────────────────────────────────
  bg:          W.ivory,     // app background
  surface:     W.white,     // cards, sheets, inputs
  text:        W.indigo,    // headings and body
  text2:       W.slate,     // supporting information
  action:      W.violet,    // buttons, active tab
  actionPress: W.violetDeep,
  cleoBg:      W.lavender,  // briefings, AI suggestions
  householdBg: W.sage,      // shared and completed items, money
  householdInk: W.sageInk,
  personalBg:  W.blush,     // wellbeing, My Space
  personalInk: W.blushInk,
  planBg:      W.sky,       // tasks, calendar, school
  planInk:     W.skyInk,
  divider:     W.divider,
  wisteria:    W.wisteria,  // decorative only (never text)
  indigo:      W.indigo,
  violet:      W.violet,
  danger:      W.danger,
  dangerBg:    W.dangerBg,
  warn:        W.warn,
  warnBg:      W.warnBg,

  // ── Older names, mapped onto Wisteria ─────────────────────────
  cream:    W.ivory,          // page background
  ivory:    W.white,          // card / input background
  linen:    W.divider,        // borders
  sand:     "#ECE5D6",        // quiet fills, unselected chips
  esp:      W.indigo,         // primary text, dark surfaces
  bark:     "#34495E",        // body text
  taupe:    W.slate,          // secondary text
  stone:    "#6B7280",

  gold:     W.violet,         // brand accent (was gold)
  goldText: W.violet,         // accent text on light backgrounds
  goldSoft: W.lavender,
  goldP:    "rgba(94,74,140,0.10)",

  sage:     W.sageInk,        // success, "done", positive money
  sageP:    "rgba(47,107,69,0.12)",

  sky:      W.skyInk,         // planning
  skyP:     "rgba(47,90,143,0.12)",

  blush:    "#A8475D",        // alerts that need care (text-safe rose)
  blushP:   "rgba(168,71,93,0.12)",

  navy:     W.indigo,
  navyP:    "rgba(28,61,90,0.12)",

  orange:   W.warn,
  orangeP:  "rgba(154,91,18,0.12)",

  yellow:   "#C9A227",
  yellowP:  "rgba(201,162,39,0.14)",

  red:      W.danger,
  redP:     "rgba(179,38,30,0.12)",

  lav:      W.violet,
  lavP:     "rgba(94,74,140,0.12)",
  teal:     "#3E7C80",
  tealP:    "rgba(62,124,128,0.12)",

  aiGrad:   `linear-gradient(135deg, ${W.indigo} 0%, #2B4A6E 55%, ${W.violetDeep} 100%)`,
} as const;

// DM Sans for everything you read and tap. `serif` is kept as a name for
// older screens and is DM Sans too. `display` is the one true serif
// (Fraunces): only for the one-line headline on a card, never for UI text.
export const F = {
  serif:   "'DM Sans', -apple-system, 'Helvetica Neue', sans-serif",
  sans:    "'DM Sans', -apple-system, 'Helvetica Neue', sans-serif",
  display: "'Fraunces', 'Iowan Old Style', Georgia, serif",
} as const;

// Type scale (px). Smallest text anywhere is 12.
export const TYPE = {
  screen:  28,  // main screen heading, bold
  section: 19,  // section heading, semibold
  card:    16,  // card heading, semibold
  body:    16,  // body
  support: 14,  // supporting text
  meta:    12,  // small metadata (minimum)
} as const;

// 4/8 spacing scale and shared radii.
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const R = { card: 18, button: 12, chip: 99, sheet: 24 } as const;
export const PAGE_PAD = 20;

export const SHADOWS = {
  sm:   "0 1px 2px rgba(28,61,90,0.05), 0 4px 14px rgba(28,61,90,0.05)",
  md:   "0 4px 16px rgba(28,61,90,0.08)",
  lg:   "0 10px 32px rgba(28,61,90,0.12)",
  gold: "0 6px 20px rgba(94,74,140,0.22)",
  navy: "0 6px 20px rgba(28,61,90,0.20)",
  pop:  "0 6px 20px rgba(94,74,140,0.18)",
} as const;

// ─── Atmosphere ───────────────────────────────────────────────────
// Layered card backgrounds: a soft two-stop gradient in the area's color,
// a white light in the top right and a faint colored glow in the bottom
// left, plus a colored shadow so cards float above the ivory page.
// Text stays indigo; each `ink` keeps 4.5:1 or better on the darkest stop
// (checked in theme.test.ts). `chart` is for marks, never for text.
export type Atmos = { base: string; glow: string; ink: string; chart: string; chartSoft: string; shadow: string };
// Supporting text on atmosphere cards: slate is too light on the deeper
// tints, so cards use this darker slate instead.
export const ATMOS_TEXT2 = "#3E4859";
const atmos = (from: string, to: string, glow: string, ink: string, chart: string, shadowRgb: string): Atmos => ({
  base: `radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,.75) 0%, rgba(255,255,255,0) 55%), radial-gradient(90% 70% at 0% 100%, ${glow} 0%, rgba(255,255,255,0) 70%), linear-gradient(160deg, ${from} 0%, ${to} 100%)`,
  glow, ink, chart,
  chartSoft: `rgba(${shadowRgb},0.18)`,
  shadow: `inset 0 1px 0 rgba(255,255,255,.7), 0 1px 2px rgba(${shadowRgb},.06), 0 14px 34px -14px rgba(${shadowRgb},.38)`,
});
export const ATMOS = {
  cleo:      atmos("#F0EAF7", "#E3D8EF", "rgba(181,166,201,.32)", W.violetDeep,     "#7A63AE", "94,74,140"),
  household: atmos("#EAF2E6", "#D2E3CC", "rgba(150,190,140,.34)", "#24573A",    "#4F8A62", "47,107,69"),
  personal:  atmos("#FBEDE7", "#F2D7CC", "rgba(236,170,150,.34)", "#763B28",   "#C07A62", "138,74,53"),
  plan:      atmos("#EDF3FB", "#D8E5F5", "rgba(140,175,225,.34)", "#24497A",     "#4C7BB8", "47,90,143"),
  alert:     atmos("#FDEDEA", "#F6D9D4", "rgba(230,140,130,.30)", "#951D17",     "#C4544A", "179,38,30"),
} as const satisfies Record<string, Atmos>;
// The darkest stop of each gradient, for contrast checks.
export const ATMOS_DARKEST = { cleo: "#E3D8EF", household: "#D2E3CC", personal: "#F2D7CC", plan: "#D8E5F5", alert: "#F6D9D4" } as const;

// Motion: one easing for things settling into place, short durations.
// Everything animates transform or opacity only, so it stays smooth.
export const MOTION = {
  ease: "cubic-bezier(.2,.8,.2,1)",
  fast: 180,
  base: 320,
  slow: 560,
} as const;

// ─── Texture ──────────────────────────────────────────────────────
// Fine grain from a small tiled SVG noise (drawn once, then reused), so
// surfaces don't look plastic. Use on backgrounds and the Cleo card only,
// never behind dense text or charts.
export const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .25  0 0 0 0 .2  0 0 0 0 .3  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;
