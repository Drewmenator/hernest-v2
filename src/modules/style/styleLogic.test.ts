import { describe, it, expect, vi } from "vitest";

vi.mock("../../core/firebase", () => ({ loadData: vi.fn() }));
import {
  occasionFor, occasionForDay, comingUp, weatherLine, formatTime, dayLine, whenLabel,
  readStyleProfile, profileLine, buildOutfitPrompt, parseOutfit, lookView, occasionLabel,
} from "./styleLogic";
import { eventsInWindow } from "../../core/upcomingEvents";

const WED = "2026-10-21";
const ev = (title: string, date = WED, time?: string) => ({ id: title, title, date, ...(time ? { time } : {}) });

describe("occasions from calendar titles", () => {
  it("recognizes the common ones", () => {
    expect(occasionFor("Sarah's wedding")).toBe("special");
    expect(occasionFor("Emma's recital")).toBe("special");
    expect(occasionFor("Date night with Mike")).toBe("date");
    expect(occasionFor("Jake's birthday party")).toBe("kids");
    expect(occasionFor("2pm client call")).toBe("work");
    expect(occasionFor("Yoga")).toBe("workout");
  });
  it("ignores logistics", () => {
    expect(occasionFor("School run")).toBeNull();
    expect(occasionFor("Soccer practice")).toBeNull();
    expect(occasionFor("Call dentist")).toBeNull();
    expect(occasionFor("Electric bill due")).toBeNull();
    expect(occasionFor("Groceries")).toBeNull();
  });
  it("lets the dressiest event set the day", () => {
    expect(occasionForDay([ev("School run"), ev("Team meeting"), ev("Anniversary dinner at Luigi's")])).toBe("date");
    expect(occasionForDay([ev("Pick up Emma")])).toBeNull();
  });
});

describe("coming up", () => {
  it("lists only future events worth dressing for, in order", () => {
    const list = comingUp([
      ev("Team meeting", WED), ev("Dentist", "2026-10-22"), ev("Emma's recital", "2026-10-24"),
      ev("Gym", "2026-10-23"), ev("Halloween party", "2026-10-25"),
    ], WED);
    expect(list.map(e => [e.title, e.occasion])).toEqual([["Emma's recital", "special"], ["Halloween party", "kids"]]);
  });
});

describe("eventsInWindow", () => {
  it("dedupes across sources, keeps the window, sorts by day and time", () => {
    const list = eventsInWindow([
      { id: "a", title: "Recital", date: "2026-10-24", time: "18:00" },
      { id: "b", title: "recital ", date: "2026-10-24", time: "18:00" },
      { id: "c", title: "Work call", date: WED, time: "9:30" },
      { id: "d", title: "Old", date: "2026-10-20" },
      { id: "e", title: "Too far", date: "2026-10-28" },
      { id: "f", title: "All day", date: "2026-10-21T00:00:00" },
      null, { title: 5, date: WED },
    ], WED, 7);
    expect(list).toEqual([
      { id: "f", title: "All day", date: WED },
      { id: "c", title: "Work call", date: WED, time: "09:30" },
      { id: "a", title: "Recital", date: "2026-10-24", time: "18:00" },
    ]);
  });
});

describe("words", () => {
  it("describes weather plainly", () => {
    expect(weatherLine({ temp: 54, feelsLike: 52, condition: "Light rain", icon: "", humidity: 80, windSpeed: 5, unit: "F" })).toBe("54°F and light rain");
    expect(weatherLine({ temp: 30, feelsLike: 22, condition: "Snow", icon: "", humidity: 80, windSpeed: 15, unit: "F" })).toBe("30°F and snow, feels like 22°");
    expect(weatherLine(null)).toBe("");
  });
  it("formats times and the day the US way", () => {
    expect(formatTime("14:00")).toBe("2pm");
    expect(formatTime("09:30")).toBe("9:30am");
    expect(formatTime("00:15")).toBe("12:15am");
    expect(dayLine([ev("School run", WED, "08:00"), ev("Work call", WED, "14:00"), ev("Soccer"), ev("Dinner")])).toBe("8am School run, 2pm Work call, Soccer +1 more");
    expect(whenLabel("2026-10-22", WED)).toBe("Tomorrow");
    expect(whenLabel("2026-10-24", WED)).toBe("Saturday");
    expect(whenLabel("2026-11-05", WED)).toBe("Nov 5");
  });
});

