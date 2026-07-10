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

  it("raw gold must NOT be used as small text on light backgrounds", () => {
    // Documents the constraint: gold is an accent/icon color. If this ever
    // "passes", the brand gold changed dramatically — review all usages.
    expect(ratio(T.gold, T.ivory)).toBeLessThan(AA);
  });

  it("white text passes on espresso (dark cards)", () => {
    expect(ratio("#FFFFFF", T.esp)).toBeGreaterThanOrEqual(AA);
  });
});
