// ─── Recurring bills ─────────────────────────────────────────────────
// The whole money side of HerNest: know every regular bill, say when it is
// due, and let you tick it off. Server mirror: api/_lib/bills.js (keep in sync;
// bills.mirror.test.ts checks both give the same answers).
//
// How "due" works: each bill repeats from an anchor (a day of the month, or a
// date). The bill's CURRENT due date is the first repeat on or after a cutoff:
//   - the day after the last repeat you marked paid (paidThrough), or
//   - the day the bill was added (addedOn), so older repeats never count, or
//   - today, for older bills saved before addedOn existed.
// So a missed bill stays due (and goes overdue) instead of silently rolling
// on to next month.

export type Cadence =
  | "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "yearly" | "once";

export const CADENCES: { id: Cadence; label: string }[] = [
  { id: "monthly",    label: "Monthly" },
  { id: "weekly",     label: "Weekly" },
  { id: "biweekly",   label: "Every 2 weeks" },
  { id: "quarterly",  label: "Every 3 months" },
  { id: "semiannual", label: "Every 6 months" },
  { id: "yearly",     label: "Yearly" },
  { id: "once",       label: "One time" },
];

export interface BillPayment {
  due: string;      // YYYY-MM-DD of the repeat that was paid
  paidOn: string;   // YYYY-MM-DD
  amount?: number;
  by?: string;      // uid of whoever ticked it off
  auto?: boolean;   // an autopay payment
  confirmedBy?: string; // uid of whoever confirmed the autopay went through
}

export interface Bill {
  id: string;
  name: string;
  amount?: number;          // optional: a reminder works without it
  amountVaries?: boolean;   // e.g. electric: show "about $X" from history
  cadence: Cadence;
  dueDay?: number;          // 1–31, for monthly
  dueDate?: string;         // YYYY-MM-DD anchor for every other cadence
  dueUnknown?: boolean;     // "Not sure" picked in setup
  autopay?: boolean;
  payer?: string;           // uid of who pays it; absent = either of you
  addedOn?: string;         // YYYY-MM-DD
  paidThrough?: string;     // due date of the last repeat marked paid
  lastPaidDate?: string;    // YYYY-MM-DD
  payments?: BillPayment[]; // newest first, capped
  autopayFailed?: string;   // due date of a repeat whose autopay didn't go through
  source?: "manual" | "setup" | "screenshot" | "text";
  category?: string;        // legacy field from the old Bills tab
}

export type BillLike = Pick<Bill, "cadence" | "dueDay" | "dueDate" | "dueUnknown" | "addedOn" | "paidThrough">;

const MONTH_STEP: Partial<Record<Cadence, number>> = { quarterly: 3, semiannual: 6, yearly: 12 };
const DAY_STEP: Partial<Record<Cadence, number>> = { weekly: 7, biweekly: 14 };
const MAX_PAYMENTS = 24;

// Local-safe YYYY-MM-DD (toISOString would shift across the UTC boundary).
export function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocal(s?: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}

