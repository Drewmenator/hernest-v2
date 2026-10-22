// The morning push (server) and the app must agree on who a task is for.
import { describe, it, expect } from "vitest";
import { taskIsFor, awaitsAnswerFrom, type OwnedTask } from "./taskOwnership";
// @ts-expect-error plain JS module without types
import { taskIsFor as srvFor, awaitsAnswerFrom as srvAwaits } from "../../api/_lib/tasks.js";

const A = "alice", S = "sam";
const CASES: OwnedTask[] = [
  { id: "1" },
  { id: "2", createdBy: A },
  { id: "3", createdBy: A, assigneeUid: S, state: "proposed" },
  { id: "4", createdBy: A, assigneeUid: S, state: "accepted" },
  { id: "5", createdBy: A, assigneeUid: S, state: "declined" },
  { id: "6", createdBy: A, assigneeUid: S, state: "done", status: "completed" },
  { id: "7", createdBy: A, assigneeUid: S, state: "proposed", status: "completed" },
];

describe("server task mirror matches the app", () => {
  for (const t of CASES) for (const u of [A, S, "other"]) {
    it(`${JSON.stringify(t)} for ${u}`, () => {
      expect(srvFor(t, u)).toBe(taskIsFor(t, u));
      expect(srvAwaits(t, u)).toBe(awaitsAnswerFrom(t, u));
    });
  }
});
