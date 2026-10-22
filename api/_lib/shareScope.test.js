import { describe, it, expect } from "vitest";
import { safeShareCategories } from "./shareScope.js";

describe("partner share scope", () => {
  it("keeps household categories", () => {
    expect(safeShareCategories(["tasks", "calendar", "bills"])).toEqual(["tasks", "calendar", "bills"]);
  });
  it("drops private and unknown categories, whatever the invite asks for", () => {
    expect(safeShareCategories(["thrive", "cleo_memory_v2", "profile", "subscription", "push_state", "../x", "tasks"])).toEqual(["tasks"]);
  });
  it("handles junk", () => {
    expect(safeShareCategories(null)).toEqual([]);
    expect(safeShareCategories([1, {}, "tasks", "tasks"])).toEqual(["tasks"]);
  });
});
