// ─── Paying a bill (shared by Bills, Today and the Paid notification) ───
// Marking paid runs as a transaction on the bill's own record, so if both of
// you tap Paid at the same moment the bill is ticked off once, not twice
// (the second tap would otherwise mark the next repeat paid as well).
import { mutateItem } from "../../core/householdItems";
import { markPaidOnce, undoOwnPayment, nextDueDate, type Bill } from "../../core/bills";

export type PayResult = { status: "paid"; bill: Bill; due: string } | { status: "already" };

// Tick off the repeat that `seen` (the bill as the screen shows it) is due on.
export async function payBill(uid: string, seen: Bill, amount?: number, now: Date = new Date()): Promise<PayResult> {
  const due = nextDueDate(seen, now);
  if (!due) return { status: "already" };
  const after = await mutateItem<Bill>(uid, "bills", seen.id, cur => markPaidOnce(cur, due, now, amount, uid), seen);
  return after ? { status: "paid", bill: after, due } : { status: "already" };
}

// Undo only the payment this person just made (never someone else's).
export async function undoBillPayment(uid: string, paid: Bill, due: string): Promise<Bill | null> {
  return mutateItem<Bill>(uid, "bills", paid.id, cur => undoOwnPayment(cur, due, uid), paid);
}
