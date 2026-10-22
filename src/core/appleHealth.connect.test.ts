// Regression: "Connect Apple Health" did nothing because the plugin proxy was
// returned from an async function. Capacitor plugin proxies answer every
// property, "then" included, so JavaScript waited on them forever.
import { describe, it, expect, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" } }));
vi.mock("./firebase", () => ({ loadData: vi.fn(async () => ({ connected: true })), saveData: vi.fn(async () => {}) }));

const calls: string[] = [];
// Like a Capacitor plugin: any property is a method that returns a promise,
// including "then" (whose returned promise ignores the callbacks).
const proxyPlugin = new Proxy({}, {
  get: (_t, prop: string) => (...args: unknown[]) => {
    calls.push(prop);
    if (prop === "isAvailable") return Promise.resolve({ available: true });
    if (prop === "queryWorkouts") return Promise.resolve({ workouts: [] });
    if (prop === "then") return new Promise(() => { void args; }); // never settles
    return Promise.resolve({ samples: [] });
  },
});
vi.mock("@capgo/capacitor-health", () => ({ Health: proxyPlugin }));

import { connectAppleHealth } from "./appleHealth";

describe("Connect Apple Health", () => {
  it("reaches the permission request instead of hanging on the plugin proxy", async () => {
    const r = await Promise.race([
      connectAppleHealth("u1"),
      new Promise(res => setTimeout(() => res("hung"), 1500)),
    ]);
    expect(r).toBe("connected");
    expect(calls).toContain("isAvailable");
    expect(calls).toContain("requestAuthorization");
    expect(calls).not.toContain("then");
  });
});
