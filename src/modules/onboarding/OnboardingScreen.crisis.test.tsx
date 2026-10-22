// The setup chat doesn't call the AI, but it is a chat with Cleo, so distress
// language gets the same helplines instead of the next setup question.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

vi.mock("../../core/store", () => {
  const state = { user: { uid: "u1" }, setProfile: vi.fn() };
  const useStore = Object.assign(() => state, { getState: () => state });
  return { useStore };
});
vi.mock("../../core/firebase", () => ({ saveData: vi.fn(() => Promise.resolve()) }));
vi.mock("../../shared/utils/money", () => ({ getCurrency: () => "USD" }));

import { saveData } from "../../core/firebase";
import { CleoSetupScreen } from "./OnboardingScreen";
import { CrisisSheet } from "../../shared/components/CrisisSheet";
import { showCrisisSheet } from "../../core/crisis";

Element.prototype.scrollIntoView = vi.fn();
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("setup chat crisis check", () => {
  it("shows the helplines and does not save or advance", async () => {
    vi.useFakeTimers();
    render(<CleoSetupScreen />);
    act(() => { vi.advanceTimersByTime(1500); });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "I want to die" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText(/988 Suicide and Crisis Lifeline/)).toBeTruthy();
    expect(screen.getByText(/911/)).toBeTruthy();
    expect(saveData).not.toHaveBeenCalled();
  });
});

describe("crisis sheet", () => {
  it("opens with the helplines and tap-to-call/text 988", () => {
    render(<CrisisSheet />);
    act(() => showCrisisSheet());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Call 988" }).getAttribute("href")).toBe("tel:988");
    expect(screen.getByRole("link", { name: "Text 988" }).getAttribute("href")).toBe("sms:988");
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
