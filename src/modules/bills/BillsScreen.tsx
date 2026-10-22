// ─── Bills: the money side of HerNest ──────────────────────────────
// One job: never miss a bill. Shows what is due, lets you tick it off, and
// gets bills in with as little typing as possible (tap setup, a screenshot,
// or one typed line). Replaces the old Budget screens (their data in
// budget_v2 is left untouched). Design: docs/superpowers/specs/2026-10-21-bills-redesign-design.md
import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { T, F, S, TYPE, ATMOS, ATMOS_TEXT2 } from "../../config/theme";
import { useStore } from "../../core/store";
import { subscribeItems, createItem, updateItem, removeItem, mutateItem, changedFields } from "../../core/householdItems";
import { Emoji, PageTitle, Card, SectionHeader, ListRow, StatusChip, Button, TextButton, EmptyState, Skeleton, SkeletonRows, GlowCard, HeroNumber, Headline, Detail, MiniBars } from "../../shared/components";
import { showUndoToast } from "../../shared/components/undoToast";
import { PlusIcon, CameraIcon, EditIcon, BudgetIcon } from "../../shared/components/Icons";
import { formatMoney } from "../../shared/utils/money";
import {
  type Bill, type BillGroup, groupOf, dueLabel, displayAmount,
  monthlyEstimate, paidThisMonth, daysUntilDue, nextDueDate, iso, autopayStatus, autopayDueDates,
} from "../../core/bills";
import { takeBillFocus, onBillFocus } from "../../core/billReminders";
import { syncBillReminders } from "../../core/localNotifications";
import { payBill, undoBillPayment, confirmAutopayPayment, markAutopayFailed } from "./billActions";
import { BillEditor } from "./BillEditor";
import { BillSetup } from "./BillSetup";
import { BillImport } from "./BillImport";
import { inputStyle } from "./billsStyle";
import { BillIcon } from "./BillIcon";
import { haptic } from "../../shared/haptics";

const SETUP_DONE_KEY = "hn_bills_setup_seen";

