// The body card for Apple Health users: what they measured, nothing invented.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThriveVitals } from "./ThriveVitals";
import type { WearableDay } from "../../core/wellnessAutoTrack";

afterEach(cleanup);

const day = (d: string, hrv: number, rhr: number, sleep: number, steps: number) =>
  ({ day: d, sleepHours: sleep, sleepScore: null, readiness: null, hrv, restingHr: rhr, steps, stressDay: null });

const apple: WearableDay = {
  source: "apple_health", date: "2026-10-21",
  sleepHours: 7.4, sleepScore: null, readiness: null, steps: 6100,
  avgHrv: 38, restingHr: 61, readinessContributors: null,
  stressDay: null, stressHighMins: null, recoveryHighMins: null,
  activeCalories: null, sedentaryMins: null, activityScore: null,
  activeMins: 34, mindfulMins: 10,
  history: [day("2026-10-17", 50, 60, 7, 7000), day("2026-10-18", 48, 62, 6.8, 5000), day("2026-10-19", 52, 60, 7.5, 8000), day("2026-10-20", 50, 61, 7.1, 6500)],
};

describe("body card for Apple Health", () => {
  it("leads with last night's sleep, shows heart data against her usual, and hides Oura-only scores", () => {
    render(<ThriveVitals w={apple} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText("Sleep last night")).toBeTruthy();
    expect(screen.getByText("Well rested")).toBeTruthy();
    expect(screen.queryByText("Readiness today")).toBeNull();
    expect(screen.queryByText("Stress")).toBeNull();
    expect(screen.queryByText("Readiness")).toBeNull();
    expect(screen.getByText("below your usual")).toBeTruthy(); // HRV 38 vs usual 50
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Mindful")).toBeTruthy();
    expect(screen.getAllByText("Resting HR")).toHaveLength(2); // tile + 7-day trend
    expect(screen.getByText("Last 7 days")).toBeTruthy();
  });

  it("shows her usual in the detail and says where the data came from", () => {
    render(<ThriveVitals w={apple} expanded onToggle={() => {}} />);
    expect(screen.getByText("50 ms")).toBeTruthy();
    expect(screen.getByText(/From your Apple Health/)).toBeTruthy();
  });

  it("an iPhone without a Watch only shows sleep and steps", () => {
    const phoneOnly: WearableDay = { ...apple, avgHrv: null, restingHr: null, activeMins: null, mindfulMins: null, history: [] };
    render(<ThriveVitals w={phoneOnly} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText("Sleep")).toBeTruthy();
    expect(screen.getByText("Steps")).toBeTruthy();
    expect(screen.queryByText("HRV")).toBeNull();
    expect(screen.queryByText("Last 7 days")).toBeNull();
    fireEvent.click(screen.getByLabelText("Body detail"));
  });

  it("Oura keeps its readiness view", () => {
    render(<ThriveVitals w={{ ...apple, source: "oura", readiness: 82, sleepScore: 80, stressDay: "normal", activityScore: 70 }} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText("Readiness today")).toBeTruthy();
    expect(screen.getByText("Stress")).toBeTruthy();
    expect(screen.queryByText("Mindful")).toBeNull();
  });
});
