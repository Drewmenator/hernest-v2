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
    fireEvent.click(screen.getByText("✦ Ask Cleo about this"));
    expect(setActiveTab).toHaveBeenCalledWith("cleo");
    expect(sessionStorage.getItem(CLEO_PREFILL_KEY)).toContain("7,000 steps a day");
  });
});

describe("Style screen", () => {
  it("opens straight on today's outfit using the weather, with old saved looks still readable", async () => {
    (loadData as Mock).mockResolvedValue({
      vibe: "Smart casual", budget: "Mid-range", size: "8",
      saved: [{ id: "o1", occasion: "work", mood: "polished", savedAt: 1, rec: { rationale: "Sharp.", outfit: { top: { name: "White shirt" }, shoes: { name: "Loafers" }, accessories: [] } } }],
      wishlist: [{ id: "w1", name: "Trench coat", category: "Clothing", addedAt: 1 }],
    });
    (ai as Mock).mockResolvedValue({ text: JSON.stringify({ headline: "Dark jeans, cream knit, rain jacket", pieces: [{ item: "Dark jeans", note: "easy" }], why: "Rain later.", tip: null }) });
    render(<StyleScreen />);
    await screen.findByText("Dark jeans, cream knit, rain jacket");
    const prompt = (ai as Mock).mock.calls[0][1] as string;
    expect(prompt).toContain("54°F and light rain");
    expect(prompt).toContain("Nothing on her calendar");
    expect(screen.getByText("White shirt, Loafers")).toBeTruthy();
    expect(screen.getByText(/Want to buy \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Size 8 \(old entry, pick a US size\) · Casual, Polished/)).toBeTruthy();

    fireEvent.click(screen.getByText("Something else"));
    fireEvent.click(screen.getByText(/Date night/));
    await waitFor(() => expect((ai as Mock).mock.calls.length).toBe(2));
    expect((ai as Mock).mock.calls[1][1]).toContain("Occasion: Date night.");
  });
});
