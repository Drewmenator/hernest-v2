// ─── Per-item records: migration + simultaneous edits (emulator) ───
// Runs the real migration and transactions from src/core/householdItemsCore
// against the Firestore emulator, as two signed-in people (owner + partner).
// npm run test:rules
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import {
  migrateKind, readItems, createItemDoc, updateItemDoc, mutateItemDoc, isMigrated,
} from "../src/core/householdItemsCore";
import { markPaidOnce, type Bill } from "../src/core/bills";
import { proposeTask, acceptTask, type OwnedTask } from "../src/core/taskOwnership";

let env: RulesTestEnvironment;
const ALICE = "alice_owner";
const BOB = "bob_partner";

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-hernest-rules",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
afterAll(async () => { await env.cleanup(); });

const OLD_TASKS = [
  { id: "t1", title: "Sign permission slip", status: "pending" },
  { id: "t2", title: "Call dentist", status: "completed" },
  { title: "No id on this one", status: "pending" },
];
const OLD_BILLS: Bill[] = [
  { id: "b1", name: "Rent", cadence: "monthly", dueDay: 25, addedOn: "2026-10-01", amount: 1800 },
];
const OLD_CHORES = [{ id: "c1", title: "Take out trash", assignedTo: "Mia", done: false }];

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", BOB, "data", "household_link"), { primaryUid: ALICE, role: "partner" });
    await setDoc(doc(db, "users", ALICE, "data", "tasks"), { tasks: OLD_TASKS });
    await setDoc(doc(db, "users", ALICE, "data", "bills"), { bills: OLD_BILLS });
    await setDoc(doc(db, "users", ALICE, "data", "family"), { members: [{ name: "Mia" }], tasks: OLD_CHORES });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const raw = async (path: string[]) => {
  let data: unknown;
  await env.withSecurityRulesDisabled(async ctx => {
    const [a, ...rest] = path;
    data = (await getDoc(doc(ctx.firestore(), a, ...rest))).data();
  });
  return data as Record<string, unknown> | undefined;
};

describe("one-time migration", () => {
  it("copies every old item into its own record and keeps the old doc as is", async () => {
    const r = await migrateKind(as(ALICE), ALICE, "tasks", ALICE);
    expect(r).toEqual({ migrated: true, count: 3 });
    const items = await readItems(as(ALICE), ALICE, "tasks");
    expect(items.map(i => i.id).sort()).toEqual(["legacy_2", "t1", "t2"]);
    expect(items.find(i => i.id === "t1")).toMatchObject({ title: "Sign permission slip", status: "pending" });
    // Old doc untouched (backup).
    expect(await raw(["users", ALICE, "data", "tasks"])).toEqual({ tasks: OLD_TASKS });
    expect(await isMigrated(as(ALICE), ALICE, "tasks")).toBe(true);
  });

  it("migrates chores out of the family doc and bills (either phone can run the copy)", async () => {
    // The family list is household-shared (rules fixed in the privacy pass),
    // so the partner's phone can copy chores too; the owner's later run is a no-op.
    await migrateKind(as(BOB), ALICE, "chores", BOB);
    expect((await migrateKind(as(ALICE), ALICE, "chores", ALICE)).migrated).toBe(false);
    await migrateKind(as(BOB), ALICE, "bills", BOB);
    expect((await readItems(as(ALICE), ALICE, "chores"))[0]).toMatchObject({ id: "c1", assignedTo: "Mia" });
    expect((await readItems(as(ALICE), ALICE, "bills"))[0]).toMatchObject({ id: "b1", name: "Rent" });
    expect((await raw(["users", ALICE, "data", "family"]))?.tasks).toEqual(OLD_CHORES);
  });

  it("is idempotent: a second run changes nothing, even after edits", async () => {
    await migrateKind(as(ALICE), ALICE, "tasks", ALICE);
    await updateItemDoc(as(ALICE), ALICE, "tasks", "t1", { status: "completed" });
    const again = await migrateKind(as(BOB), ALICE, "tasks", BOB);
    expect(again.migrated).toBe(false);
    const t1 = (await readItems(as(ALICE), ALICE, "tasks")).find(i => i.id === "t1");
    expect(t1?.status).toBe("completed");
  });

  it("two phones migrating at the same moment produce one clean copy", async () => {
    const [a, b] = await Promise.all([
      migrateKind(as(ALICE), ALICE, "tasks", ALICE),
      migrateKind(as(BOB), ALICE, "tasks", BOB),
    ]);
    expect([a.migrated, b.migrated].filter(Boolean)).toHaveLength(1);
    expect(await readItems(as(ALICE), ALICE, "tasks")).toHaveLength(3);
  });

  it("an item saved before the copy keeps its newer fields", async () => {
    await createItemDoc(as(BOB), ALICE, "tasks", { id: "t1", status: "completed" } as never);
    await migrateKind(as(ALICE), ALICE, "tasks", ALICE);
    const t1 = (await readItems(as(ALICE), ALICE, "tasks")).find(i => i.id === "t1");
    expect(t1).toMatchObject({ title: "Sign permission slip", status: "completed" });
  });

  it("a household with no old list is simply marked done", async () => {
    await env.clearFirestore();
    expect(await migrateKind(as(ALICE), ALICE, "bills", ALICE)).toEqual({ migrated: true, count: 0 });
    expect(await isMigrated(as(ALICE), ALICE, "bills")).toBe(true);
  });
});

