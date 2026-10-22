import { describe, it, expect } from "vitest";
import { T } from "./theme";

// WCAG 2.x relative-luminance contrast. Pins the palette: taupe regressed to
// 3.1:1 once (small text everywhere) — this suite makes that impossible to
// reintroduce silently.
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

const AA = 4.5; // normal-size text

describe("theme contrast (WCAG AA)", () => {
  const lightBgs: Array<[string, string]> = [["ivory", T.ivory], ["cream", T.cream], ["white", "#FFFFFF"]];

  it.each(lightBgs)("taupe body/label text passes on %s", (_n, bg) => {
    expect(ratio(T.taupe, bg)).toBeGreaterThanOrEqual(AA);
  });

  it.each(lightBgs)("goldText passes on %s", (_n, bg) => {
    expect(ratio(T.goldText, bg)).toBeGreaterThanOrEqual(AA);
  });

  it.each(lightBgs)("primary text (espresso) passes on %s", (_n, bg) => {
    expect(ratio(T.esp, bg)).toBeGreaterThanOrEqual(AA);
  });

  // Wisteria brief: the four verified pairs.
  it("Wisteria pairs from the brief pass (indigo on ivory, white on violet, indigo on lavender and sage)", () => {
    expect(ratio(T.text, T.bg)).toBeGreaterThanOrEqual(9.5);
    expect(ratio("#FFFFFF", T.action)).toBeGreaterThanOrEqual(7);
    expect(ratio(T.text, T.cleoBg)).toBeGreaterThanOrEqual(7);
    expect(ratio(T.text, T.householdBg)).toBeGreaterThanOrEqual(7);
  });

  it("light lavender (wisteria) is a background only, never small text on ivory", () => {
    expect(ratio(T.wisteria, T.bg)).toBeLessThan(AA);
  });

  it.each([
    ["Cleo ink on lavender", T.action, T.cleoBg],
    ["household ink on sage", T.householdInk, T.householdBg],
    ["personal ink on blush", T.personalInk, T.personalBg],
    ["plan ink on pale blue", T.planInk, T.planBg],
    ["danger on danger tint", T.danger, T.dangerBg],
    ["warning on warning tint", T.warn, T.warnBg],
    ["secondary text on ivory", T.text2, T.bg],
    ["secondary text on lavender", T.text2, T.cleoBg],
  ])("%s passes AA", (_n, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  it("white text passes on indigo (dark surfaces)", () => {
    expect(ratio("#FFFFFF", T.esp)).toBeGreaterThanOrEqual(AA);
  });
});

// Atmosphere cards: text must pass on the darkest point of each card, which
// is the colored glow laid over the darker gradient stop.
import { ATMOS, ATMOS_DARKEST, ATMOS_TEXT2 } from "./theme";
function blend(rgba: string, hex: string): string {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgba)!;
  const a = Number(m[4]);
  const h = hex.replace("#", "");
  return "#" + [1, 2, 3].map((k, i) => {
    const bg = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return Math.round(Number(m[k]) * a + bg * (1 - a)).toString(16).padStart(2, "0");
  }).join("");
}
describe("atmosphere cards (WCAG AA)", () => {
  it.each(Object.keys(ATMOS) as (keyof typeof ATMOS)[])("%s: indigo, supporting text and the area's ink all pass", k => {
    const darkest = blend(ATMOS[k].glow, ATMOS_DARKEST[k]);
    expect(ratio(T.text, darkest)).toBeGreaterThanOrEqual(7);
    expect(ratio(ATMOS_TEXT2, darkest)).toBeGreaterThanOrEqual(AA);
    expect(ratio(ATMOS[k].ink, darkest)).toBeGreaterThanOrEqual(AA);
  });
});
