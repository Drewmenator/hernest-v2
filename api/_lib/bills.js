// ─── Bills (server mirror of src/core/bills.ts) ─────────────────────
// Keep in sync with the client; src/core/bills.mirror.test.ts runs the same
// cases through both. Finds the date a bill is CURRENTLY due: the first repeat
// on or after the day after the last paid repeat (paidThrough), else the day
// it was added (addedOn), else today. A past date means overdue.

const MONTH_STEP = { quarterly: 3, semiannual: 6, yearly: 12 };
const DAY_STEP = { weekly: 7, biweekly: 14 };

function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseLocal(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
function clampedDate(y, m0, day) {
  const first = new Date(y, m0, 1);
  const fy = first.getFullYear(), fm = first.getMonth();
  return new Date(fy, fm, Math.min(day, daysInMonth(fy, fm)));
}
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

export function occurrenceOnOrAfter(bill, from) {
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

function cutoff(bill, today) {
  const paid = parseLocal(bill.paidThrough);
  if (paid) return addDays(paid, 1);
  const added = parseLocal(bill.addedOn);
  if (added) return added.getTime() < today.getTime() ? added : today;
  return today;
}

export function nextDueDate(bill, now = new Date()) {
  if (bill.dueUnknown && !bill.dueDay && !bill.dueDate) return null;
  const today = startOfDay(now);
  if (bill.cadence === "once") {
    if (bill.paidThrough) return null;
    return parseLocal(bill.dueDate) ? bill.dueDate : null;
  }
  const d = occurrenceOnOrAfter(bill, cutoff(bill, today));
  return d ? iso(d) : null;
}

export function daysUntilDue(bill, now = new Date()) {
  const nd = parseLocal(nextDueDate(bill, now) || undefined);
  if (!nd) return null;
  return Math.round((nd.getTime() - startOfDay(now).getTime()) / 86400000);
}

// Whether this bill's reminders go to `uid` (no payer = everyone).
export function billIsFor(bill, uid) {
  return !bill.payer || !uid || bill.payer === uid;
}
