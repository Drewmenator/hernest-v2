// ─── HerNest Design System: Wisteria Luxe ─────────────────────────
// Two themes from one set of roles: Wisteria Glow (light, warm paper) and
// Midnight Wisteria (dark, plum midnight). Every color in T is a CSS
// variable, so a screen styled with T switches theme with no code change.
// Values follow the Wisteria Luxe handoff (design-system/TOKENS.md).
//
// Use the semantic roles (bg, surface, text, action, cleoBg, ...) in new
// code. The older names (cream, esp, gold, sage, ...) are kept so every
// existing screen keeps working; they point at the same roles.
//
// Never glue an alpha onto a T color (`${T.gold}20`): use alpha(T.gold, .12).
// Contrast for every text/background pair, in both themes, is pinned by
// theme.test.ts.

type Palette = Record<string, string>;

const LIGHT = {
  // Semantic roles
  bg: "#F8F4F0", surface: "#FFFCFA", text: "#301C39", text2: "#594A60",
  action: "#62417A", actionPress: "#4E3263", onAction: "#FFFFFF",
  cleoBg: "#E9DCF2", householdBg: "#E2EDDF", householdInk: "#2F6B45",
  personalBg: "#F8E1DC", personalInk: "#8A4A35", planBg: "#E4EFF6", planInk: "#2F5A8F",
  divider: "#E6DCE4", border: "#DCCEDC", wisteria: "#B5A6C9", indigo: "#301C39", violet: "#62417A",
  danger: "#B3261E", dangerBg: "#F9E6E4", warn: "#9A5B12", warnBg: "#FCEFD9",
  // Glass and veils (white light in Glow, a faint lift in Midnight)
  glass: "rgba(255,255,255,0.62)", glassStrong: "rgba(255,255,255,0.86)", hairline: "rgba(48,28,57,0.08)",
  frost: "rgba(252,249,245,0.74)", frostBar: "rgba(248,244,240,0.80)",
  // Older names
  cream: "#F8F4F0", ivory: "#FFFCFA", linen: "#E6DCE4", sand: "#EFE7DE",
  esp: "#301C39", bark: "#43304D", taupe: "#594A60", stone: "#6B6070",
  gold: "#62417A", goldText: "#62417A", goldSoft: "#E9DCF2", goldP: "rgba(98,65,122,0.10)",
  sage: "#2F6B45", sageP: "rgba(47,107,69,0.12)", sky: "#2F5A8F", skyP: "rgba(47,90,143,0.12)",
  blush: "#A8475D", blushP: "rgba(168,71,93,0.12)", navy: "#301C39", navyP: "rgba(48,28,57,0.10)",
  orange: "#9A5B12", orangeP: "rgba(154,91,18,0.12)", yellow: "#8A6D0F", yellowP: "rgba(201,162,39,0.14)",
  red: "#B3261E", redP: "rgba(179,38,30,0.12)", lav: "#62417A", lavP: "rgba(98,65,122,0.12)",
  teal: "#336B6F", tealP: "rgba(62,124,128,0.12)",
} as const satisfies Palette;

const DARK: Record<keyof typeof LIGHT, string> = {
  bg: "#151222", surface: "#282136", text: "#FCF5F4", text2: "#D4C9DA",
  action: "#C8A9F2", actionPress: "#B592E8", onAction: "#1E1630",
  cleoBg: "#493460", householdBg: "#2C483E", householdInk: "#A6DCB8",
  personalBg: "#513442", personalInk: "#F6C2B3", planBg: "#243A53", planInk: "#B0D0F2",
  divider: "#3E3350", border: "#655470", wisteria: "#8E7BAE", indigo: "#FCF5F4", violet: "#C8A9F2",
  danger: "#FFA49B", dangerBg: "#522D37", warn: "#F2C084", warnBg: "#4A3626",
  glass: "rgba(255,255,255,0.07)", glassStrong: "rgba(255,255,255,0.12)", hairline: "rgba(255,255,255,0.08)",
  frost: "rgba(40,33,54,0.72)", frostBar: "rgba(21,18,34,0.78)",
  cream: "#151222", ivory: "#282136", linen: "#3E3350", sand: "#332940",
  esp: "#FCF5F4", bark: "#E9DFEA", taupe: "#D4C9DA", stone: "#BCB0C3",
  gold: "#C8A9F2", goldText: "#C8A9F2", goldSoft: "#493460", goldP: "rgba(200,169,242,0.14)",
  sage: "#A6DCB8", sageP: "rgba(166,220,184,0.14)", sky: "#B0D0F2", skyP: "rgba(176,208,242,0.14)",
  blush: "#F2A3B5", blushP: "rgba(242,163,181,0.14)", navy: "#FCF5F4", navyP: "rgba(252,245,244,0.10)",
  orange: "#F2C084", orangeP: "rgba(242,192,132,0.14)", yellow: "#E6C65C", yellowP: "rgba(230,198,92,0.16)",
  red: "#FFA49B", redP: "rgba(255,164,155,0.14)", lav: "#C8A9F2", lavP: "rgba(200,169,242,0.14)",
  teal: "#8FD0D4", tealP: "rgba(143,208,212,0.14)",
};

