// ─── Bills: the money side of HerNest ──────────────────────────────
// One job: never miss a bill. Shows what is due, lets you tick it off, and
// gets bills in with as little typing as possible (tap setup, a screenshot,
// or one typed line). Replaces the old Budget screens (their data in
// budget_v2 is left untouched). Design: docs/superpowers/specs/2026-10-21-bills-redesign-design.md
import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { subscribeItems, createItem, updateItem, removeItem, mutateItem, changedFields } from "../../core/householdItems";
import { PageTitle, Spinner } from "../../shared/components";
import { formatMoney } from "../../shared/utils/money";
import {
  type Bill, type BillGroup, groupOf, dueLabel, displayAmount,
  monthlyEstimate, paidThisMonth, settleAutopay, daysUntilDue, nextDueDate, iso,
} from "../../core/bills";
import { takeBillFocus, onBillFocus } from "../../core/billReminders";
import { syncBillReminders } from "../../core/localNotifications";
import { payBill, undoBillPayment } from "./billActions";
import { BillEditor } from "./BillEditor";
import { BillSetup } from "./BillSetup";
import { BillImport } from "./BillImport";
import { SectionHeading, TextLink } from "./billsUi";
import { inputStyle } from "./billsStyle";

const SETUP_DONE_KEY = "hn_bills_setup_seen";

const GROUPS: { id: BillGroup; label: string; color?: string }[] = [
  { id: "overdue", label: "Overdue", color: T.red },
  { id: "week",    label: "Next 7 days" },
  { id: "month",   label: "Later this month" },
  { id: "later",   label: "Coming up" },
  { id: "nodate",  label: "Needs a due date" },
];

type View =
  | { kind: "list" }
  | { kind: "setup" }
  | { kind: "import"; mode: "screenshot" | "text" }
  | { kind: "edit"; bill: Bill | null };

// Bring a stored bill up to date: give older bills an addedOn (so their past
// repeats never count as missed) and let autopay bills tick themselves off.
// Returns null when nothing needs to change.
function refreshBill(b: Bill, now: Date): Bill | null {
  let next = b;
  if (!next.addedOn) next = { ...next, addedOn: iso(now) };
  next = settleAutopay(next, now);
  return next === b ? null : next;
}

function seenSetup(): boolean {
  try { return localStorage.getItem(SETUP_DONE_KEY) === "1"; } catch { return false; }
}
function markSetupSeen() {
  try { localStorage.setItem(SETUP_DONE_KEY, "1"); } catch { /* private mode */ }
}

