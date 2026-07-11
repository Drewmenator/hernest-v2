// ─── Bills (server mirror of src/core/bills.ts) ─────────────────────
// Keep in sync with the client. Computes the next due date from a cadence.

function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
function parseLocal(s) {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function nextDueDate(bill, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (bill.cadence === "once") return bill.dueDate || null;
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
  const dd = Math.min(Math.max(bill.dueDay || 1, 1), 31);
  let y = today.getFullYear(), m = today.getMonth();
  let cand = new Date(y, m, Math.min(dd, daysInMonth(y, m)));
  if (cand.getTime() < today.getTime()) {
    m++; if (m > 11) { m = 0; y++; }
    cand = new Date(y, m, Math.min(dd, daysInMonth(y, m)));
  }
  return iso(cand);
}

export function daysUntilDue(bill, now = new Date()) {
  const nd = nextDueDate(bill, now);
  if (!nd) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = parseLocal(nd);
  if (!due) return null;
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}
