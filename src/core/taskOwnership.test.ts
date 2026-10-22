import { describe, it, expect } from "vitest";
import {
  proposeTask, acceptTask, declineTask, completeTask, reopenTask, takeBackTask, askAgain,
  taskIsFor, awaitsAnswerFrom, ownershipView, NO_ANSWER_MS, type OwnedTask,
} from "./taskOwnership";

const ALEX = { uid: "alex", name: "Alex" };
const SAM = { uid: "sam", name: "Sam" };
const T0 = 1_700_000_000_000;
const base = { id: "t1", title: "Pick up dry cleaning", status: "pending" };
const proposed = proposeTask(base, ALEX, SAM, T0);

describe("proposing", () => {
  it("starts as proposed, never accepted", () => {
    expect(proposed).toMatchObject({ state: "proposed", createdBy: "alex", assigneeUid: "sam", assigneeName: "Sam", proposedAt: T0 });
  });
  it("the asker sees Waiting for Sam, then Not accepted yet after 2 days", () => {
    expect(ownershipView(proposed, "alex", T0 + 1000)?.label).toBe("Waiting for Sam");
    const late = ownershipView(proposed, "alex", T0 + NO_ANSWER_MS + 1)!;
    expect(late.label).toBe("Not accepted yet");
    expect(late.canFollowUp).toBe(true);
  });
  it("the assignee is asked to answer", () => {
    const v = ownershipView(proposed, "sam", T0)!;
    expect(v).toMatchObject({ label: "Alex asked you", needsMyAnswer: true });
    expect(awaitsAnswerFrom(proposed, "sam")).toBe(true);
    expect(awaitsAnswerFrom(proposed, "alex")).toBe(false);
  });
  it("reminds nobody until accepted", () => {
    expect(taskIsFor(proposed, "sam")).toBe(false);
    expect(taskIsFor(proposed, "alex")).toBe(false);
  });
});

describe("answering", () => {
  it("only the assignee can accept or decline", () => {
    expect(acceptTask(proposed, "alex", T0)).toBeNull();
    expect(declineTask(proposed, "alex", T0)).toBeNull();
  });
  it("accepted: Sam is on it, reminders go to Sam only", () => {
    const a = acceptTask(proposed, "sam", T0 + 5)!;
    expect(a.state).toBe("accepted");
    expect(ownershipView(a, "alex", T0)?.label).toBe("Sam is on it");
    expect(taskIsFor(a, "sam")).toBe(true);
    expect(taskIsFor(a, "alex")).toBe(false);
  });
  it("declined: Sam declined, it goes back to Alex", () => {
    const d = declineTask(proposed, "sam", T0 + 5)!;
    expect(ownershipView(d, "alex", T0)).toMatchObject({ label: "Sam declined", canFollowUp: true });
    expect(taskIsFor(d, "alex")).toBe(true);
    expect(taskIsFor(d, "sam")).toBe(false);
    expect(takeBackTask(d, "sam")).toBeNull();
    const mine = takeBackTask(d, "alex")!;
    expect(mine.assigneeUid).toBeUndefined();
    expect(mine.state).toBeUndefined();
    expect(askAgain(d, "alex", T0 + 9)).toMatchObject({ state: "proposed", proposedAt: T0 + 9 });
  });
});

describe("done", () => {
  it("shows Done by Sam to the asker and Done by you to Sam", () => {
    const done = completeTask(acceptTask(proposed, "sam", T0)!, SAM, T0 + 10)!;
    expect(done).toMatchObject({ state: "done", status: "completed", completedBy: "sam" });
    expect(ownershipView(done, "alex", T0)?.label).toBe("Done by Sam");
    expect(ownershipView(done, "sam", T0)?.label).toBe("Done by you");
    expect(completeTask(done, ALEX, T0)).toBeNull();
    expect(reopenTask(done, "sam", T0)?.state).toBe("accepted");
    // Anyone else un-ticking it asks Sam again rather than saying yes for him.
    expect(reopenTask(done, "alex", T0 + 20)).toMatchObject({ state: "proposed", proposedAt: T0 + 20, acceptedAt: undefined });
  });
  it("a plain task stays plain, but shows who did it to the other person", () => {
    const plain: OwnedTask = { id: "p", status: "pending" };
    expect(ownershipView(plain, "alex", T0)).toBeNull();
    const done = completeTask(plain, SAM, T0)!;
    expect(done.state).toBeUndefined();
    expect(ownershipView(done, "alex", T0)?.label).toBe("Done by Sam");
    expect(ownershipView(done, "sam", T0)).toBeNull();
    expect(taskIsFor(plain, "anyone")).toBe(true);
  });
});
