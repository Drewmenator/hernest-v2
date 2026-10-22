// Render checks for the new Wellness and Style screens with data saved by the
// OLD versions, so existing users don't hit a blank or broken screen.
import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { todayLocal } from "../../core/dateAwareness";

const setActiveTab = vi.fn();
vi.mock("../../core/store", () => {
  const state = { user: { uid: "u1" }, profile: { name: "Amy", city: "" }, setActiveTab: (t: string) => setActiveTab(t) };
  const useStore = Object.assign(() => state, { getState: () => state });
  return { useStore };
});
vi.mock("../../core/firebase", () => ({ loadData: vi.fn(), saveData: vi.fn(() => Promise.resolve()) }));
vi.mock("../../core/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../core/events", () => ({ bus: { publish: vi.fn(() => Promise.resolve()) } }));
vi.mock("../../core/ai", () => ({ ai: vi.fn() }));
vi.mock("../../core/upcomingEvents", () => ({ loadUpcomingEvents: vi.fn(() => Promise.resolve([])) }));
vi.mock("../../core/appleHealth", () => ({ appleHealthSupported: () => false, appleHealthNeedsUpgrade: () => Promise.resolve(false) }));
vi.mock("../../core/wellnessAutoTrack", () => ({ autoTrackWellness: vi.fn(() => Promise.resolve({ wearable: null, sleepLogged: false, moveDone: false })) }));
vi.mock("../../core/thriveCheckin", () => ({ generateCheckin: vi.fn(() => Promise.resolve("I don't have your night's data yet.")) }));
vi.mock("../style/styleWeather", () => ({ weatherForOutfit: vi.fn(() => Promise.resolve({ temp: 54, feelsLike: 52, condition: "Light rain", icon: "🌧", humidity: 80, windSpeed: 5, unit: "F" })) }));

import { loadData, saveData } from "../../core/firebase";
import { ai } from "../../core/ai";
import { ThriveScreen } from "./ThriveScreen";
import { StyleScreen } from "../style/StyleScreen";
import { CLEO_PREFILL_KEY } from "../../shared/utils/openCleo";

afterEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear(); });
const today = todayLocal();