export function BillsScreen() {
  const { user } = useStore();
  const uid = user?.uid;
  const [bills, setBills] = useState<Bill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [showPaid, setShowPaid] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const billsRef = useRef<Bill[]>([]);
  useEffect(() => { billsRef.current = bills; }, [bills]);

  // Live list: a change on either phone shows on both.
  useEffect(() => {
    if (!uid) return;
    let first = true;
    return subscribeItems<Bill>(uid, "bills", items => {
      const list = items.filter(b => b && b.name);
      setBills(list);
      // Rebuild the reminders so a paid, moved or removed bill stops reminding,
      // including when the other person made the change.
      syncBillReminders(list, uid);
      if (first) {
        first = false;
        setLoaded(true);
        if (!list.length && !seenSetup()) setView({ kind: "setup" });
        // Each bill is brought up to date in its own transaction, so two
        // phones doing this at once can't record an autopay twice.
        const now = new Date();
        for (const b of list) {
          if (refreshBill(b, now)) mutateItem<Bill>(uid, "bills", b.id, cur => refreshBill(cur, now), b).catch(() => {});
        }
      }
    });
  }, [uid]);

  const addBills = async (added: Bill[]) => {
    if (!added.length || !uid) return;
    await Promise.all(added.map(b => createItem(uid, "bills", b)));
  };

  const now = new Date();
  const grouped = useMemo(() => {
    const g: Record<BillGroup, Bill[]> = { overdue: [], week: [], month: [], later: [], nodate: [], done: [] };
    for (const b of bills) g[groupOf(b, now)].push(b);
    for (const k of Object.keys(g) as BillGroup[]) g[k].sort((a, b) => (daysUntilDue(a, now) ?? 9999) - (daysUntilDue(b, now) ?? 9999));
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills]);

  const paidList = paidThisMonth(bills, now);

  // ── Paying ─────────────────────────────────────────────────────
  const startPay = (b: Bill) => {
    const { amount } = displayAmount(b);
    setPayingId(b.id);
    setPayAmount(amount ? String(amount) : "");
  };

  const confirmPay = async (b: Bill, withAmount: boolean) => {
    if (!uid) return;
    const amt = withAmount ? parseFloat(payAmount) : undefined;
    setPayingId(null);
    try {
      const r = await payBill(uid, b, amt && amt > 0 ? amt : undefined);
      if (r.status === "already") { toast(`${b.name} is already marked paid`); return; }
      toast(t => (
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {b.name} marked paid
          <button onClick={async () => {
            toast.dismiss(t.id);
            await undoBillPayment(uid, r.bill, r.due).catch(() => toast.error("Couldn't undo. Try again."));
          }} style={{ background: "none", border: "none", color: T.goldText, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>Undo</button>
        </span>
      ), { duration: 5000 });
    } catch { toast.error("Couldn't save. Try again."); }
  };

  // ── Opened from a bill notification ────────────────────────────
  // The Paid button ticks off the repeat the notification was about (with
  // Undo); a plain tap highlights the bill; the "Not sure" ask opens the editor.
  useEffect(() => {
    if (!loaded) return;
    const handle = () => {
      const f = takeBillFocus();
      if (!f) return;
      const b = billsRef.current.find(x => x.id === f.billId);
      if (!b) return;
      setView({ kind: "list" });
      if (f.askDate) { setView({ kind: "edit", bill: b }); return; }
      if (f.markPaid && !b.autopay && (!f.due || nextDueDate(b) === f.due)) confirmPay(b, false);
      setHighlightId(b.id);
      setTimeout(() => document.getElementById(`bill-${b.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      setTimeout(() => setHighlightId(h => (h === b.id ? null : h)), 3000);
    };
    handle();
    return onBillFocus(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // ── Sub-views ──────────────────────────────────────────────────
  if (!loaded && uid) return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner /></div>;

  if (view.kind === "setup") {
    return (
      <BillSetup
        existing={bills}
        onAdd={addBills}
        onOpenImport={mode => setView({ kind: "import", mode })}
        onDone={() => { markSetupSeen(); setView({ kind: "list" }); }}
      />
    );
  }
  if (view.kind === "import") {
    return (
      <BillImport
        mode={view.mode}
        existing={bills}
        onAdd={async added => { await addBills(added); markSetupSeen(); }}
        onClose={() => setView({ kind: "list" })}
      />
    );
  }
  if (view.kind === "edit") {
    return (
      <BillEditor
        bill={view.bill}
        onCancel={() => setView({ kind: "list" })}
        onSave={async b => {
          // Compare with the bill as it was when the editor opened, and write
          // only what was changed there, so a payment the other person
          // recorded meanwhile is kept.
          const before = view.bill && bills.some(x => x.id === b.id) ? view.bill : null;
          const exists = !!before;
          try {
            if (uid) await (before
              ? updateItem(uid, "bills", b.id, changedFields(before as never, b as never))
              : createItem(uid, "bills", b));
          } catch {
            toast.error("Couldn't save. This bill may have been removed on another phone.");
            setView({ kind: "list" });
            return;
          }
          setView({ kind: "list" });
          toast.success(exists ? "Bill updated" : "Bill added");
        }}
        onDelete={async id => {
          if (uid) await removeItem(uid, "bills", id);
          setView({ kind: "list" });
          toast.success("Bill removed");
        }}
      />
    );
  }

  // ── Main list ──────────────────────────────────────────────────
  const weekBills = [...grouped.overdue, ...grouped.week];
  const weekTotal = weekBills.reduce((s, b) => s + (displayAmount(b).amount || 0), 0);
  const monthly = monthlyEstimate(bills);

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle eyebrow="MONEY" title="Bills" />

      {bills.length === 0 ? (
        <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "22px 18px", marginBottom: 12, textAlign: "center" }}>
          <p style={{ fontFamily: F.serif, fontSize: 21, fontStyle: "italic", color: T.esp, margin: "0 0 6px" }}>Never miss a bill</p>
          <p style={{ fontFamily: F.sans, fontSize: 13.5, color: T.bark, margin: "0 0 16px", lineHeight: 1.6 }}>
            Tell HerNest which bills you have and roughly when they're due. We'll remind you before each one.
          </p>
          <button onClick={() => setView({ kind: "setup" })}
            style={{ background: T.esp, color: "#fff", border: "none", borderRadius: 14, padding: "13px 22px", fontFamily: F.sans, fontSize: 15, fontWeight: 700, cursor: "pointer", minHeight: 48 }}>
            Set up my bills
          </button>
        </div>
      ) : (
        <SummaryCard overdue={grouped.overdue.length} count={weekBills.length} total={weekTotal} />
      )}

      {/* Ways to add */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 4 }}>
        <AddTile icon="📸" label="Screenshot" onClick={() => setView({ kind: "import", mode: "screenshot" })} />
        <AddTile icon="✍️" label="Type it" onClick={() => setView({ kind: "import", mode: "text" })} />
        <AddTile icon="＋" label="Add one" onClick={() => setView({ kind: "edit", bill: null })} />
      </div>

      {GROUPS.map(g => grouped[g.id].length > 0 && (
        <div key={g.id}>
          <SectionHeading color={g.color}>{g.label}</SectionHeading>
          {grouped[g.id].map(b => (
            <BillRow
              key={b.id}
              bill={b}
              now={now}
              paying={payingId === b.id}
              highlight={highlightId === b.id}
              payAmount={payAmount}
              setPayAmount={setPayAmount}
              onOpen={() => setView({ kind: "edit", bill: b })}
              onPay={() => startPay(b)}
              onConfirm={withAmount => confirmPay(b, withAmount)}
              onCancelPay={() => setPayingId(null)}
            />
          ))}
        </div>
      ))}

      {paidList.length > 0 && (
        <div>
          <button onClick={() => setShowPaid(s => !s)} aria-expanded={showPaid}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", width: "100%", textAlign: "left" }}>
            <SectionHeading color={T.sage}>{showPaid ? "▾" : "▸"} Paid this month · {paidList.length}</SectionHeading>
          </button>
          {showPaid && paidList.map(({ bill, payment }) => (
            <div key={`${bill.id}_${payment.due}`} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "#fff", border: `1px solid ${T.linen}`, borderRadius: 14, marginBottom: 6 }}>
              <span style={{ fontFamily: F.sans, fontSize: 14, color: T.bark }}>✓ {bill.name}</span>
              <span style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe }}>
                {payment.amount ? formatMoney(payment.amount) + " · " : ""}{payment.auto ? "autopay" : new Date(`${payment.paidOn}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </div>
          ))}
        </div>
      )}

      {bills.length > 0 && (
        <div style={{ textAlign: "center", padding: "18px 0 8px" }}>
          {monthly > 0 && (
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: "0 0 2px" }}>
              Bills each month: about <strong style={{ color: T.esp }}>{formatMoney(monthly)}</strong>
            </p>
          )}
          <TextLink onClick={() => setView({ kind: "setup" })}>Add more common bills</TextLink>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ overdue, count, total }: { overdue: number; count: number; total: number }) {
  const title = overdue > 0
    ? `${overdue} bill${overdue === 1 ? "" : "s"} overdue`
    : count > 0 ? `${count} bill${count === 1 ? "" : "s"} in the next 7 days` : "Nothing due this week";
  const sub = overdue > 0
    ? "Tap Paid once it's sorted."
    : count > 0 && total > 0 ? `About ${formatMoney(total)} going out` : count > 0 ? "We'll remind you before each one." : "You're all caught up.";
  // Overdue is shown calmly (a soft tint), not as an alarm.
  const tone = overdue > 0
    ? { bg: `${T.red}14`, border: `1px solid ${T.red}40`, eyebrow: T.red, title: T.esp, sub: T.bark }
    : { bg: `linear-gradient(135deg, ${T.esp}, ${T.esp}dd)`, border: "none", eyebrow: "rgba(255,255,255,.6)", title: "#fff", sub: "rgba(255,255,255,.8)" };
  return (
    <div style={{ background: tone.bg, border: tone.border, borderRadius: 24, padding: "20px", marginBottom: 14 }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: tone.eyebrow, margin: "0 0 6px" }}>THIS WEEK</p>
      <p style={{ fontFamily: F.serif, fontSize: 24, fontWeight: 700, color: tone.title, margin: "0 0 4px" }}>{title}</p>
      <p style={{ fontFamily: F.sans, fontSize: 13, color: tone.sub, margin: 0 }}>{sub}</p>
    </div>
  );
}