const GROUPS: { id: BillGroup; label: string }[] = [
  { id: "check",   label: "Did autopay go through?" },
  { id: "overdue", label: "Overdue" },
  { id: "week",    label: "This week" },
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
// repeats never count as missed). Autopay is never ticked off here: it waits
// for someone to confirm it went through. Returns null when nothing changes.
function refreshBill(b: Bill, now: Date): Bill | null {
  return b.addedOn ? null : { ...b, addedOn: iso(now) };
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
    const g: Record<BillGroup, Bill[]> = { check: [], overdue: [], week: [], month: [], later: [], nodate: [], done: [] };
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
      haptic("success");
      showUndoToast(`${b.name} marked as paid`, () => {
        undoBillPayment(uid, r.bill, r.due).catch(() => toast.error("Couldn't undo. Try again."));
      });
    } catch { toast.error("Couldn't save. Try again."); }
  };

  // ── Autopay checks ─────────────────────────────────────────────
  const confirmAuto = async (b: Bill) => {
    if (!uid) return;
    try {
      const r = await confirmAutopayPayment(uid, b);
      toast.success(r ? `${b.name} confirmed as paid` : `${b.name} was already confirmed`);
    } catch { toast.error("Couldn't save. Try again."); }
  };
  const autoFailed = async (b: Bill) => {
    if (!uid) return;
    try {
      const r = await markAutopayFailed(uid, b);
      if (r) toast(`${b.name} is now overdue. Mark it paid once it's sorted.`);
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
  if (!loaded && uid) return (
    <div>
      <PageTitle title="Bills" />
      <Skeleton height={230} radius={24} style={{ marginBottom: S.md }} />
      <Skeleton height={50} radius={12} />
      <Card style={{ marginTop: S.xxl, padding: `${S.xs}px ${S.lg}px` }}><SkeletonRows rows={3} /></Card>
    </div>
  );

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
  const weekAutopay = weekBills.filter(b => b.autopay).length;
  const monthly = monthlyEstimate(bills);

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <PageTitle collapse title="Bills" subtitle={bills.length ? "What's due, what's paid, what needs you" : undefined} />

      {bills.length === 0 ? (
        <Card>
          <EmptyState tint="household"
            icon={<BudgetIcon size={26} color={T.householdInk} />}
            title="Never miss a bill"
            body="Tell HerNest which bills you have and roughly when they're due. We'll remind you before each one."
            actionLabel="Set up my bills"
            onAction={() => setView({ kind: "setup" })} />
        </Card>
      ) : (
        <SummaryCard overdue={grouped.overdue.length} count={weekBills.length} total={weekTotal} autopay={weekAutopay} toCheck={grouped.check.length}
          next={grouped.overdue[0] ?? grouped.week[0] ?? null} now={now} days={weekByDay(weekBills, now)} />
      )}

      {/* Ways to add */}
      <div style={{ display: "flex", gap: S.sm, marginBottom: S.xs }}>
        <Button onClick={() => setView({ kind: "edit", bill: null })} style={addBtn}><PlusIcon size={18} color="#fff" strokeWidth={2.2} />Add bill</Button>
        <Button variant="secondary" onClick={() => setView({ kind: "import", mode: "screenshot" })} style={addBtn} ariaLabel="Add a bill from a photo or screenshot"><CameraIcon size={18} />Photo</Button>
        <Button variant="secondary" onClick={() => setView({ kind: "import", mode: "text" })} style={addBtn} ariaLabel="Add a bill by typing it"><EditIcon size={17} />Type it</Button>
      </div>

      {GROUPS.map(g => grouped[g.id].length > 0 && (
        <section key={g.id} aria-label={g.label}>
          <SectionHeader title={g.label} />
          <Card style={{ padding: `${S.xs}px ${S.lg}px` }}>
            {grouped[g.id].map((b, i) => (
              <BillRow
                key={b.id}
                first={i === 0}
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
                onConfirmAuto={() => confirmAuto(b)}
                onAutoFailed={() => autoFailed(b)}
              />
            ))}
          </Card>
        </section>
      ))}

      {paidList.length > 0 && (
        <section aria-label="Paid this month">
          <SectionHeader title={`Paid this month · ${paidList.length}`} action={showPaid ? "Hide" : "Show"} onAction={() => setShowPaid(s => !s)} />
          {showPaid && (
            <Card style={{ padding: `${S.xs}px ${S.lg}px` }}>
              {paidList.map(({ bill, payment }, i) => {
                const when = new Date(`${payment.paidOn}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <ListRow key={`${bill.id}_${payment.due}`} divider={i > 0}
                    leading={<BillIcon name={bill.name} />}
                    title={bill.name}
                    detail={payment.auto ? (payment.confirmedBy ? `Autopay, confirmed for ${when}` : `Autopay ran ${when} (not confirmed)`) : `Paid ${when}`}
                    trailing={
                      <div style={{ textAlign: "right" }}>
                        {payment.amount ? <div style={amountStyle}>{formatMoney(payment.amount)}</div> : null}
                        <div style={{ marginTop: 4 }}>
                          {/* Only a payment someone marked or confirmed is "Paid". */}
                          {payment.auto && !payment.confirmedBy ? <StatusChip status="autopay">Autopay</StatusChip> : <StatusChip status="paid">Paid</StatusChip>}
                        </div>
                      </div>
                    } />
                );
              })}
            </Card>
          )}
        </section>
      )}

      {bills.length > 0 && (
        <div style={{ textAlign: "center", padding: `${S.xl}px 0 ${S.sm}px` }}>
          {monthly > 0 && (
            <p style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text2, margin: "0 0 2px" }}>
              Bills each month: about <strong style={{ color: T.text }}>{formatMoney(monthly)}</strong>
            </p>
          )}
          <TextButton onClick={() => setView({ kind: "setup" })}>Add more common bills</TextButton>
        </div>
      )}
    </div>
  );
}

const addBtn: React.CSSProperties = { flex: 1, minWidth: 0, width: "auto", padding: "0 10px" };
const amountStyle: React.CSSProperties = { fontFamily: F.sans, fontSize: TYPE.card, fontWeight: 700, color: T.text, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

// What's due on each of the next 7 days (overdue bills count as today).
function weekByDay(list: Bill[], now: Date): number[] {
  const out = Array(7).fill(0);
  for (const b of list) {
    const d = Math.max(0, Math.min(6, daysUntilDue(b, now) ?? 0));
    out[d] += displayAmount(b).amount || 0.01; // a bill with no amount still shows
  }
  return out;
}
const dayLetters = (now: Date) => Array.from({ length: 7 }, (_, i) => {
  if (i === 0) return "Today";
  const d = new Date(now); d.setDate(d.getDate() + i);
  return d.toLocaleDateString("en-US", { weekday: "narrow" });
});

// Sage when things are on track; a soft rose with the word "Overdue" when
// a bill is late. Calm, never an alarm. The big number is what's due this
// week; the bars show which days.
function SummaryCard({ overdue, count, total, autopay, toCheck, next, now, days }: {
  overdue: number; count: number; total: number; autopay: number; toCheck: number;
  next: Bill | null; now: Date; days: number[];
}) {
  const late = overdue > 0;
  const tint = late ? "alert" : "household";
  const a = ATMOS[tint];
  const check = toCheck ? ` · ${toCheck} autopay to confirm` : "";
  const detail = count === 0
    ? (toCheck ? `${toCheck} autopay to confirm` : "Nothing due in the next 7 days.")
    : `${count} bill${count === 1 ? "" : "s"} coming up${autopay ? ` · ${autopay} on autopay` : ""}${check}`;
  const headline = late
    ? (overdue === 1 ? "1 bill is overdue. Mark it paid once it's sorted." : `${overdue} bills are overdue. Mark each one paid once it's sorted.`)
    : next ? `${next.name} is next, ${dueLabel(next, now).replace(/^Due /, "due ")}.`
    : "You're all caught up.";
  return (
    <GlowCard tint={tint} ariaLabel="This week" eyebrow={late ? "Needs you" : "Due in the next 7 days"} reveal={false}>
      <HeroNumber
        value={count === 0 ? "$0" : total > 0 ? formatMoney(total) : `${count}`}
        unit={count > 0 && !(total > 0) ? (count === 1 ? "bill" : "bills") : undefined}
        size={48} />
      <Headline size={21} style={{ marginTop: 12 }}>{headline}</Headline>
      <Detail>{detail}</Detail>
      {count > 0 && (
        <div style={{ marginTop: 18 }}>
          <MiniBars values={days} labels={dayLetters(now)} color={a.chart} soft={a.chartSoft} highlight={days.findIndex(v => v > 0)} textColor={ATMOS_TEXT2} height={52} />
        </div>
      )}
    </GlowCard>
  );
}

function BillRow({ bill, now, first, paying, highlight, payAmount, setPayAmount, onOpen, onPay, onConfirm, onCancelPay, onConfirmAuto, onAutoFailed }: {
  bill: Bill; now: Date; first: boolean; paying: boolean; highlight?: boolean; payAmount: string; setPayAmount: (v: string) => void;
  onOpen: () => void; onPay: () => void; onConfirm: (withAmount: boolean) => void; onCancelPay: () => void;
  onConfirmAuto: () => void; onAutoFailed: () => void;
}) {
  const group = groupOf(bill, now);
  const { amount, estimate } = displayAmount(bill);
  const label = dueLabel(bill, now);
  const soon = group === "overdue" || group === "week";
  const canPay = group !== "nodate" && group !== "done" && group !== "check";
  const ap = autopayStatus(bill, now);
  // Autopay is paid by the bank; a failed one is paid by hand like any bill.
  const payByHand = !bill.autopay || ap === "failed";
  const checkDates = group === "check" ? autopayDueDates(bill, now) : [];
  const shortDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Status in words. Autopay is "scheduled", never "paid", until confirmed.
  const chip = group === "check" ? <StatusChip status="dueSoon">Not confirmed</StatusChip>
    : group === "overdue" ? <StatusChip status="overdue">Overdue</StatusChip>
    : group === "nodate" ? <StatusChip status="neutral">No date</StatusChip>
    : bill.autopay ? <StatusChip status="autopay">{soon ? "Autopay scheduled" : "Autopay"}</StatusChip>
    : soon ? <StatusChip status="unpaid">Unpaid</StatusChip>
    : null;

  return (
    <div id={`bill-${bill.id}`} style={{ borderRadius: 12, boxShadow: highlight ? `0 0 0 2px ${T.action}` : "none", transition: "box-shadow .4s ease" }}>
      <ListRow divider={!first}
        onClick={paying ? undefined : onOpen}
        ariaLabel={`Edit ${bill.name}`}
        leading={<BillIcon name={bill.name} />}
        title={bill.name}
        detail={group === "check"
          ? (checkDates.length > 1 ? `Autopay was due ${shortDate(checkDates[0])} and ${checkDates.length - 1} more time${checkDates.length > 2 ? "s" : ""}` : `Autopay was due ${shortDate(checkDates[0])}`)
          : ap === "failed" ? `${label} · autopay didn't go through` : label}
        trailing={
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            {amount ? <div style={amountStyle}>{estimate ? "about " : ""}{formatMoney(amount)}</div> : null}
            {chip && <div style={{ marginTop: 4 }}>{chip}</div>}
          </div>
        } />
      {group === "check" && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: S.sm, margin: "-4px 0 12px", flexWrap: "wrap" }}>
          <Button size="sm" variant="secondary" onClick={onAutoFailed} style={{ width: "auto" }} ariaLabel={`${bill.name} autopay didn't go through`}>It didn't go through</Button>
          <Button size="sm" onClick={onConfirmAuto} style={{ width: "auto" }} ariaLabel={`Confirm ${bill.name} autopay was paid`}>Confirm paid</Button>
        </div>
      )}
      {canPay && payByHand && !paying && (
        <div style={{ display: "flex", justifyContent: "flex-end", margin: "-4px 0 12px" }}>
          <Button size="sm" variant={soon ? "primary" : "secondary"} onClick={onPay} style={{ width: "auto" }} ariaLabel={`Mark ${bill.name} as paid`}>Mark as paid</Button>
        </div>
      )}
      {group === "nodate" && (
        <div style={{ display: "flex", justifyContent: "flex-end", margin: "-4px 0 12px" }}>
          <Button size="sm" variant="gentle" onClick={onOpen} style={{ width: "auto" }}>Add a due date</Button>
        </div>
      )}

      {paying && (
        <div style={{ padding: `0 0 ${S.md}px` }}>
          <label htmlFor={`pay-${bill.id}`} style={{ display: "block", fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text, margin: "0 0 6px" }}>How much was it? (optional)</label>
          <input id={`pay-${bill.id}`} value={payAmount} onChange={e => setPayAmount(e.target.value)} type="number" inputMode="decimal" placeholder="Amount" autoFocus
            style={{ ...inputStyle, marginBottom: S.sm }} />
          <div style={{ display: "flex", gap: S.sm }}>
            <Button size="sm" onClick={() => onConfirm(true)} style={{ flex: 2 }}>Mark as paid</Button>
            <Button size="sm" variant="secondary" onClick={() => onConfirm(false)} style={{ flex: 1.3 }}>Skip amount</Button>
            <Button size="sm" variant="ghost" onClick={onCancelPay} ariaLabel="Cancel" style={{ width: 44, padding: 0, border: "none" }}><Emoji e="✕" size={16} /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
