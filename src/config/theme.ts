// ─── HerNest V2 Design System — Royal Pop Edition ────────────────

export const T = {
  // Core palette (keep espresso warmth)
  cream:    "#F6F1E8",
  ivory:    "#FCFAF5",
  linen:    "#E8DFD0",
  sand:     "#F0E8D8",
  esp:      "#2A1F18",   // espresso — kept
  bark:     "#5C4033",
  taupe:    "#756557", // darkened 2026-07-11: was #9B8577 (3.1:1 on ivory — failed WCAG AA); now ~5:1
  stone:    "#7A6B60",

  // Brand gold — kept
  gold:     "#C9A961",
  goldText: "#8B6914", // gold is 2.2:1 as text on light bg — use THIS for gold text on cream/ivory (4.5:1+)
  goldSoft: "#E8D9B5",
  goldP:    "rgba(201,169,97,0.12)",

  // Royal Pop palette
  sage:     "#4CAF7D",   // Royal Pop green — vivid
  sageP:    "rgba(76,175,125,0.12)",

  sky:      "#5BB8E8",   // Royal Pop baby blue — brighter
  skyP:     "rgba(91,184,232,0.12)",

  blush:    "#F472A0",   // Royal Pop pink — bold
  blushP:   "rgba(244,114,160,0.12)",

  navy:     "#1B2A4A",   // Royal Pop navy — calendar
  navyP:    "rgba(27,42,74,0.12)",

  orange:   "#F97316",   // Royal Pop orange — energy/alerts
  orangeP:  "rgba(249,115,22,0.12)",

  yellow:   "#F5C518",   // Royal Pop yellow — highlights
  yellowP:  "rgba(245,197,24,0.12)",

  red:      "#EF4444",   // Royal Pop red — critical only
  redP:     "rgba(239,68,68,0.12)",

  lav:      "#8B7BB5",   // keep lavender
  lavP:     "rgba(139,123,181,0.12)",
  teal:     "#5B9EA0",
  tealP:    "rgba(91,158,160,0.12)",

  // AI gradient — espresso kept
  aiGrad:   "linear-gradient(135deg, #2A1F18 0%, #3D2E22 50%, #1a130d 100%)",
} as const;

export const F = {
  serif:  "'Cormorant Garamond', Georgia, serif",
  sans:   "'DM Sans', 'Helvetica Neue', sans-serif",
} as const;

export const SHADOWS = {
  sm:   "0 1px 4px rgba(42,31,24,0.08)",
  md:   "0 4px 16px rgba(42,31,24,0.10)",
  lg:   "0 8px 32px rgba(42,31,24,0.12)",
  gold: "0 4px 20px rgba(201,169,97,0.20)",
  navy: "0 4px 20px rgba(27,42,74,0.20)",
  pop:  "0 4px 20px rgba(244,114,160,0.20)",
} as const;
