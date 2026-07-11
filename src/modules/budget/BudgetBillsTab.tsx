import React, { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { Card, Button, EmptyState } from "../../shared/components";
import { SectionLabel } from "./BudgetWidgets";
import { saveData, loadData } from "../../core/firebase";
import { nextDueDate, daysUntilDue } from "../../core/bills";
import type { Bill } from "./budgetShared";
import toast from "react-hot-toast";

const CADENCES: { id: Bill["cadence"]; label: string }[] = [
  { id: "monthly", label: "Monthly" },
  { id: "weekly", label: "Weekly" },
  { id: "yearly", label: "Yearly" },
  { id: "once", label: "One-time" },
];

// Human, colored due status.
function dueStatus(bill: Bill): { text: string; color: string } {
  const days = daysUntilDue(bill);
  if (days == null) return { text: "no date set", color: T.taupe };
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, color: T.blush };
  if (days === 0) return { text: "due today", color: T.blush };
  if (days === 1) return { text: "due tomorrow", color: "#C77B3B" };
  if (days <= 5) return { text: `due in ${days} days`, color: "#C77B3B" };
  return { text: `due in ${days} days`, color: T.sage };
}

export function BudgetBillsTab({ uid }: { uid: string }) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<Bill["cadence"]>("monthly");
  const [dueDay, setDueDay] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [autopay, setAutopay] = useState(false);

  useEffect(() => {
    loadData(uid, "bills").then(d => {
      if (d?.bills) setBills(d.bills as Bill[]);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [uid]);

  const persist = async (next: Bill[]) => {
    setBills(next);
    await saveData(uid, "bills", JSON.parse(JSON.stringify({ bills: next })));
  };

  const resetForm = () => {
    setShowAdd(false); setEditingId(null); setName(""); setAmount("");
    setCadence("monthly"); setDueDay(""); setDueDate(""); setAutopay(false);
  };

  const save = async () => {
    if (!name.trim() || !amount) return;
    const base: Bill = {
      id: editingId || crypto.randomUUID(),
      name: name.trim(),
      amount: Math.abs(parseFloat(amount)) || 0,
      cadence,
      dueDay: cadence === "monthly" ? Math.min(Math.max(parseInt(dueDay) || 1, 1), 31) : undefined,
      dueDate: cadence !== "monthly" ? (dueDate || undefined) : undefined,
      autopay,
    };
    const next = editingId ? bills.map(b => b.id === editingId ? { ...b, ...base } : b) : [...bills, base];
    await persist(next);
    resetForm();
    toast.success(editingId ? "Bill updated ✓" : "Bill added ✓");
  };

  const startEdit = (b: Bill) => {
    setEditingId(b.id); setName(b.name); setAmount(String(b.amount)); setCadence(b.cadence);
    setDueDay(b.dueDay ? String(b.dueDay) : ""); setDueDate(b.dueDate || ""); setAutopay(!!b.autopay);
    setShowAdd(true);
  };

  const markPaid = async (b: Bill) => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (b.cadence === "once") {
      await persist(bills.filter(x => x.id !== b.id));
      toast.success("Paid & cleared ✓");
    } else {
      await persist(bills.map(x => x.id === b.id ? { ...x, lastPaidDate: iso } : x));
      toast.success("Marked paid ✓");
    }
  };

  const remove = async (id: string) => persist(bills.filter(b => b.id !== id));

  const sorted = [...bills].sort((a, b) => (daysUntilDue(a) ?? 9999) - (daysUntilDue(b) ?? 9999));
  const monthlyTotal = bills.filter(b => b.cadence === "monthly").reduce((s, b) => s + b.amount, 0);

  const inputStyle: React.CSSProperties = { width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "11px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 8, boxSizing: "border-box" };

  return (
    <>
      {bills.length > 0 && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe }}>Monthly bills</span>
            <span style={{ fontFamily: F.serif, fontSize: 20, fontWeight: 700, color: T.esp }}>${monthlyTotal.toLocaleString()}</span>
          </div>
        </Card>
      )}

      {!showAdd ? (
        <Button onClick={() => setShowAdd(true)} variant="gold">+ Add a bill</Button>
      ) : (
        <Card>
          <SectionLabel>{editingId ? "Edit bill" : "New bill"}</SectionLabel>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Bill name e.g. Rent, Netflix" style={inputStyle} />
          <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount" type="number" inputMode="decimal" style={inputStyle} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {CADENCES.map(c => (
              <button key={c.id} onClick={() => setCadence(c.id)} style={{ padding: "6px 12px", borderRadius: 16, border: `1.5px solid ${cadence === c.id ? T.gold : T.linen}`, background: cadence === c.id ? `${T.gold}20` : "#fff", fontFamily: F.sans, fontSize: 11, color: cadence === c.id ? "#8B6914" : T.bark, cursor: "pointer" }}>{c.label}</button>
            ))}
          </div>
          {cadence === "monthly" ? (
            <input value={dueDay} onChange={e => setDueDay(e.target.value)} placeholder="Due day of month (1–31)" type="number" min={1} max={31} style={inputStyle} />
          ) : (
            <>
              <label style={{ display: "block", fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "0 0 4px 2px" }}>{cadence === "weekly" ? "First due date" : cadence === "yearly" ? "Renews on" : "Due date"}</label>
              <input value={dueDate} onChange={e => setDueDate(e.target.value)} type="date" style={inputStyle} />
            </>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F.sans, fontSize: 13, color: T.bark, marginBottom: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={autopay} onChange={e => setAutopay(e.target.checked)} /> On autopay (reminder only, no action needed)
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={!name.trim() || !amount} style={{ flex: 1, padding: "12px", background: name.trim() && amount ? T.esp : T.linen, color: "#fff", border: "none", borderRadius: 12, fontFamily: F.sans, fontSize: 14, fontWeight: 600, cursor: name.trim() && amount ? "pointer" : "not-allowed", minHeight: 48 }}>{editingId ? "Save" : "Add bill"}</button>
            <button onClick={resetForm} style={{ padding: "12px 18px", background: "none", border: `1px solid ${T.linen}`, borderRadius: 12, fontFamily: F.sans, fontSize: 14, color: T.taupe, cursor: "pointer", minHeight: 48 }}>Cancel</button>
          </div>
        </Card>
      )}

      {loaded && bills.length === 0 && !showAdd && (
        <EmptyState icon="💳" title="No bills yet" body="Add your recurring bills and Cleo will remind you before each one is due." />
      )}

      {sorted.map(b => {
        const st = dueStatus(b);
        return (
          <Card key={b.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: F.sans, fontSize: 15, fontWeight: 700, color: T.esp, margin: 0 }}>{b.name}</p>
                <p style={{ fontFamily: F.sans, fontSize: 12, margin: "3px 0 0", color: st.color, fontWeight: 600 }}>
                  {st.text}{b.autopay ? " · autopay" : ""}{nextDueDate(b) ? ` · ${nextDueDate(b)}` : ""}
                </p>
              </div>
              <p style={{ fontFamily: F.serif, fontSize: 18, fontWeight: 700, color: T.esp, margin: 0, whiteSpace: "nowrap" }}>${b.amount.toLocaleString()}</p>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {!b.autopay && <button onClick={() => markPaid(b)} style={{ flex: 1, padding: "8px", background: `${T.sage}15`, border: `1px solid ${T.sage}40`, borderRadius: 10, fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: T.sage, cursor: "pointer", minHeight: 36 }}>Mark paid</button>}
              <button onClick={() => startEdit(b)} style={{ padding: "8px 14px", background: "none", border: `1px solid ${T.linen}`, borderRadius: 10, fontFamily: F.sans, fontSize: 12, color: T.taupe, cursor: "pointer", minHeight: 36 }}>Edit</button>
              <button onClick={() => remove(b.id)} style={{ padding: "8px 14px", background: "none", border: `1px solid ${T.linen}`, borderRadius: 10, fontFamily: F.sans, fontSize: 12, color: T.taupe, cursor: "pointer", minHeight: 36 }}>Delete</button>
            </div>
          </Card>
        );
      })}
    </>
  );
}
