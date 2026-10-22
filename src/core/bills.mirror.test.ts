// The morning push (server) and the Bills screen (app) must agree on due dates.
import { describe, it, expect } from "vitest";
import { nextDueDate as appNext, daysUntilDue as appDays, billIsFor as appFor, type BillLike } from "./bills";
// @ts-expect-error plain JS module without types
import { nextDueDate as srvNext, daysUntilDue as srvDays, billIsFor as srvFor } from "../../api/_lib/bills.js";

const CASES: BillLike[] = [
  { cadence: "monthly", dueDay: 1, addedOn: "2026-09-15" },
  { cadence: "monthly", dueDay: 31 },
  { cadence: "monthly", dueDay: 1, paidThrough: "2026-10-01" },
  { cadence: "weekly", dueDate: "2026-10-01" },
  { cadence: "biweekly", dueDate: "2026-10-02", addedOn: "2026-10-01" },
  { cadence: "quarterly", dueDate: "2026-08-31" },
  { cadence: "semiannual", dueDate: "2026-05-10" },
  { cadence: "yearly", dueDate: "2020-02-29" },
  { cadence: "once", dueDate: "2026-10-25" },
  { cadence: "once", dueDate: "2026-10-25", paidThrough: "2026-10-25" },
  { cadence: "monthly", dueUnknown: true },
];
const DATES = [new Date(2026, 9, 21), new Date(2026, 1, 28), new Date(2027, 0, 1)];

describe("server bills mirror matches the app", () => {
  for (const c of CASES) for (const d of DATES) {
    it(`${JSON.stringify(c)} on ${d.toDateString()}`, () => {
      expect(srvNext(c, d)).toBe(appNext(c, d));
      expect(srvDays(c, d)).toBe(appDays(c, d));
    });
  }
});

describe("who pays matches too", () => {
  for (const payer of [undefined, "me", "partner"]) for (const uid of [undefined, "me", "partner"]) {
    it(`payer ${payer} for ${uid}`, () => expect(srvFor({ payer }, uid)).toBe(appFor({ payer }, uid)));
  }
});
