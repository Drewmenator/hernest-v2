// ─── Firestore security-rules tests (runs against the emulator) ────
// npm run test:rules  (starts the emulator, runs this, tears down)
// These encode the household security model: your namespace is yours,
// members share ONLY the whitelisted collections, invites are server-only.
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit } from "firebase/firestore";

let env: RulesTestEnvironment;

const ALICE = "alice_owner";   // household owner
const BOB = "bob_partner";     // invited partner (household_link → alice)
const MALLORY = "mallory";     // stranger

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-hernest-rules",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  // Seed membership out-of-band (simulates the trusted /api/invite/accept
  // admin write) + some data to read.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", BOB, "data", "household_link"), { primaryUid: ALICE, role: "partner" });
    await setDoc(doc(db, "users", ALICE, "data", "budget_v2"), { categories: [{ id: "groceries", spent: 100 }] });
    await setDoc(doc(db, "users", ALICE, "data", "thrive"), { sleepLog: [{ date: "2026-07-10", hours: 7 }] });
    await setDoc(doc(db, "users", ALICE, "integrations", "oura"), { accessToken: "enc:secret" });
    await setDoc(doc(db, "households", ALICE), { createdAt: 1 });
    await setDoc(doc(db, "households", ALICE, "events", "e1"), { actorUserId: ALICE, type: "plan.task.created", visibility: "household", shared: true, occurredAt: 1 });
    // Written before the privacy fix: a private chat copied into the shared log.
    await setDoc(doc(db, "households", ALICE, "events", "leak1"), { actorUserId: ALICE, type: "cleo.conversation.ended", visibility: "household", payload: { messages: [{ role: "user", content: "secret" }] } });
    await setDoc(doc(db, "invites", "tok123"), { fromUid: ALICE, status: "pending" });
    await setDoc(doc(db, "ai_usage", "2026-10-21", "households", ALICE), { calls: 60, costUsd: 0.4 });
    await setDoc(doc(db, "ai_burst", ALICE), { minute: "2026-10-21T14:03", count: 10 });
  });
});

const as = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

describe("own namespace", () => {
  it("owner reads and writes her own data", async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), "users", ALICE, "data", "budget_v2")));
    await assertSucceeds(setDoc(doc(as(ALICE), "users", ALICE, "data", "tasks"), { tasks: [] }));
  });

  it("unauthenticated gets nothing", async () => {
    await assertFails(getDoc(doc(as(null), "users", ALICE, "data", "budget_v2")));
  });
});

describe("household sharing", () => {
  it("partner reads shared budget", async () => {
    await assertSucceeds(getDoc(doc(as(BOB), "users", ALICE, "data", "budget_v2")));
  });

  it("partner writes shared tasks", async () => {
    await assertSucceeds(setDoc(doc(as(BOB), "users", ALICE, "data", "tasks"), { tasks: [{ id: 1 }] }));
  });

  it("partner CANNOT read owner's personal thrive data (not in shared list)", async () => {
    await assertFails(getDoc(doc(as(BOB), "users", ALICE, "data", "thrive")));
  });

  it("partner reads the shared family list and synced calendar", async () => {
    await assertSucceeds(getDoc(doc(as(BOB), "users", ALICE, "data", "family")));
    await assertSucceeds(getDoc(doc(as(BOB), "users", ALICE, "data", "calendar_synced")));
  });

  it("partner CANNOT read owner's private records", async () => {
    for (const col of ["alerts", "cleo_memory_v2", "profile", "push_state", "gmail_receipts", "partner_invite", "style"]) {
      await assertFails(getDoc(doc(as(BOB), "users", ALICE, "data", col)));
      await assertFails(setDoc(doc(as(BOB), "users", ALICE, "data", col), { x: 1 }));
    }
  });

  it("partner CANNOT read owner's integration tokens", async () => {
    await assertFails(getDoc(doc(as(BOB), "users", ALICE, "integrations", "oura")));
  });

  it("stranger CANNOT read shared collections", async () => {
    await assertFails(getDoc(doc(as(MALLORY), "users", ALICE, "data", "budget_v2")));
  });

  it("client CANNOT forge a household_link to self-grant membership", async () => {
    // household_link is the membership anchor isMember() trusts. Clients
    // must not be able to write it — only the admin SDK (invite accept).
    // This hole existed until 2026-07-10; these assertions keep it closed.
    await assertFails(setDoc(doc(as(MALLORY), "users", MALLORY, "data", "household_link"), { primaryUid: ALICE, role: "partner" }));
    await assertFails(getDoc(doc(as(MALLORY), "users", ALICE, "data", "budget_v2")));
  });

  it("owner also cannot client-write her own household_link (server-only)", async () => {
    await assertFails(setDoc(doc(as(ALICE), "users", ALICE, "data", "household_link"), { primaryUid: ALICE }));
  });

  it("owner can still read her own household_link", async () => {
    await assertSucceeds(getDoc(doc(as(BOB), "users", BOB, "data", "household_link")));
  });
});

