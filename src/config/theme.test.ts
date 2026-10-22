import { describe, it, expect } from "vitest";
import { PALETTES, ATMOS_SPECS, AT_TEXT2, themeCss, T, alpha } from "./theme";

// WCAG 2.x relative-luminance contrast, checked in BOTH themes (Wisteria
// Glow and Midnight Wisteria) so a palette change can't quietly drop a
// pair below AA.
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
// An rgba() laid over a hex background, as the eye sees it.
function blend(rgba: string, hex: string): string {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgba)!;
  const a = Number(m[4]);
  const h = hex.replace("#", "");
  return "#" + [1, 2, 3].map((k, i) => {
    const bg = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return Math.round(Number(m[k]) * a + bg * (1 - a)).toString(16).padStart(2, "0");
  }).join("");
}

const AA = 4.5;
const modes = ["light", "dark"] as const;

describe.each(modes)("%s theme contrast (WCAG AA)", mode => {
  const P = PALETTES[mode];
  const pages = [["page", P.bg], ["card", P.surface], ["quiet fill", P.sand]] as const;

  it.each(pages)("text, supporting text and action read on the %s", (_n, bg) => {
    expect(ratio(P.text, bg)).toBeGreaterThanOrEqual(7);
    expect(ratio(P.text2, bg)).toBeGreaterThanOrEqual(AA);
    expect(ratio(P.taupe, bg)).toBeGreaterThanOrEqual(AA);
    expect(ratio(P.bark, bg)).toBeGreaterThanOrEqual(AA);
    expect(ratio(P.goldText, bg)).toBeGreaterThanOrEqual(AA);
  });

  it("status colors used as text pass on the card", () => {
    for (const k of ["sage", "sky", "blush", "orange", "red", "teal", "danger", "warn", "yellow"] as const) {
      expect(ratio(P[k], P.surface), k).toBeGreaterThanOrEqual(AA);
    }
  });

  it("button text on the action color passes", () => {
    expect(ratio(P.onAction, P.action)).toBeGreaterThanOrEqual(AA);
    expect(ratio(P.onAction, P.actionPress)).toBeGreaterThanOrEqual(AA);
    // Selected chips are drawn in the text color with onAction text.
    expect(ratio(P.onAction, P.esp)).toBeGreaterThanOrEqual(AA);
    expect(ratio(P.onAction, P.sage)).toBeGreaterThanOrEqual(AA);
  });

  it("each area's ink reads on its own tint, and text reads on every tint", () => {
    const pairs = [["cleoBg", "action"], ["householdBg", "householdInk"], ["personalBg", "personalInk"], ["planBg", "planInk"], ["dangerBg", "danger"], ["warnBg", "warn"]] as const;
    for (const [bg, ink] of pairs) {
      expect(ratio(P[ink], P[bg]), `${ink} on ${bg}`).toBeGreaterThanOrEqual(AA);
      expect(ratio(P.text, P[bg]), `text on ${bg}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(Object.keys(ATMOS_SPECS[mode]))("atmosphere card %s: text and ink pass on its darkest/brightest point", k => {
    const sp = ATMOS_SPECS[mode][k];
    // Worst point: the colored glow laid over the far gradient stop.
    const worst = blend(sp.glow, sp.to);
    for (const bg of [worst, sp.from, sp.to]) {
      expect(ratio(P.text, bg)).toBeGreaterThanOrEqual(7);
      expect(ratio(sp.ink, bg)).toBeGreaterThanOrEqual(AA);
      expect(ratio(AT_TEXT2[mode], bg)).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe("theme plumbing", () => {
  it("T colors are CSS variables defined for both themes", () => {
    expect(T.text).toBe("var(--hn-text)");
    const css = themeCss();
    expect(css).toContain("--hn-text:#301C39");
    expect(css).toContain("--hn-text:#FCF5F4");
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain("prefers-color-scheme: dark");
  });
  it("alpha() works on variables", () => {
    expect(alpha(T.action, 0.12)).toBe("color-mix(in srgb, var(--hn-action) 12%, transparent)");
  });
});