export const PALETTES = { light: LIGHT as Record<keyof typeof LIGHT, string>, dark: DARK };
type Role = keyof typeof LIGHT;
const v = (k: string) => `var(--hn-${k})`;

export const T = {
  ...(Object.fromEntries(Object.keys(LIGHT).map(k => [k, v(k)])) as Record<Role, string>),
  // Always-dark hero gradient (white text on it in both themes).
  aiGrad: "linear-gradient(135deg, #301C39 0%, #3E2C5A 55%, #4E3263 100%)",
  onDark: "#FFFFFF",
};

// A see-through version of any color, theme variable or hex.
export function alpha(color: string, a: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
}

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

const SHADOW_LIGHT = {
  sm:   "0 1px 2px rgba(48,28,57,0.05), 0 4px 14px rgba(48,28,57,0.05)",
  md:   "0 4px 16px rgba(48,28,57,0.08)",
  lg:   "0 10px 32px rgba(48,28,57,0.12)",
  gold: "0 6px 20px rgba(98,65,122,0.22)",
  navy: "0 6px 20px rgba(48,28,57,0.20)",
  pop:  "0 6px 20px rgba(98,65,122,0.18)",
};
const SHADOW_DARK: typeof SHADOW_LIGHT = {
  sm:   "0 1px 2px rgba(0,0,0,0.30), 0 4px 14px rgba(0,0,0,0.25)",
  md:   "0 4px 16px rgba(0,0,0,0.35)",
  lg:   "0 10px 32px rgba(0,0,0,0.45)",
  gold: "0 6px 20px rgba(200,169,242,0.18)",
  navy: "0 6px 20px rgba(0,0,0,0.40)",
  pop:  "0 6px 20px rgba(200,169,242,0.16)",
};
export const SHADOWS = Object.fromEntries(Object.keys(SHADOW_LIGHT).map(k => [k, v(`shadow-${k}`)])) as Record<keyof typeof SHADOW_LIGHT, string>;