describe("server-only records", () => {
  it("owner CANNOT self-grant Pro by writing her own subscription", async () => {
    await assertFails(setDoc(doc(as(ALICE), "users", ALICE, "data", "subscription"), { status: "active" }));
  });

  it("owner can still read her own subscription", async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), "users", ALICE, "data", "subscription")));
  });

  it("owner CANNOT reset her AI usage counter", async () => {
    await assertFails(setDoc(doc(as(ALICE), "users", ALICE, "usage", "2026-10-21"), { count: 0 }));
  });

  it("nobody can read or write the household AI usage and cost records", async () => {
    const day = (who: string) => doc(as(who), "ai_usage", "2026-10-21", "households", ALICE);
    await assertFails(setDoc(day(ALICE), { calls: 0 }));
    await assertFails(updateDoc(day(ALICE), { calls: 0 }));
    await assertFails(deleteDoc(day(ALICE)));
    await assertFails(getDoc(day(ALICE)));
    await assertFails(setDoc(day(BOB), { calls: 0 }));
    await assertFails(setDoc(doc(as(ALICE), "ai_usage", "2026-10-21"), { any: 1 }));
  });

  it("a user CANNOT reset her per-minute AI counter", async () => {
    await assertFails(setDoc(doc(as(ALICE), "ai_burst", ALICE), { minute: "x", count: 0 }));
    await assertFails(getDoc(doc(as(ALICE), "ai_burst", ALICE)));
  });

  it("owner reads but CANNOT write her integration docs", async () => {
    await assertSucceeds(getDoc(doc(as(ALICE), "users", ALICE, "integrations", "oura")));
    await assertFails(setDoc(doc(as(ALICE), "users", ALICE, "integrations", "oura"), { accessToken: "forged" }));
  });

  it("owner still writes her own devices (push tokens)", async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), "users", ALICE, "devices", "tok"), { platform: "ios" }));
  });
});

describe("household roster + event log", () => {
  it("member writes own roster entry only", async () => {
    await assertSucceeds(setDoc(doc(as(BOB), "households", ALICE, "members", BOB), { role: "partner" }));
    await assertFails(setDoc(doc(as(BOB), "households", ALICE, "members", ALICE), { role: "hijack" }));
  });

  it("event log is append-only, actor must be self", async () => {
    await assertSucceeds(setDoc(doc(as(BOB), "households", ALICE, "events", "e2"), { actorUserId: BOB, type: "plan.task.created", visibility: "household", shared: true }));
    await assertFails(setDoc(doc(as(BOB), "households", ALICE, "events", "e3"), { actorUserId: ALICE, type: "plan.task.created", visibility: "household", shared: true }));
    await assertFails(updateDoc(doc(as(ALICE), "households", ALICE, "events", "e1"), { type: "rewrite" }));
    await assertFails(deleteDoc(doc(as(ALICE), "households", ALICE, "events", "e1")));
  });

  it("partner reads shared household events", async () => {
    await assertSucceeds(getDoc(doc(as(BOB), "households", ALICE, "events", "e1")));
  });

  it("private events can't be written to the shared log, whatever they claim", async () => {
    for (const type of ["cleo.conversation.ended", "cleo.crisis.detected", "thrive.mood.logged", "profile.updated", "style.preference.updated", "made.up.type"]) {
      await assertFails(setDoc(doc(as(ALICE), "households", ALICE, "events", `p_${type}`), { actorUserId: ALICE, type, visibility: "household", shared: true }));
    }
    await assertFails(setDoc(doc(as(ALICE), "households", ALICE, "events", "p_vis"), { actorUserId: ALICE, type: "plan.task.created", visibility: "private", shared: true }));
  });

  it("the partner's whole-log query (shared events only) is allowed", async () => {
    await assertSucceeds(getDocs(query(collection(as(BOB), "households", ALICE, "events"), where("shared", "==", true), orderBy("occurredAt", "desc"), limit(50))));
    await assertFails(getDocs(collection(as(BOB), "households", ALICE, "events")));
  });

  it("a private event already in the log is hidden from the partner but not the writer", async () => {
    await assertFails(getDoc(doc(as(BOB), "households", ALICE, "events", "leak1")));
    await assertSucceeds(getDoc(doc(as(ALICE), "households", ALICE, "events", "leak1")));
  });

  it("stranger cannot read the event log", async () => {
    await assertFails(getDoc(doc(as(MALLORY), "households", ALICE, "events", "e1")));
  });
});

