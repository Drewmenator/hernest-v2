import { describe, it, expect, vi } from "vitest";

vi.mock("../shared/utils/money", () => ({ getCurrency: () => "USD" }));
import { detectCrisis, crisisCountry, crisisResponse } from "./crisis";

describe("crisis", () => {
  it("catches common ways of expressing distress", () => {
    for (const msg of ["I want to die", "thinking about self-harm", "I can't go on", "they'd be better off without me", "I want to end it all"]) {
      expect(detectCrisis(msg)).toBe(true);
    }
    expect(detectCrisis("this traffic is killing me")).toBe(false);
  });

  it("picks helplines from the device locale, then the currency", () => {
    expect(crisisCountry("en-GB", "USD")).toBe("GB");
    expect(crisisCountry("en", "CAD")).toBe("CA");
    expect(crisisCountry("yo-NG", "NGN")).toBe(null);
  });

  it("shows local numbers, or the international directory", () => {
    expect(crisisResponse("en-GB", "GBP")).toContain("Samaritans");
    expect(crisisResponse("en-US", "USD")).toContain("988");
    expect(crisisResponse("yo-NG", "NGN")).toContain("findahelpline.com");
  });
});
