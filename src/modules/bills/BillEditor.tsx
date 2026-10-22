// ─── Add or edit one bill ──────────────────────────────────────────
// Only the name is required. No amount or no date is fine: the reminder still
// works, and the amount is learned when the bill is first marked paid.
import React, { useState } from "react";
import { T, F } from "../../config/theme";
import { PageTitle } from "../../shared/components";
import { useStore } from "../../core/store";
import { formatMoney } from "../../shared/utils/money";
import { CADENCES, iso, nextDueDate, type Bill, type Cadence } from "../../core/bills";
import { DayPicker, GhostButton, PrimaryButton, SectionHeading } from "./billsUi";
import { inputStyle } from "./billsStyle";

export function BillEditor({ bill, onSave, onCancel, onDelete }: {
  bill: Bill | null;
  onSave: (b: Bill) => void | Promise<void>;
  onCancel: () => void;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(bill?.name || "");
  const [amount, setAmount] = useState(bill?.amount ? String(bill.amount) : "");
  const [varies, setVaries] = useState(!!bill?.amountVaries);
  const [cadence, setCadence] = useState<Cadence>(bill?.cadence || "monthly");
  const [dueDay, setDueDay] = useState<number | undefined>(bill?.dueDay);
  const [dueDate, setDueDate] = useState(bill?.dueDate || "");
  const [autopay, setAutopay] = useState(!!bill?.autopay);
  const [payer, setPayer] = useState<string | undefined>(bill?.payer);
  const uid = useStore(s => s.user?.uid);
  const others = useStore(s => s.householdMembers).filter(m => m.uid && m.uid !== uid);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    if (!name.trim()) return;
    const amt = parseFloat(amount);
    const monthly = cadence === "monthly";
    const hasDate = monthly ? !!dueDay : !!dueDate;
    const scheduleChanged = !!bill && (bill.cadence !== cadence || bill.dueDay !== (monthly ? dueDay : undefined) || (bill.dueDate || "") !== (monthly ? "" : dueDate));
    const next: Bill = {
      ...(bill || { id: crypto.randomUUID(), addedOn: iso(new Date()), source: "manual" as const }),
      name: name.trim().slice(0, 60),
      cadence,
      autopay,
      amountVaries: varies,
    };
    if (payer) next.payer = payer; else delete next.payer;
    if (amt > 0) next.amount = Math.round(amt * 100) / 100; else delete next.amount;
    if (monthly) { next.dueDay = dueDay; delete next.dueDate; } else { next.dueDate = dueDate || undefined; delete next.dueDay; }
    if (hasDate) delete next.dueUnknown; else next.dueUnknown = true;
    // A new schedule starts fresh from today, so old repeats don't show as missed.
    if (scheduleChanged) { next.addedOn = iso(new Date()); delete next.paidThrough; }
    onSave(next);
  };

  const preview = (() => {
    const monthly = cadence === "monthly";
    const probe: Bill = { id: "p", name, cadence, dueDay: monthly ? dueDay : undefined, dueDate: monthly ? undefined : dueDate || undefined, addedOn: iso(new Date()) };
    const nd = nextDueDate(probe);
    return nd ? new Date(`${nd}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null;
  })();

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <PageTitle eyebrow="BILLS" title={bill ? "Edit bill" : "Add a bill"} />

      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name, e.g. Electric or Netflix" aria-label="Bill name" style={inputStyle} />
      <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (optional)" aria-label="Amount" type="number" inputMode="decimal" style={inputStyle} />
      <label style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: F.sans, fontSize: 14, color: T.bark, margin: "0 0 4px", minHeight: 40, cursor: "pointer" }}>
        <input type="checkbox" checked={varies} onChange={e => setVaries(e.target.checked)} style={{ width: 20, height: 20 }} />
        The amount changes each time
      </label>

      <SectionHeading>How often</SectionHeading>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {CADENCES.map(c => (
          <button key={c.id} onClick={() => setCadence(c.id)} aria-pressed={cadence === c.id}
            style={{ padding: "9px 13px", borderRadius: 18, border: `1.5px solid ${cadence === c.id ? T.esp : T.linen}`, background: cadence === c.id ? T.esp : "#fff", color: cadence === c.id ? "#fff" : T.bark, fontFamily: F.sans, fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 40 }}>
            {c.label}
          </button>
        ))}
      </div>

      <SectionHeading>{cadence === "monthly" ? "Day of the month it's due" : cadence === "once" ? "Due date" : "Next due date"}</SectionHeading>
      {cadence === "monthly" ? (
        <DayPicker value={dueDay} onPick={setDueDay} allowUnsure onUnsure={() => setDueDay(undefined)} />
      ) : (
        <input value={dueDate} onChange={e => setDueDate(e.target.value)} type="date" aria-label="Due date" style={inputStyle} />
      )}
      <p style={{ fontFamily: F.sans, fontSize: 12.5, color: T.taupe, margin: "8px 4px 0" }}>
        {preview ? `Next due ${preview}` : "No date yet. You can add it later."}
      </p>

      <label style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: F.sans, fontSize: 14, color: T.bark, margin: "16px 0 18px", minHeight: 40, cursor: "pointer" }}>
        <input type="checkbox" checked={autopay} onChange={e => setAutopay(e.target.checked)} style={{ width: 20, height: 20 }} />
        It's on autopay (we'll just give you a heads-up)
      </label>

      {uid && others.length > 0 && (
        <>
          <SectionHeading>Who pays it?</SectionHeading>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            {[
              { id: uid, label: "Me" },
              ...others.map(m => ({ id: m.uid, label: others.length === 1 ? "Partner" : (m.displayName || "Partner").split(" ")[0] })),
              { id: undefined, label: "Either" },
            ].map(o => (
              <button key={o.id || "either"} onClick={() => setPayer(o.id)} aria-pressed={payer === o.id}
                style={{ padding: "9px 13px", borderRadius: 18, border: `1.5px solid ${payer === o.id ? T.esp : T.linen}`, background: payer === o.id ? T.esp : "#fff", color: payer === o.id ? "#fff" : T.bark, fontFamily: F.sans, fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 40 }}>
                {o.label}
              </button>
            ))}
          </div>
          <p style={{ fontFamily: F.sans, fontSize: 12.5, color: T.taupe, margin: "0 4px 18px" }}>
            Reminders go only to whoever pays it. "Either" reminds you both.
          </p>
        </>
      )}

      <PrimaryButton onClick={save} disabled={!name.trim()}>{bill ? "Save" : "Add bill"}</PrimaryButton>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <GhostButton onClick={onCancel} style={{ flex: 1 }}>Cancel</GhostButton>
        {bill && (
          confirmDelete ? (
            <GhostButton onClick={() => onDelete(bill.id)} style={{ flex: 1, color: T.red, borderColor: `${T.red}66` }}>Yes, remove it</GhostButton>
          ) : (
            <GhostButton onClick={() => setConfirmDelete(true)} style={{ flex: 1 }}>Remove</GhostButton>
          )
        )}
      </div>

      {bill?.payments && bill.payments.length > 0 && (
        <>
          <SectionHeading>Recent payments</SectionHeading>
          {bill.payments.slice(0, 6).map(p => (
            <div key={`${p.due}_${p.paidOn}`} style={{ display: "flex", justifyContent: "space-between", padding: "9px 4px", borderBottom: `1px solid ${T.linen}`, fontFamily: F.sans, fontSize: 13.5, color: T.bark }}>
              <span>{new Date(`${p.due}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              <span style={{ color: T.taupe }}>{p.amount ? formatMoney(p.amount) : "paid"}{p.auto ? (p.confirmedBy ? " · autopay, confirmed" : " · autopay, not confirmed") : ""}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