describe("style profile", () => {
  it("reads the old doc (vibe + budget words)", () => {
    const p = readStyleProfile({ vibe: "Smart casual", budget: "Premium", size: "8", bodyShape: "Pear", dressCode: "Formal" });
    expect(p).toEqual({ size: "8", words: ["Casual", "Polished"], budget: 200, bodyShape: "Pear", height: "" });
  });
  it("prefers the new fields", () => {
    const p = readStyleProfile({ vibe: "Edgy cool", styleWords: ["Classic"], budget: "Luxury", budgetAmount: 75, size: "M / 8-10" });
    expect(p.words).toEqual(["Classic"]);
    expect(p.budget).toBe(75);
    expect(profileLine(p, n => `$${n}`)).toBe("US M / 8-10 · Classic · about $75 an outfit");
  });
  it("copes with an empty doc", () => {
    expect(readStyleProfile(null)).toEqual({ size: "", words: [], budget: null, bodyShape: "", height: "" });
  });
});

describe("outfit prompt + answer", () => {
  const profile = { size: "M / 8-10", words: ["Classic"], budget: 100, bodyShape: "", height: "" };
  it("fills in today from weather and calendar, nothing typed", () => {
    const prompt = buildOutfitPrompt({ weather: "54°F and light rain", events: [ev("School run", WED, "08:00"), ev("Work call", WED, "14:00")], occasion: "work", profile, currencyCode: "USD", avoid: [] });
    expect(prompt).toContain("Her day: 8am School run, 2pm Work call.");
    expect(prompt).toContain("Weather: 54°F and light rain.");
    expect(prompt).toContain("Occasion: Work.");
    expect(prompt).toContain("US M / 8-10");
    expect(prompt).toContain("around 100 USD");
    expect(prompt).not.toContain("Body shape");
  });
  it("asks for a different idea on 'Another idea'", () => {
    const prompt = buildOutfitPrompt({ weather: "", events: [], occasion: null, profile, currencyCode: "USD", avoid: ["Jeans, knit, boots"] });
    expect(prompt).toContain("Nothing on her calendar.");
    expect(prompt).toContain("different idea from: Jeans, knit, boots");
  });
  it("plans ahead for an event", () => {
    const prompt = buildOutfitPrompt({ weather: "70°F and clear sky", events: [], occasion: "special", eventTitle: "Emma's recital", when: "Saturday", profile, currencyCode: "USD", avoid: [] });
    expect(prompt.split("\n")[0]).toBe("Outfit for: Emma's recital (Saturday).");
    expect(prompt).toContain("may differ on the day");
  });
  it("parses the answer and rejects junk", () => {
    const o = parseOutfit(JSON.stringify({ headline: "Jeans, knit", pieces: [{ item: "Dark jeans", note: "goes with all" }, { item: " " }], why: "Rain later.", tip: "" }));
    expect(o).toEqual({ headline: "Jeans, knit", pieces: [{ item: "Dark jeans", note: "goes with all" }], why: "Rain later.", tip: null });
    expect(parseOutfit("not json")).toBeNull();
    expect(parseOutfit(JSON.stringify({ headline: "x", pieces: [] }))).toBeNull();
  });
});

describe("saved looks", () => {
  it("shows new looks", () => {
    const v = lookView({ id: "1", occasion: "work", savedAt: 1, outfit: { headline: "Jeans, knit", pieces: [{ item: "Jeans", note: "" }], why: "Warm.", tip: null } });
    expect(v).toEqual({ title: "Work", headline: "Jeans, knit", lines: ["Jeans"], note: "Warm." });
  });
  it("still shows looks saved by the old stylist", () => {
    const v = lookView({ id: "2", occasion: "evening", mood: "elegant", savedAt: 1, rec: { rationale: "Works.", outfit: { top: { name: "Silk cami" }, bottom: { name: "Wide trousers" }, shoes: { name: "Block heels" }, accessories: [{ name: "Gold hoops" }], bag: null } } });
    expect(v).toEqual({ title: "Evening", headline: "Silk cami, Wide trousers, Block heels, Gold hoops", lines: ["Silk cami", "Wide trousers", "Block heels", "Gold hoops"], note: "Works." });
    expect(occasionLabel("nope")).toBe("Today");
  });
});