// ─── Atmosphere ───────────────────────────────────────────────────
// Layered card backgrounds: a soft two-stop gradient in the area's color,
// a light in the top right and a faint colored glow in the bottom left,
// plus a colored shadow so cards float above the page. Text stays in the
// theme's text color; each `ink` keeps 4.5:1 or better on the darkest
// point (checked in theme.test.ts). `chart` is for marks, never for text.
export type Atmos = { base: string; glow: string; ink: string; chart: string; chartSoft: string; shadow: string };
type AtmosSpec = { from: string; to: string; glow: string; ink: string; chart: string; rgb: string };
const AT_LIGHT: Record<string, AtmosSpec> = {
  cleo:      { from: "#F3ECF8", to: "#E6D9F0", glow: "rgba(181,166,201,0.32)", ink: "#4E3263", chart: "#7A5A9E", rgb: "98,65,122" },
  household: { from: "#EEF5EB", to: "#DCE9D7", glow: "rgba(150,190,140,0.34)", ink: "#24573A", chart: "#4F8A62", rgb: "47,107,69" },
  personal:  { from: "#FCEFEA", to: "#F4DCD5", glow: "rgba(236,170,150,0.34)", ink: "#763B28", chart: "#C07A62", rgb: "138,74,53" },
  plan:      { from: "#EEF5FA", to: "#DCE9F3", glow: "rgba(140,175,225,0.34)", ink: "#24497A", chart: "#4C7BB8", rgb: "47,90,143" },
  alert:     { from: "#FCEEEC", to: "#F5DCD9", glow: "rgba(230,140,130,0.30)", ink: "#951D17", chart: "#C4544A", rgb: "179,38,30" },
};
const AT_DARK: Record<string, AtmosSpec> = {
  cleo:      { from: "#3F2E56", to: "#2E2242", glow: "rgba(200,169,242,0.16)", ink: "#DCC6F7", chart: "#C8A9F2", rgb: "0,0,0" },
  household: { from: "#2F4C42", to: "#233A33", glow: "rgba(120,200,150,0.14)", ink: "#B0E2C0", chart: "#7FC79A", rgb: "0,0,0" },
  personal:  { from: "#563848", to: "#432C38", glow: "rgba(242,170,150,0.14)", ink: "#F8CABD", chart: "#E9A08C", rgb: "0,0,0" },
  plan:      { from: "#2A4361", to: "#213449", glow: "rgba(140,180,235,0.14)", ink: "#BAD7F5", chart: "#8DB6E8", rgb: "0,0,0" },
  alert:     { from: "#5A3039", to: "#47262E", glow: "rgba(255,140,130,0.14)", ink: "#FFBDB6", chart: "#F28B82", rgb: "0,0,0" },
};
export const ATMOS_SPECS = { light: AT_LIGHT, dark: AT_DARK };
const atmosVars = (sp: AtmosSpec, light: boolean): Record<string, string> => ({
  base: `radial-gradient(120% 80% at 100% 0%, rgba(255,255,255,${light ? ".75" : ".07"}) 0%, rgba(255,255,255,0) 55%), radial-gradient(90% 70% at 0% 100%, ${sp.glow} 0%, rgba(255,255,255,0) 70%), linear-gradient(160deg, ${sp.from} 0%, ${sp.to} 100%)`,
  glow: sp.glow, ink: sp.ink, chart: sp.chart,
  soft: `rgba(${light ? sp.rgb : "255,255,255"},${light ? "0.18" : "0.14"})`,
  shadow: light
    ? `inset 0 1px 0 rgba(255,255,255,.7), 0 1px 2px rgba(${sp.rgb},.06), 0 14px 34px -14px rgba(${sp.rgb},.38)`
    : `inset 0 1px 0 rgba(255,255,255,.08), 0 1px 2px rgba(0,0,0,.3), 0 16px 36px -14px rgba(0,0,0,.6)`,
});
const tintNames = ["cleo", "household", "personal", "plan", "alert"] as const;
const atmosOf = (n: string): Atmos => ({
  base: v(`at-${n}-base`), glow: v(`at-${n}-glow`), ink: v(`at-${n}-ink`),
  chart: v(`at-${n}-chart`), chartSoft: v(`at-${n}-soft`), shadow: v(`at-${n}-shadow`),
});
export const ATMOS = Object.fromEntries(tintNames.map(n => [n, atmosOf(n)])) as Record<typeof tintNames[number], Atmos>;
// Supporting text on atmosphere cards (darker than text2 in Glow).
export const ATMOS_TEXT2 = v("at-text2");
export const AT_TEXT2 = { light: "#4A3A52", dark: "#E4DAE8" };

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
const grain = (r: number, g: number, b: number, a: number) => `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 ${a} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
)}")`;
export const GRAIN = v("grain");

// ─── Page atmosphere per tab ──────────────────────────────────────
// Each tab has its own light: Today lavender-ivory, Plan powder-blue haze,
// Cleo violet silk, Bills pearl sage, Me blush dawn. `art` is the slot for
// the tab's background artwork (set --hn-art-<tab>-<theme> to a url()).
type PageAtmos = { a: string; b: string; top: string; bottom: string };
const PAGE: Record<"light" | "dark", Record<string, PageAtmos>> = {
  light: {
    today: { a: "rgba(207,190,230,0.70)", b: "rgba(245,222,213,0.45)", top: "#FBF8F4", bottom: "#F3EDE6" },
    plan:  { a: "rgba(182,208,236,0.65)", b: "rgba(214,201,232,0.35)", top: "#F8F9FA", bottom: "#EEF1F3" },
    cleo:  { a: "rgba(200,176,232,0.75)", b: "rgba(232,214,244,0.55)", top: "#FAF6FB", bottom: "#F1EAF4" },
    bills: { a: "rgba(190,215,184,0.60)", b: "rgba(236,232,220,0.60)", top: "#F8F8F3", bottom: "#EEF0E8" },
    me:    { a: "rgba(244,196,184,0.60)", b: "rgba(220,200,236,0.45)", top: "#FCF6F3", bottom: "#F5EBE6" },
  },
  dark: {
    today: { a: "rgba(120,80,170,0.45)", b: "rgba(80,50,90,0.35)", top: "#1B1630", bottom: "#120F1D" },
    plan:  { a: "rgba(60,100,160,0.45)", b: "rgba(90,70,140,0.30)", top: "#161A2E", bottom: "#100F1C" },
    cleo:  { a: "rgba(140,90,200,0.50)", b: "rgba(100,60,140,0.40)", top: "#1C1532", bottom: "#120E1E" },
    bills: { a: "rgba(60,120,95,0.40)", b: "rgba(90,60,90,0.30)", top: "#151C22", bottom: "#100F1A" },
    me:    { a: "rgba(170,90,110,0.42)", b: "rgba(110,70,130,0.32)", top: "#1E1426", bottom: "#130E1B" },
  },
};
export const TAB_ATMOS = ["today", "plan", "cleo", "bills", "me"] as const;