describe("two people editing at the same time", () => {
  beforeEach(async () => {
    await migrateKind(as(ALICE), ALICE, "tasks", ALICE);
    await migrateKind(as(ALICE), ALICE, "bills", ALICE);
  });

  it("both new tasks survive when added at the same moment", async () => {
    await Promise.all([
      createItemDoc(as(ALICE), ALICE, "tasks", { id: "new_a", title: "Buy milk" } as never),
      createItemDoc(as(BOB), ALICE, "tasks", { id: "new_b", title: "Book flights" } as never),
    ]);
    const ids = (await readItems(as(ALICE), ALICE, "tasks")).map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining(["new_a", "new_b", "t1", "t2", "legacy_2"]));
  });

  it("edits to different items both survive", async () => {
    await Promise.all([
      updateItemDoc(as(ALICE), ALICE, "tasks", "t1", { status: "completed" }),
      updateItemDoc(as(BOB), ALICE, "tasks", "t2", { status: "pending" }),
    ]);
    const items = await readItems(as(ALICE), ALICE, "tasks");
    expect(items.find(i => i.id === "t1")).toMatchObject({ status: "completed" });
    expect(items.find(i => i.id === "t2")).toMatchObject({ status: "pending" });
  });

  it("edits to different fields of the same item both survive", async () => {
    await Promise.all([
      updateItemDoc(as(ALICE), ALICE, "tasks", "t1", { title: "Sign Mia's permission slip" }),
      updateItemDoc(as(BOB), ALICE, "tasks", "t1", { dueDate: "2026-10-24" }),
    ]);
    const t1 = (await readItems(as(ALICE), ALICE, "tasks")).find(i => i.id === "t1");
    expect(t1).toMatchObject({ title: "Sign Mia's permission slip", dueDate: "2026-10-24", status: "pending" });
  });

  it("both tapping Paid at once ticks the bill off once, and an edit alongside is kept", async () => {
    const now = new Date(2026, 9, 21);
    const due = "2026-10-25";
    await Promise.all([
      mutateItemDoc<Bill>(as(ALICE), ALICE, "bills", "b1", cur => markPaidOnce(cur, due, now, undefined, ALICE)),
      mutateItemDoc<Bill>(as(BOB), ALICE, "bills", "b1", cur => markPaidOnce(cur, due, now, undefined, BOB)),
      updateItemDoc(as(BOB), ALICE, "bills", "b1", { autopay: true }),
    ]);
    const b1 = (await readItems<Bill>(as(ALICE), ALICE, "bills"))[0];
    expect(b1.payments).toHaveLength(1);
    expect(b1.paidThrough).toBe(due);
    expect(b1.autopay).toBe(true);
    expect(b1.name).toBe("Rent");
  });

  it("Sam accepting while Alex edits the same task keeps both, and Alex can't accept for Sam", async () => {
    const t = proposeTask({ id: "ask1", title: "Dry cleaning" }, { uid: ALICE, name: "Alice" }, { uid: BOB, name: "Bob" }, 1);
    await createItemDoc(as(ALICE), ALICE, "tasks", t);
    const [, , aliceTry] = await Promise.all([
      mutateItemDoc<OwnedTask>(as(BOB), ALICE, "tasks", "ask1", cur => acceptTask(cur, BOB, 2)),
      updateItemDoc(as(ALICE), ALICE, "tasks", "ask1", { dueDate: "2026-10-24" }),
      mutateItemDoc<OwnedTask>(as(ALICE), ALICE, "tasks", "ask1", cur => acceptTask(cur, ALICE, 3)),
    ]);
    expect(aliceTry).toBeNull();
    const saved = (await readItems<OwnedTask>(as(ALICE), ALICE, "tasks")).find(i => i.id === "ask1");
    expect(saved).toMatchObject({ state: "accepted", acceptedAt: 2, dueDate: "2026-10-24", title: "Dry cleaning" });
  });
});
