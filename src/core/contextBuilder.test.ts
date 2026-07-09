import { describe, it, expect, vi } from "vitest";

// contextBuilder pulls in Firebase at module level — stub the data layer
vi.mock("./firebase", () => ({ loadData: vi.fn(), db: {}, auth: {} }));
vi.mock("./memory", () => ({ buildMemoryContext: vi.fn(), loadMemoryFacts: vi.fn() }));
vi.mock("./memoryServiceV2", () => ({ buildMemoryContextV2: vi.fn() }));
vi.mock("./household/HouseholdIntelligence", () => ({ buildHouseholdSnapshot: vi.fn() }));

import { TONE_PROFILES, FOCUS_WORD_POOL, selectFocusWord, type ToneProfile } from "./contextBuilder";

describe("TONE_PROFILES", () => {
  it("defines all four tones with complete config", () => {
    for (const tone of ["thriving", "steady", "tired", "struggling"] as const) {
      expect(TONE_PROFILES[tone].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(TONE_PROFILES[tone].affirmationTheme).toBeTruthy();
      expect(TONE_PROFILES[tone].label).toBeTruthy();
    }
  });
});

describe("selectFocusWord", () => {
  const expectedPool: Record<ToneProfile, string[]> = {
    thriving:   FOCUS_WORD_POOL.growth,
    steady:     FOCUS_WORD_POOL.balance,
    tired:      FOCUS_WORD_POOL.calm,
    struggling: FOCUS_WORD_POOL.strength,
  };

  it.each(Object.keys(expectedPool) as ToneProfile[])("picks from the right pool for %s", (tone) => {
    for (let i = 0; i < 20; i++) {
      const { word, emoji } = selectFocusWord(tone);
      expect(expectedPool[tone]).toContain(word);
      expect(emoji).toBeTruthy();
    }
  });
});