describe("per-item household records (tasks, chores, bills)", () => {
  const KINDS = ["tasks", "chores", "bills"];

  it("owner and partner read and write each item", async () => {
    for (const k of KINDS) {
      await assertSucceeds(setDoc(doc(as(ALICE), "users", ALICE, k, "a1"), { id: "a1", title: "x" }));
      await assertSucceeds(setDoc(doc(as(BOB), "users", ALICE, k, "b1"), { id: "b1", title: "y" }));
      await assertSucceeds(updateDoc(doc(as(BOB), "users", ALICE, k, "a1"), { title: "z" }));
      await assertSucceeds(getDoc(doc(as(ALICE), "users", ALICE, k, "b1")));
      await assertSucceeds(getDocs(collection(as(BOB), "users", ALICE, k)));
      await assertSucceeds(deleteDoc(doc(as(BOB), "users", ALICE, k, "b1")));
    }
  });

  it("strangers and signed-out users can't read, list or write them", async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      for (const k of KINDS) await setDoc(doc(ctx.firestore(), "users", ALICE, k, "s1"), { id: "s1" });
    });
    for (const k of KINDS) {
      await assertFails(getDoc(doc(as(MALLORY), "users", ALICE, k, "s1")));
      await assertFails(getDocs(collection(as(MALLORY), "users", ALICE, k)));
      await assertFails(setDoc(doc(as(MALLORY), "users", ALICE, k, "m1"), { id: "m1" }));
      await assertFails(updateDoc(doc(as(MALLORY), "users", ALICE, k, "s1"), { title: "hijack" }));
      await assertFails(deleteDoc(doc(as(MALLORY), "users", ALICE, k, "s1")));
      await assertFails(getDoc(doc(as(null), "users", ALICE, k, "s1")));
    }
  });

  it("partner gets no access to the owner's other subcollections", async () => {
    await assertFails(setDoc(doc(as(BOB), "users", ALICE, "devices", "tok"), { platform: "ios" }));
    await assertFails(getDoc(doc(as(BOB), "users", ALICE, "usage", "2026-10-21")));
  });

  it("partner can read and write the migration marker; strangers can't", async () => {
    await assertSucceeds(setDoc(doc(as(BOB), "users", ALICE, "data", "items_migration"), { tasks: { at: 1 } }, { merge: true }));
    await assertSucceeds(getDoc(doc(as(BOB), "users", ALICE, "data", "items_migration")));
    await assertFails(getDoc(doc(as(MALLORY), "users", ALICE, "data", "items_migration")));
    await assertFails(setDoc(doc(as(MALLORY), "users", ALICE, "data", "items_migration"), { tasks: null }));
  });
});

describe("task ownership", () => {
  const ask = { id: "t1", title: "Pick up dry cleaning", createdBy: ALICE, assigneeUid: BOB, state: "proposed" };
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "users", ALICE, "tasks", "t1"), ask); });
  });

  it("the assignee can accept or decline", async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), "users", ALICE, "tasks", "t1"), { state: "accepted" }));
    await assertSucceeds(updateDoc(doc(as(BOB), "users", ALICE, "tasks", "t1"), { state: "declined" }));
  });

  it("the asker can't accept or decline on their behalf", async () => {
    await assertFails(updateDoc(doc(as(ALICE), "users", ALICE, "tasks", "t1"), { state: "accepted" }));
    await assertFails(updateDoc(doc(as(ALICE), "users", ALICE, "tasks", "t1"), { state: "declined" }));
    await assertFails(setDoc(doc(as(ALICE), "users", ALICE, "tasks", "t2"), { ...ask, id: "t2", state: "accepted" }));
  });

  it("the asker can still ask, edit, ask again, complete or take it back", async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), "users", ALICE, "tasks", "t3"), { ...ask, id: "t3" }));
    await assertSucceeds(updateDoc(doc(as(ALICE), "users", ALICE, "tasks", "t1"), { title: "Dry cleaning by 5pm" }));
    await assertSucceeds(updateDoc(doc(as(ALICE), "users", ALICE, "tasks", "t1"), { state: "done", status: "completed" }));
  });

  it("once accepted, other edits by either person still work", async () => {
    await updateDoc(doc(as(BOB), "users", ALICE, "tasks", "t1"), { state: "accepted" });
    await assertSucceeds(updateDoc(doc(as(ALICE), "users", ALICE, "tasks", "t1"), { dueDate: "2026-10-24" }));
  });
});

describe("invites", () => {
  it("no client can touch invites — admin SDK only", async () => {
    await assertFails(getDoc(doc(as(ALICE), "invites", "tok123")));
    await assertFails(setDoc(doc(as(MALLORY), "invites", "forged"), { fromUid: MALLORY }));
  });
});