function AddTile({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{ background: "#fff", border: `1px solid ${T.linen}`, borderRadius: 14, padding: "12px 6px", cursor: "pointer", minHeight: 64, touchAction: "manipulation" }}>
      <div style={{ fontSize: 20, marginBottom: 2 }} aria-hidden>{icon}</div>
      <div style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: T.bark }}>{label}</div>
    </button>
  );
}

function BillRow({ bill, now, paying, highlight, payAmount, setPayAmount, onOpen, onPay, onConfirm, onCancelPay }: {
  bill: Bill; now: Date; paying: boolean; highlight?: boolean; payAmount: string; setPayAmount: (v: string) => void;
  onOpen: () => void; onPay: () => void; onConfirm: (withAmount: boolean) => void; onCancelPay: () => void;
}) {
  const group = groupOf(bill, now);
  const { amount, estimate } = displayAmount(bill);
  const label = dueLabel(bill, now);
  const urgent = group === "overdue" || (daysUntilDue(bill, now) ?? 99) <= 1;
  const canPay = group !== "nodate" && group !== "done";

  return (
    <div id={`bill-${bill.id}`} style={{ background: "#fff", border: `1px solid ${group === "overdue" ? `${T.red}55` : T.linen}`, borderRadius: 16, padding: "12px 14px", marginBottom: 8, boxShadow: highlight ? `0 0 0 2px ${T.esp}` : "none", transition: "box-shadow .4s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onOpen} aria-label={`Edit ${bill.name}`}
          style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}>
          <p style={{ fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: T.esp, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bill.name}</p>
          <p style={{ fontFamily: F.sans, fontSize: 12.5, color: urgent ? T.red : T.taupe, margin: 0 }}>
            {label}{amount ? ` · ${estimate ? "about " : ""}${formatMoney(amount)}` : ""}
          </p>
        </button>
        {bill.autopay && canPay ? (
          <span style={{ fontFamily: F.sans, fontSize: 11.5, fontWeight: 700, color: T.sage, background: T.sageP, borderRadius: 10, padding: "6px 10px" }}>Autopay</span>
        ) : canPay && !paying ? (
          <button onClick={onPay}
            style={{ background: urgent ? T.esp : T.sand, color: urgent ? "#fff" : T.esp, border: "none", borderRadius: 12, padding: "10px 16px", fontFamily: F.sans, fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44, touchAction: "manipulation" }}>
            Paid
          </button>
        ) : group === "nodate" ? (
          <button onClick={onOpen}
            style={{ background: T.sand, color: T.esp, border: "none", borderRadius: 12, padding: "10px 14px", fontFamily: F.sans, fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 44 }}>
            Add date
          </button>
        ) : null}
      </div>

      {paying && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.linen}` }}>
          <label style={{ display: "block", fontFamily: F.sans, fontSize: 12.5, color: T.bark, margin: "0 0 6px" }}>How much was it? (optional)</label>
          <input value={payAmount} onChange={e => setPayAmount(e.target.value)} type="number" inputMode="decimal" placeholder="Amount" autoFocus
            style={{ ...inputStyle, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => onConfirm(true)}
              style={{ flex: 2, background: T.esp, color: "#fff", border: "none", borderRadius: 12, padding: "11px", fontFamily: F.sans, fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 44 }}>
              Mark paid
            </button>
            <button onClick={() => onConfirm(false)}
              style={{ flex: 1, background: T.sand, color: T.bark, border: "none", borderRadius: 12, padding: "11px", fontFamily: F.sans, fontSize: 13.5, fontWeight: 600, cursor: "pointer", minHeight: 44 }}>
              Skip amount
            </button>
            <button onClick={onCancelPay} aria-label="Cancel"
              style={{ background: "none", color: T.taupe, border: "none", padding: "0 6px", fontSize: 18, cursor: "pointer", minHeight: 44 }}>
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