// The tab backgrounds from the Wisteria Luxe artwork (public/backgrounds,
// compressed WebP). Drawn behind live text and controls, never with UI in them.
export const TAB_ART: Record<typeof TAB_ATMOS[number], { light: string; dark: string }> = {
  today: { light: "today-wisteria-glow", dark: "today-midnight-wisteria" },
  plan:  { light: "plan-blue-haze",      dark: "plan-midnight-blue-haze" },
  cleo:  { light: "cleo-wisteria-ribbon", dark: "cleo-midnight-ribbon" },
  bills: { light: "bills-sage-glow",     dark: "bills-midnight-sage" },
  me:    { light: "me-blush-dawn",       dark: "me-midnight-blush" },
};
// A soft veil under the page title so the wisteria never fights the words.
const PAGE_SCRIM = {
  light: "radial-gradient(75% 26% at 18% 9%, rgba(248,244,240,0.78) 0%, rgba(248,244,240,0.45) 55%, rgba(248,244,240,0) 100%)",
  dark:  "radial-gradient(75% 26% at 18% 9%, rgba(21,18,34,0.70) 0%, rgba(21,18,34,0.40) 55%, rgba(21,18,34,0) 100%)",
};

// ─── Theme CSS ────────────────────────────────────────────────────
// The variables behind T, ATMOS, SHADOWS and GRAIN for both themes.
// Midnight follows the phone's appearance unless the person picked a
// theme in Settings (html[data-theme="light" | "dark"]).
function themeVars(mode: "light" | "dark"): string {
  const light = mode === "light";
  const out: string[] = [];
  for (const [k, val] of Object.entries(PALETTES[mode])) out.push(`--hn-${k}:${val}`);
  for (const [k, val] of Object.entries(light ? SHADOW_LIGHT : SHADOW_DARK)) out.push(`--hn-shadow-${k}:${val}`);
  for (const n of tintNames) {
    for (const [k, val] of Object.entries(atmosVars((light ? AT_LIGHT : AT_DARK)[n], light))) out.push(`--hn-at-${n}-${k}:${val}`);
  }
  out.push(`--hn-at-text2:${AT_TEXT2[mode]}`);
  out.push(`--hn-grain:${light ? grain(0.25, 0.2, 0.3, 0.55) : grain(0.85, 0.8, 0.95, 0.5)}`);
  out.push(`--hn-grain-opacity:${light ? "0.07" : "0.09"}`);
  for (const [tab, p] of Object.entries(PAGE[mode])) {
    out.push(`--hn-page-${tab}-a:${p.a}`, `--hn-page-${tab}-b:${p.b}`, `--hn-page-${tab}-top:${p.top}`, `--hn-page-${tab}-bottom:${p.bottom}`);
    out.push(`--hn-page-${tab}-art:var(--hn-art-${tab}-${mode}, none)`);
  }
  out.push(`--hn-page-scrim:${PAGE_SCRIM[mode]}`);
  out.push(`color-scheme:${mode}`);
  return out.join(";");
}
export function themeCss(): string {
  const tabSel = TAB_ATMOS.map(t => `:root[data-tab="${t}"]{--hn-page-a:var(--hn-page-${t}-a);--hn-page-b:var(--hn-page-${t}-b);--hn-page-top:var(--hn-page-${t}-top);--hn-page-bottom:var(--hn-page-${t}-bottom);--hn-page-art:var(--hn-page-${t}-art)}`).join("");
  const art = TAB_ATMOS.map(t => `--hn-art-${t}-light:url(/backgrounds/${TAB_ART[t].light}.webp);--hn-art-${t}-dark:url(/backgrounds/${TAB_ART[t].dark}.webp)`).join(";");
  return `:root{${art};${themeVars("light")};--hn-page-a:var(--hn-page-today-a);--hn-page-b:var(--hn-page-today-b);--hn-page-top:var(--hn-page-today-top);--hn-page-bottom:var(--hn-page-today-bottom);--hn-page-art:var(--hn-page-today-art)}`
    + `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${themeVars("dark")}}}`
    + `:root[data-theme="dark"]{${themeVars("dark")}}`
    + tabSel;
}