describe("Wellness screen", () => {
  it("opens on an old thrive doc, logs mood in the shared format, and hands off to Cleo", async () => {
    (loadData as Mock).mockResolvedValue({
      moodLog: [{ date: "2026-01-02", rating: 9, label: "Good" }],
      habits: [{ id: "water", name: "Drink 8 glasses", done: false, streak: 3 }],
      score: { score: 7 }, sleepLog: [],
    });
    render(<ThriveScreen />);
    await screen.findByText("I don't have your night's data yet.");
    // Old habits stay hidden: small habits are off until she picks some
    expect(screen.queryByText("Drink 8 glasses")).toBeNull();
    expect(screen.queryByText(/Weekly Score/i)).toBeNull();
    expect(screen.getByText("+ Add small habits (optional)")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Feeling Good"));
    await waitFor(() => expect(saveData).toHaveBeenCalled());
    const [, coll, data] = (saveData as Mock).mock.calls[0];
    expect(coll).toBe("thrive");
    expect(data.moodLog[1]).toMatchObject({ date: today, rating: 9, label: "Good", value: 4 });

    fireEvent.click(screen.getByText("7,000 steps a day"));
    await screen.findByText("I moved today");
    fireEvent.click(screen.getByText("Ask Cleo about this"));
    expect(setActiveTab).toHaveBeenCalledWith("cleo");
    expect(sessionStorage.getItem(CLEO_PREFILL_KEY)).toContain("7,000 steps a day");
  });
});

describe("Style screen", () => {
  const look = (headline: string, items: string[]) => ({ text: JSON.stringify({ headline, pieces: items.map(item => ({ item, note: "" })), why: "Rain later.", tip: null, backup: "Leggings, long tee, sneakers" }) });

  it("opens on today's look from an old doc, with only size, style words and budget to set", async () => {
    (loadData as Mock).mockResolvedValue({
      vibe: "Smart casual", budget: "Mid-range", size: "8", bodyShape: "Pear",
      saved: [{ id: "o1", occasion: "work", savedAt: 1, rec: { outfit: { top: { name: "White shirt" } } } }],
      wishlist: [{ id: "w1", name: "Trench coat", category: "Clothing", addedAt: 1 }],
    });
    (ai as Mock).mockResolvedValue(look("Dark jeans, cream knit, rain jacket", ["Dark jeans", "Cream knit", "Rain jacket"]));
    render(<StyleScreen />);
    await screen.findByText("Dark jeans, cream knit, rain jacket");
    const prompt = (ai as Mock).mock.calls[0][1] as string;
    expect(prompt).toContain("54°F and light rain");
    expect(prompt).toContain("Nothing on her calendar");
    expect(prompt).not.toContain("Pear");
    expect(screen.getByText(/Size 8 \(old entry, pick a US size\) · Casual, Polished/)).toBeTruthy();
    // trimmed: no saved looks gallery, wish list or body shape question
    expect(screen.queryByText(/Saved looks/)).toBeNull();
    expect(screen.queryByText(/Want to buy/)).toBeNull();
    expect(screen.queryByText(/body shape/i)).toBeNull();
    // the backup only shows in "Dress me for..."
    expect(screen.queryByText(/Or keep it simple/)).toBeNull();
  });

  it("Wear this, Don't have that and Dressier teach Cleo and change the next idea", async () => {
    (loadData as Mock).mockResolvedValue({ styleWords: ["Classic"] });
    (ai as Mock).mockResolvedValue(look("Dark jeans, cream knit, ankle boots", ["Dark jeans", "Cream knit", "Ankle boots"]));
    render(<StyleScreen />);
    await screen.findByText("Dark jeans, cream knit, ankle boots");

    fireEvent.click(screen.getByText("Wear this"));
    await screen.findByText("✓ Wearing this today");
    const lastMemory = () => {
      const saves = (saveData as Mock).mock.calls.filter(([, coll, d]) => coll === "style" && d.memory);
      return saves[saves.length - 1][2].memory;
    };
    expect(lastMemory().liked).toEqual(["Dark jeans, cream knit, ankle boots"]);

    fireEvent.click(screen.getByText("Don't have that"));
    fireEvent.click(screen.getByRole("button", { name: "Ankle boots" }));
    await waitFor(() => expect((ai as Mock).mock.calls.length).toBe(2));
    expect(lastMemory().notOwned).toEqual(["Ankle boots"]);
    expect((ai as Mock).mock.calls[1][1]).toContain("She doesn't own these, so never suggest them: Ankle boots.");

    await screen.findByText("Dressier");
    fireEvent.click(screen.getByText("Dressier"));
    await waitFor(() => expect((ai as Mock).mock.calls.length).toBe(3));
    expect((ai as Mock).mock.calls[2][1]).toContain("Make it a step dressier than:");
  });

  it("Dress me for... takes a typed occasion, checks it like any typed text, and shows a backup", async () => {
    (loadData as Mock).mockResolvedValue({});
    (ai as Mock).mockResolvedValue(look("Linen dress, flat sandals, wrap", ["Linen dress", "Flat sandals", "Wrap"]));
    render(<StyleScreen />);
    await screen.findByText("Linen dress, flat sandals, wrap");
    fireEvent.change(screen.getByPlaceholderText("e.g. beach wedding Saturday"), { target: { value: "beach wedding Saturday" } });
    fireEvent.click(screen.getByText("Go"));
    await screen.findByText(/Or keep it simple/);
    const [, prompt, , , opts] = (ai as Mock).mock.calls[1];
    expect(prompt).toContain("Outfit for: beach wedding Saturday.");
    expect(opts.userText).toBe("beach wedding Saturday");
    expect(screen.getByText("For beach wedding Saturday")).toBeTruthy();
  });
});
