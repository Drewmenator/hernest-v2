// ─── Recurring bills ─────────────────────────────────────────────────
// A small model so HerNest can remind you before money leaves your account —
// core to the "reduce money anxiety" mission. Computes the NEXT due date from a
// cadence, so a monthly bill rolls forward on its own (date/time aware).

export interface BillLike {
  cadence: "monthly" | "yearly" | "weekly" | "once";
  dueDay?: number;    // 1–31, for monthly
  dueDate?: string;   // YYYY-MM-DD anchor, for once/yearly/weekly
}

// Local-safe YYYY-MM-DD (toISOString would shift across the UTC boundary).
function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}

function parseLocal(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The next date this bill is due on or after today (YYYY-MM-DD), or null.
export function nextDueDate(bill: BillLike, now: Date = new Date()): string | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (bill.cadence === "once") {
    return bill.dueDate || null;
  }

  if (bill.cadence === "weekly") {
    let d = parseLocal(bill.dueDate);
    if (!d) return null;
    while (d.getTime() < today.getTime()) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
    return iso(d);
  }

  if (bill.cadence === "yearly") {
    const anchor = parseLocal(bill.dueDate);
    if (!anchor) return null;
    let cand = new Date(today.getFullYear(), anchor.getMonth(), anchor.getDate());
    if (cand.getTime() < today.getTime()) cand = new Date(today.getFullYear() + 1, anchor.getMonth(), anchor.getDate());
    return iso(cand);
  }

  // monthly — clamp the day to the month's length (e.g. "31st" in February).
  const dd = Math.min(Math.max(bill.dueDay || 1, 1), 31);
  let y = today.getFullYear();
  let m = today.getMonth();
  let cand = new Date(y, m, Math.min(dd, daysInMonth(y, m)));
  if (cand.getTime() < today.getTime()) {
    m++; if (m > 11) { m = 0; y++; }
    cand = new Date(y, m, Math.min(dd, daysInMonth(y, m)));
  }
  return iso(cand);
}

// Whole days until the bill is next due (0 = today, negative = overdue). null
// if it can't be computed.
export function daysUntilDue(bill: BillLike, now: Date = new Date()): number | null {
  const nd = nextDueDate(bill, now);
  if (!nd) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = parseLocal(nd);
  if (!due) return null;
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}
