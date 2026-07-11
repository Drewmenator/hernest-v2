import { describe, it, expect } from "vitest";
import { formatMoney, currencySymbol, getCurrency, SUPPORTED_CURRENCIES } from "./money";

describe("currencySymbol", () => {
  it("maps known codes", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("NGN")).toBe("₦");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("eur")).toBe("€"); // case-insensitive
  });
  it("falls back to $ for unknown/empty", () => {
    expect(currencySymbol("ZZZ")).toBe("$");
    expect(currencySymbol()).toBe("$");
  });
});

describe("formatMoney", () => {
  it("formats with the given currency symbol + thousands", () => {
    expect(formatMoney(1200, "USD")).toBe("$1,200");
    expect(formatMoney(1200, "NGN")).toBe("₦1,200");
    expect(formatMoney(1500000, "NGN")).toBe("₦1,500,000");
  });
  it("rounds to whole units", () => {
    expect(formatMoney(1200.6, "USD")).toBe("$1,201");
    expect(formatMoney(1200.4, "USD")).toBe("$1,200");
  });
  it("handles zero and non-finite safely", () => {
    expect(formatMoney(0, "USD")).toBe("$0");
    expect(formatMoney(NaN as any, "USD")).toBe("$0");
  });
  it("defaults to USD when no profile currency is set (store empty in tests)", () => {
    expect(getCurrency()).toBe("USD");
    expect(formatMoney(50)).toBe("$50");
  });
});

describe("SUPPORTED_CURRENCIES", () => {
  it("includes the primary options and every code has a symbol", () => {
    const codes = SUPPORTED_CURRENCIES.map(c => c.code);
    expect(codes).toContain("USD");
    expect(codes).toContain("NGN");
    for (const c of SUPPORTED_CURRENCIES) expect(currencySymbol(c.code)).not.toBe(undefined);
  });
});
