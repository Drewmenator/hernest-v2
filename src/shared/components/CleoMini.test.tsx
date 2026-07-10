import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// jsdom has no scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// CleoMini must use the ORCHESTRATOR (context, validation, crisis, memory
// governance) — it used to call the raw model with its own thin prompt.
vi.mock("../../core/aiOrchestrator", () => ({ askCleo: vi.fn() }));
vi.mock("../../core/store", () => ({
  useStore: () => ({
    user: { uid: "u1", email: "t@t.t", displayName: "Test" },
    profile: { name: "Andrew" },
    activeTab: "home",
  }),
}));

import { askCleo } from "../../core/aiOrchestrator";
import { CleoMini } from "./CleoMini";

beforeEach(() => (askCleo as Mock).mockReset());
afterEach(cleanup);

async function openAndSend(text: string) {
  render(<CleoMini />);
  fireEvent.click(screen.getByLabelText("Chat with Cleo"));
  const input = await screen.findByPlaceholderText("Ask Cleo anything...");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByLabelText("Send message"));
}

describe("CleoMini", () => {
  it("routes messages through the orchestrator", async () => {
    (askCleo as Mock).mockResolvedValue("Here's your day, sorted.");
    await openAndSend("what's most urgent?");
    await waitFor(() => expect(askCleo).toHaveBeenCalledWith(
      "u1", expect.anything(), "what's most urgent?", expect.any(Array)
    ));
    expect(await screen.findByText("Here's your day, sorted.")).toBeTruthy();
  });

  it("strips TASKS_JSON payloads (no approval UI in the widget)", async () => {
    (askCleo as Mock).mockResolvedValue('I can help with that.\nTASKS_JSON:[{"title":"x"}]');
    await openAndSend("remind me to call the school");
    expect(await screen.findByText("I can help with that.")).toBeTruthy();
    expect(screen.queryByText(/TASKS_JSON/)).toBeNull();
  });

  it("answers a crisis message with helplines WITHOUT calling the AI", async () => {
    await openAndSend("I don't want to be here anymore");
    expect(await screen.findByText(/Samaritans/)).toBeTruthy();
    expect(askCleo).not.toHaveBeenCalled();
  });

  it("shows a gentle fallback when the orchestrator returns nothing", async () => {
    // (A thrown error takes the same path — vitest 4's cross-file unhandled-
    // error collector misattributes sync mock throws, so we assert the
    // user-visible fallback via the empty-response branch.)
    (askCleo as Mock).mockResolvedValue("");
    await openAndSend("hello hello");
    expect(await screen.findByText("I'm having a moment — try again.")).toBeTruthy();
  });
});
