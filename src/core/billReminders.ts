// ─── Bill reminders: what to send, and when ──────────────────────────
// Plans the bill notifications for one person on one device. They are
// delivered as LOCAL notifications (see syncBillReminders in
// localNotifications.ts) so they land at a sensible local morning hour: the
// server cron runs once at 06:00 UTC, which is the middle of the night in the
// US. Spec: docs/superpowers/specs/2026-10-21-bills-redesign-design.md
//
//   You pay it:   3 days before, and on the due day (if still unpaid)
//   Autopay:      one quiet notice the day before
//   Overdue:      one nudge the morning after the due day
//   "Not sure":   once, on the 1st of the month after the bill was added
//
// "If still unpaid" works because the whole plan is rebuilt (and the old one
// cancelled) every time the bills change: once a bill is marked paid, its
// due-day and overdue notifications are no longer in the plan.
import {
  type Bill, nextDueDate, occurrenceOnOrAfter, displayAmount, billIsFor, iso,
} from "./bills";

export type BillReminderKind = "before" | "dueday" | "overdue" | "autopay" | "askdate";

export interface BillReminder {
  id: number;               // local notification id (FIRST_ID upward)
  at: Date;
  kind: BillReminderKind;
  billId: string;
  due?: string;             // YYYY-MM-DD of the repeat this is about
  title: string;
  body: string;
  canMarkPaid: boolean;     // show the "Paid" button on the notification
}

// iOS keeps at most 64 pending local notifications per app, shared with the
// wellness ones, so bills get a fixed block of ids and a cap.
export const FIRST_ID = 30000;
export const MAX_REMINDERS = 48;

export interface PlanOptions {
  uid?: string | null;      // only bills this person pays (or anyone pays)
  hour?: number;            // local hour the notifications go out
  horizonDays?: number;     // how far ahead to schedule
}

function parseLocal(s: string): Date {
  return new Date(`${s}T00:00:00`);
}
function at(day: Date, offsetDays: number, hour: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offsetDays, hour, 0, 0, 0);
}
function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

// "Electric $142" / "Electric about $90" / "Electric"
function nameWithAmount(bill: Bill): string {
  const { amount, estimate } = displayAmount(bill);
  if (!amount) return bill.name;
  return `${bill.name} ${estimate ? "about " : ""}${money(amount)}`;
}

// The first 1st-of-the-month after the bill was added: the one time we ask.
export function askDateFor(bill: Bill): Date | null {
  if (!bill.addedOn || !/^\d{4}-\d{2}-\d{2}$/.test(bill.addedOn)) return null;
  const added = parseLocal(bill.addedOn);
  return new Date(added.getFullYear(), added.getMonth() + 1, 1);
}

// Every repeat of the bill from its current due date to the end of the horizon.
function repeats(bill: Bill, now: Date, until: Date): Date[] {
  const first = nextDueDate(bill, now);
  if (!first) return [];
  const out = [parseLocal(first)];
  if (bill.cadence === "once") return out;
  while (out.length < 40) {
    const last = out[out.length - 1];
    const next = occurrenceOnOrAfter(bill, new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
    if (!next || next.getTime() > until.getTime()) break;
    out.push(next);
  }
  return out;
}

export function planBillReminders(bills: Bill[], now: Date = new Date(), opts: PlanOptions = {}): BillReminder[] {
  const hour = opts.hour ?? 9;
  const until = at(now, opts.horizonDays ?? 35, 23);
  const plan: Omit<BillReminder, "id">[] = [];
  const add = (r: Omit<BillReminder, "id">) => {
    if (r.at.getTime() > now.getTime() && r.at.getTime() <= until.getTime()) plan.push(r);
  };

  for (const bill of bills) {
    if (!bill?.id || !bill.name || !billIsFor(bill, opts.uid)) continue;

    // No date yet: ask once whether the bill has arrived.
    if (bill.dueUnknown && !bill.dueDay && !bill.dueDate) {
      const ask = askDateFor(bill);
      if (ask) add({
        at: at(ask, 0, hour), kind: "askdate", billId: bill.id, canMarkPaid: false,
        title: `Did your ${bill.name} bill come yet?`,
        body: "Tap the day it's due and we'll remind you before it.",
      });
      continue;
    }

    for (const d of repeats(bill, now, until)) {
      const due = iso(d);
      // An autopay that didn't go through is reminded like any unpaid bill.
      if (bill.autopay && bill.autopayFailed !== due) {
        const { amount } = displayAmount(bill);
        add({
          at: at(d, -1, hour), kind: "autopay", billId: bill.id, due, canMarkPaid: false,
          title: `${bill.name} goes out tomorrow`,
          body: amount ? `It's on autopay. Make sure ${money(amount)} is in the account.` : "It's on autopay. Make sure the money is in the account.",
        });
        // Autopay isn't counted as paid until someone checks it went through.
        add({
          at: at(d, 1, hour), kind: "autopay", billId: bill.id, due, canMarkPaid: false,
          title: `Did your ${bill.name} autopay go through?`,
          body: "Open Bills to confirm it, or tell HerNest it didn't.",
        });
        continue;
      }
      const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
      add({
        at: at(d, -3, hour), kind: "before", billId: bill.id, due, canMarkPaid: true,
        title: `${nameWithAmount(bill)} due ${weekday}`,
        body: "Already paid it? Tap Paid.",
      });
      add({
        at: at(d, 0, hour), kind: "dueday", billId: bill.id, due, canMarkPaid: true,
        title: `${nameWithAmount(bill)} is due today`,
        body: "Tap Paid once it's done.",
      });
      add({
        at: at(d, 1, hour), kind: "overdue", billId: bill.id, due, canMarkPaid: true,
        title: `${bill.name} was due yesterday`,
        body: "Paid it? Tap Paid. If not, it stays at the top of Bills until you do.",
      });
    }
  }

  return plan
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_REMINDERS)
    .map((r, i) => ({ ...r, id: FIRST_ID + i }));
}

// ── Opening Bills from a notification ───────────────────────────────
// A notification tap (or its Paid button) leaves a note here and switches to
// the Bills tab; BillsScreen picks it up once its bills are loaded.
export interface BillFocus {
  billId: string;
  due?: string;
  markPaid?: boolean;       // the Paid button was tapped
  askDate?: boolean;        // the "Not sure" follow-up: open the editor
}

const FOCUS_EVENT = "hn-bill-focus";
let pendingFocus: BillFocus | null = null;

export function setBillFocus(f: BillFocus): void {
  pendingFocus = f;
  try { window.dispatchEvent(new Event(FOCUS_EVENT)); } catch { /* no window in tests */ }
}

export function takeBillFocus(): BillFocus | null {
  const f = pendingFocus;
  pendingFocus = null;
  return f;
}

export function onBillFocus(fn: () => void): () => void {
  window.addEventListener(FOCUS_EVENT, fn);
  return () => window.removeEventListener(FOCUS_EVENT, fn);
}
