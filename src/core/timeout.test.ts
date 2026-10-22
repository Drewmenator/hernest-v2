import { describe, it, expect, vi } from "vitest";
import { withTimeout, TIMED_OUT } from "./timeout";

describe("withTimeout", () => {
  it("returns the value when it arrives in time", async () => {
    await expect(withTimeout(Promise.resolve(5), 100)).resolves.toBe(5);
  });
  it("gives up with the fallback when the call never answers", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 1000, "fallback");
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBe("fallback");
    vi.useRealTimers();
  });
  it("turns a failure into the fallback (or TIMED_OUT) instead of throwing", async () => {
    await expect(withTimeout(Promise.reject(new Error("x")), 100)).resolves.toBe(TIMED_OUT);
  });
});