// Day `day` of month m0 (which may overflow past 11), clamped to the month's length.
function clampedDate(y: number, m0: number, day: number): Date {
  const first = new Date(y, m0, 1);
  const fy = first.getFullYear(), fm = first.getMonth();
  return new Date(fy, fm, Math.min(day, daysInMonth(fy, fm)));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// First repeat of the bill on or after `from`, or null.
export function occurrenceOnOrAfter(bill: BillLike, from: Date): Date | null {
  from = startOfDay(from);
  if (bill.cadence === "once") {
    const d = parseLocal(bill.dueDate);
    return d && d.getTime() >= from.getTime() ? d : null;
  }

  if (bill.cadence === "monthly") {
    if (!bill.dueDay) return null;
    const day = Math.min(Math.max(Math.round(bill.dueDay), 1), 31);
    let cand = clampedDate(from.getFullYear(), from.getMonth(), day);
    if (cand.getTime() < from.getTime()) cand = clampedDate(from.getFullYear(), from.getMonth() + 1, day);
    return cand;
  }

  const anchor = parseLocal(bill.dueDate);
  if (!anchor) return null;
  if (anchor.getTime() >= from.getTime()) return anchor;

  const dayStep = DAY_STEP[bill.cadence];
  if (dayStep) {
    const diff = Math.round((from.getTime() - anchor.getTime()) / 86400000);
    return addDays(anchor, Math.ceil(diff / dayStep) * dayStep);
  }

  const step = MONTH_STEP[bill.cadence];
  if (!step) return null;
  const monthsApart = (from.getFullYear() - anchor.getFullYear()) * 12 + (from.getMonth() - anchor.getMonth());
  let n = Math.floor(monthsApart / step) * step;
  let cand = clampedDate(anchor.getFullYear(), anchor.getMonth() + n, anchor.getDate());
  while (cand.getTime() < from.getTime()) {
    n += step;
    cand = clampedDate(anchor.getFullYear(), anchor.getMonth() + n, anchor.getDate());
  }
  return cand;
}

// Where the search for the current due date starts.
function cutoff(bill: BillLike, today: Date): Date {
  const paid = parseLocal(bill.paidThrough);
  if (paid) return addDays(paid, 1);
  const added = parseLocal(bill.addedOn);
  if (added) return added.getTime() < today.getTime() ? added : today;
  return today;
}

// The date this bill is currently due (YYYY-MM-DD). It can be in the past,
// which means overdue. null when there is no date, or a one-time bill is paid.
export function nextDueDate(bill: BillLike, now: Date = new Date()): string | null {
  if (bill.dueUnknown && !bill.dueDay && !bill.dueDate) return null;
  const today = startOfDay(now);
  if (bill.cadence === "once") {
    if (bill.paidThrough) return null;
    return parseLocal(bill.dueDate) ? bill.dueDate! : null;
  }
  const d = occurrenceOnOrAfter(bill, cutoff(bill, today));
  return d ? iso(d) : null;
}

// Whole days until the bill is due (0 = today, negative = overdue), or null.
export function daysUntilDue(bill: BillLike, now: Date = new Date()): number | null {
  const nd = parseLocal(nextDueDate(bill, now) || undefined);
  if (!nd) return null;
  return Math.round((nd.getTime() - startOfDay(now).getTime()) / 86400000);
}

// Tick off the current repeat. Learns the amount the first time one is given.
export function markPaid(bill: Bill, now: Date = new Date(), amount?: number, by?: string): Bill {
  const due = nextDueDate(bill, now);
  if (!due) return bill;
  const paidOn = iso(now);
  const amt = amount && amount > 0 ? Math.round(amount * 100) / 100 : undefined;
  const payment: BillPayment = { due, paidOn, ...(amt ? { amount: amt } : {}), ...(by ? { by } : {}) };
  return {
    ...bill,
    paidThrough: due,
    lastPaidDate: paidOn,
    payments: [payment, ...(bill.payments || [])].slice(0, MAX_PAYMENTS),
    ...(amt && !bill.amount ? { amount: amt } : {}),
    autopayFailed: undefined,
  };
}

// ── Autopay ─────────────────────────────────────────────────────────
// Autopay never counts as paid on its own. Once an autopay bill's date has
// passed, it waits for someone to confirm the payment went through (or say
// it didn't, which turns it into an ordinary overdue bill). Payments saved
// before this rule (auto: true, no confirmedBy) still read as "autopay ran".
//
//   scheduled  the date hasn't come yet
//   check      the date has passed: did it go through?
//   failed     someone said it didn't go through: treat as overdue
export type AutopayStatus = "scheduled" | "check" | "failed";

export function autopayStatus(bill: Bill, now: Date = new Date()): AutopayStatus | null {
  if (!bill.autopay) return null;
  const due = nextDueDate(bill, now);
  const days = daysUntilDue(bill, now);
  if (!due || days == null) return null;
  if (days >= 0) return "scheduled";
  return bill.autopayFailed === due ? "failed" : "check";
}

// Whether the bill is being looked after by autopay (so it isn't "overdue"
// or "needs paying"). A failed autopay is not covered.
export function autopayCovers(bill: Bill, now: Date = new Date()): boolean {
  const st = autopayStatus(bill, now);
  return st === "scheduled" || st === "check";
}

// The past repeats waiting to be confirmed, oldest first.
export function autopayDueDates(bill: Bill, now: Date = new Date()): string[] {
  if (autopayStatus(bill, now) !== "check") return [];
  const today = startOfDay(now);
  const out: string[] = [];
  let b: Bill = bill;
  for (let i = 0; i < 60; i++) {
    const due = nextDueDate(b, now);
    const d = parseLocal(due || undefined);
    if (!due || !d || d.getTime() >= today.getTime()) break;
    out.push(due);
    b = { ...b, paidThrough: due };
  }
  return out;
}

// "Confirm paid": record every past repeat as paid on its due date,
// confirmed by `by`. `firstDue` is the repeat the person was looking at; if
// it's no longer the one waiting (someone else confirmed), null = no change.
export function confirmAutopay(bill: Bill, firstDue: string, now: Date = new Date(), by?: string): Bill | null {
  const dues = autopayDueDates(bill, now);
  if (!dues.length || dues[0] !== firstDue) return null;
  const { amount } = displayAmount(bill);
  let payments = bill.payments || [];
  for (const due of dues) {
    payments = [{ due, paidOn: due, auto: true, ...(by ? { confirmedBy: by } : {}), ...(amount ? { amount } : {}) }, ...payments];
  }
  const last = dues[dues.length - 1];
  return { ...bill, paidThrough: last, lastPaidDate: last, payments: payments.slice(0, MAX_PAYMENTS), autopayFailed: undefined };
}

// "It didn't go through": the repeat becomes an ordinary overdue bill, with
// reminders, until someone marks it paid.
export function autopayDidNotRun(bill: Bill, due: string, now: Date = new Date()): Bill | null {
  if (autopayStatus(bill, now) !== "check" || nextDueDate(bill, now) !== due) return null;
  return { ...bill, autopayFailed: due };
}

// Undo the most recent tick-off (for a mistaken tap).
export function undoPaid(bill: Bill): Bill {
  const [, ...rest] = bill.payments || [];
  const next: Bill = { ...bill, payments: rest };
  if (rest[0]) { next.paidThrough = rest[0].due; next.lastPaidDate = rest[0].paidOn; }
  else { delete next.paidThrough; delete next.lastPaidDate; }
  return next;
}

// Mark the repeat due on `due` paid, unless it is no longer the one due
// (someone already paid it): then null, meaning "no change". Used inside a
// transaction so two people tapping Paid together tick it off once.
export function markPaidOnce(bill: Bill, due: string, now: Date = new Date(), amount?: number, by?: string): Bill | null {
  if (nextDueDate(bill, now) !== due) return null;
  return markPaid(bill, now, amount, by);
}

// Undo the newest payment only if it is the one `by` made for `due`.
export function undoOwnPayment(bill: Bill, due: string, by?: string): Bill | null {
  const last = bill.payments?.[0];
  if (!last || last.due !== due || (last.by && by && last.by !== by)) return null;
  return undoPaid(bill);
}

// The amount to show, and whether it is an estimate ("about $X").
export function displayAmount(bill: Bill): { amount: number | null; estimate: boolean } {
  const paid = (bill.payments || []).map(p => p.amount).filter((a): a is number => typeof a === "number" && a > 0);
  if (bill.amountVaries && paid.length) {
    const recent = paid.slice(0, 3);
    return { amount: Math.round(recent.reduce((s, a) => s + a, 0) / recent.length), estimate: true };
  }
  if (bill.amount && bill.amount > 0) return { amount: bill.amount, estimate: !!bill.amountVaries };
  if (paid.length) return { amount: paid[0], estimate: true };
  return { amount: null, estimate: false };
}

// Rough monthly cost, for the one total on the screen.
const PER_MONTH: Record<Cadence, number> = {
  weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, yearly: 1 / 12, once: 0,
};
export function monthlyEstimate(bills: Bill[]): number {
  return Math.round(bills.reduce((s, b) => s + (displayAmount(b).amount || 0) * (PER_MONTH[b.cadence] ?? 0), 0));
}

export type BillGroup = "check" | "overdue" | "week" | "month" | "later" | "nodate" | "done";

export function groupOf(bill: Bill, now: Date = new Date()): BillGroup {
  const days = daysUntilDue(bill, now);
  if (days == null) return bill.cadence === "once" && bill.paidThrough ? "done" : "nodate";
  if (days < 0) return autopayStatus(bill, now) === "check" ? "check" : "overdue";
  if (days <= 6) return "week";
  const due = parseLocal(nextDueDate(bill, now)!)!;
  return due.getMonth() === now.getMonth() && due.getFullYear() === now.getFullYear() ? "month" : "later";
}

// Payments made in the current calendar month (for "Paid this month").
export function paidThisMonth(bills: Bill[], now: Date = new Date()): { bill: Bill; payment: BillPayment }[] {
  const prefix = iso(now).slice(0, 7);
  const out: { bill: Bill; payment: BillPayment }[] = [];
  for (const bill of bills) for (const payment of bill.payments || []) {
    if (payment.paidOn.startsWith(prefix)) out.push({ bill, payment });
  }
  return out.sort((a, b) => b.payment.paidOn.localeCompare(a.payment.paidOn));
}

// "Due today", "Due tomorrow", "Due Fri", "Due in 12 days", "3 days overdue".
export function dueLabel(bill: Bill, now: Date = new Date()): string {
  const days = daysUntilDue(bill, now);
  if (days == null) return bill.cadence === "once" && bill.paidThrough ? "Paid" : "Needs a due date";
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 6) {
    const d = parseLocal(nextDueDate(bill, now)!)!;
    return `Due ${d.toLocaleDateString("en-US", { weekday: "long" })}`;
  }
  if (days <= 30) return `Due in ${days} days`;
  const d = parseLocal(nextDueDate(bill, now)!)!;
  return `Due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

// Whether this bill's reminders go to `uid`. A bill with no payer is for
// everyone in the household.
export function billIsFor(bill: Pick<Bill, "payer">, uid?: string | null): boolean {
  return !bill.payer || !uid || bill.payer === uid;
}

// Normalised name, for spotting duplicates ("Netflix" vs "NETFLIX.COM").
export function billKey(name: string): string {
  return name.toLowerCase().replace(/\.com|\binc\b|[^a-z0-9]/g, "");
}
