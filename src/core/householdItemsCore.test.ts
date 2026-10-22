import { describe, it, expect } from "vitest";
import { legacyItemId, changedFields, toFirestorePatch } from "./householdItemsCore";
import { markPaidOnce, undoOwnPayment, type Bill } from "./bills";

describe("legacyItemId", () => {
  it("keeps a usable id and falls back to a stable one", () => {
    expect(legacyItemId({ id: "abc" }, 0)).toBe("abc");
    expect(legacyItemId({ id: 42 }, 0)).toBe("42");
    expect(legacyItemId({}, 3)).toBe("legacy_3");
    expect(legacyItemId({ id: "a/b" }, 1)).toBe("legacy_1");
    expect(legacyItemId({ id: "__x__" }, 2)).toBe("legacy_2");
  });
});

describe("changedFields", () => {
  it("returns only what changed, removed fields as undefined", () => {
    const before = { id: "1", title: "a", due: "x", tags: [1] };
    const after = { id: "1", title: "b", tags: [1], extra: true };
    expect(changedFields(before, after)).toEqual({ title: "b", due: undefined, extra: true });
  });
  it("is empty when nothing changed", () => {
    expect(changedFields({ id: "1", a: { b: 1 } }, { id: "1", a: { b: 1 } })).toEqual({});
  });
  it("turns removed fields into deletes and never writes id", () => {
    const p = toFirestorePatch({ id: "1", a: undefined, b: 2 });
    expect(Object.keys(p).sort()).toEqual(["a", "b"]);
    expect(p.b).toBe(2);
  });
});

describe("paying once", () => {
  const now = new Date(2026, 9, 21);
  const rent: Bill = { id: "b1", name: "Rent", cadence: "monthly", dueDay: 25, addedOn: "2026-10-01" };
  it("pays the repeat that was due, and not again", () => {
    const paid = markPaidOnce(rent, "2026-10-25", now, undefined, "alice")!;
    expect(paid.paidThrough).toBe("2026-10-25");
    expect(markPaidOnce(paid, "2026-10-25", now, undefined, "bob")).toBeNull();
  });
  it("undo only removes your own matching payment", () => {
    const paid = markPaidOnce(rent, "2026-10-25", now, undefined, "alice")!;
    expect(undoOwnPayment(paid, "2026-10-25", "bob")).toBeNull();
    expect(undoOwnPayment(paid, "2026-10-25", "alice")?.paidThrough).toBeUndefined();
  });
});
