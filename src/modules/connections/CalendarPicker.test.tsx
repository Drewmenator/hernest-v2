// Choose calendars: shows own vs shared, saves the ticks, then re-syncs.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const { saveCalendarChoice, syncAllConnectors } = vi.hoisted(() => ({
  saveCalendarChoice: vi.fn<(...a: unknown[]) => Promise<void>>(async () => {}),
  syncAllConnectors: vi.fn<(...a: unknown[]) => Promise<void>>(async () => {}),
}));
vi.mock("../../core/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "tok" } }, clearDataCaches: vi.fn() }));
vi.mock("../../core/calendarChoice", () => ({ isPicked: vi.fn(), loadCalendarChoice: vi.fn(async () => ({})), saveCalendarChoice }));
vi.mock("../../core/connectorSync", () => ({ syncAllConnectors }));
vi.mock("react-hot-toast", () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
import { CalendarPicker } from "./CalendarPicker";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("CalendarPicker", () => {
  it("lists Google calendars, saves the choice and re-syncs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ calendars: [
      { id: "me", name: "Andrew", color: "#00f", own: true, picked: true },
      { id: "col", name: "Sam (work)", color: "#f00", own: false, picked: false },
    ] }) })));
    render(<CalendarPicker uid="u1" source="google" />);
    fireEvent.click(screen.getByRole("button", { name: /choose calendars/i }));
    const colleague = await screen.findByRole("checkbox", { name: /sam \(work\)/i });
    expect((colleague as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /andrew/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/shared with you/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /andrew/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(syncAllConnectors).toHaveBeenCalledWith("u1", true));
    expect(saveCalendarChoice).toHaveBeenCalledWith("u1", "google", [{ id: "me", picked: false }, { id: "col", picked: false }]);
  });

  it("says so when the calendars can't be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<CalendarPicker uid="u1" source="google" />);
    fireEvent.click(screen.getByRole("button", { name: /choose calendars/i }));
    expect(await screen.findByText(/couldn't load your calendars/i)).toBeTruthy();
  });
});
