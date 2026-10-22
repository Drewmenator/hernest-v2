import { describe, it, expect } from "vitest";
import { isFiller, cleanBriefing } from "./briefingFilter";

describe("isFiller", () => {
  it("catches generic family-time advice", () => {
    for (const t of [
      "Spend 15 minutes with your son after school",
      "Spend 10-15 minutes with Liam before bed",
      "Carve out some quality time with the kids",
      "One-on-one time with Maya tonight",
      "Connect with your daughter at dinner",
      "Spend a few moments with the family",
    ]) expect(isFiller(t), t).toBe(true);
  });
  it("catches asks to log things in the app", () => {
    for (const t of ["Log your sleep", "Log last night's sleep in Thrive", "Track your mood today", "Record your water", "Add today's habits"]) {
      expect(isFiller(t), t).toBe(true);
    }
  });
  it("keeps real items, including ones that mention kids or sleep", () => {
    for (const t of [
      "Sign Liam's field trip permission slip",
      "Pay the electric bill ($142) due today",
      "Dentist at 3:00 PM with Maya",
      "Pick up the kids at 3:15",
      "You slept 5.8h, so keep the afternoon light",
      "Call the pediatrician to book Liam's checkup",
      "Order Mom's birthday gift",
    ]) expect(isFiller(t), t).toBe(false);
  });
});

describe("cleanBriefing", () => {
  it("drops filler priorities and re-numbers the rest", () => {
    const b = cleanBriefing({
      priorities: [
        { rank: 1, text: "Pay the electric bill", whyToday: "Due today" },
        { rank: 2, text: "Spend 15 minutes with your son", whyToday: "Connection matters" },
        { rank: 3, text: "Log your sleep", whyToday: "Helps Cleo" },
        { rank: 4, text: "Sign the permission slip", whyToday: "Due Friday" },
      ],
      tasks: { aiSuggestion: "Track your mood after lunch", completionNote: "2 of 5 done" },
      energy: { tip: "Log your sleep tonight", scheduleSuggestion: "Do the hardest task before noon" },
    });
    expect(b.priorities!.map(p => [p.rank, p.text])).toEqual([[1, "Pay the electric bill"], [2, "Sign the permission slip"]]);
    expect(b.tasks).toEqual({ aiSuggestion: "", completionNote: "2 of 5 done" });
    expect(b.energy).toEqual({ tip: "", scheduleSuggestion: "Do the hardest task before noon" });
  });
});
