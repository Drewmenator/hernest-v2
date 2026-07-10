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
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

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
    await setDoc(doc(db, "households", ALICE, "events", "e1"), { actorUserId: ALICE, type: "seed" });
    await setDoc(doc(db, "invites", "tok123"), { fromUid: ALICE, status: "pending" });
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

describe("household roster + event log", () => {
  it("member writes own roster entry only", async () => {
    await assertSucceeds(setDoc(doc(as(BOB), "households", ALICE, "members", BOB), { role: "partner" }));
    await assertFails(setDoc(doc(as(BOB), "households", ALICE, "members", ALICE), { role: "hijack" }));
  });

  it("event log is append-only, actor must be self", async () => {
    await assertSucceeds(setDoc(doc(as(BOB), "households", ALICE, "events", "e2"), { actorUserId: BOB, type: "task" }));
    await assertFails(setDoc(doc(as(BOB), "households", ALICE, "events", "e3"), { actorUserId: ALICE, type: "spoof" }));
    await assertFails(updateDoc(doc(as(ALICE), "households", ALICE, "events", "e1"), { type: "rewrite" }));
    await assertFails(deleteDoc(doc(as(ALICE), "households", ALICE, "events", "e1")));
  });

  it("stranger cannot read the event log", async () => {
    await assertFails(getDoc(doc(as(MALLORY), "households", ALICE, "events", "e1")));
  });
});

describe("invites", () => {
  it("no client can touch invites — admin SDK only", async () => {
    await assertFails(getDoc(doc(as(ALICE), "invites", "tok123")));
    await assertFails(setDoc(doc(as(MALLORY), "invites", "forged"), { fromUid: MALLORY }));
  });
});
