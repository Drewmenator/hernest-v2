import React from "react";
import { T, F } from "../../config/theme";
import { Card, Button, ProgressBar } from "../../shared/components";
import { SectionLabel, StatCard } from "./BudgetWidgets";
import type { Category, Expense, Income } from "./budgetShared";

export function BudgetOverviewTab({
  cats, expenses, incomes, monthlyIncome, cashRemaining, projected, totalBudget, savingsRate,
  showAddExp, setShowAddExp, addExpAmount, setAddExpAmount, addExpMerchant, setAddExpMerchant,
  addExpNote, setAddExpNote, addExpCat, setAddExpCat, addExpense,
  showAddIncome, setShowAddIncome, incLabel, setIncLabel, incAmount, setIncAmount, incFreq, setIncFreq, addIncome,
  bankConnected, bankBusy, connectBank, refreshBank, handleCSV,
}: {
  cats: Category[]; expenses: Expense[]; incomes: Income[];
  monthlyIncome: number; cashRemaining: number; projected: number; totalBudget: number; savingsRate: number;
  showAddExp: boolean; setShowAddExp: React.Dispatch<React.SetStateAction<boolean>>;
  addExpAmount: string; setAddExpAmount: React.Dispatch<React.SetStateAction<string>>;
  addExpMerchant: string; setAddExpMerchant: React.Dispatch<React.SetStateAction<string>>;
  addExpNote: string; setAddExpNote: React.Dispatch<React.SetStateAction<string>>;
  addExpCat: string; setAddExpCat: React.Dispatch<React.SetStateAction<string>>;
  addExpense: () => Promise<void>;
  showAddIncome: boolean; setShowAddIncome: React.Dispatch<React.SetStateAction<boolean>>;
  incLabel: string; setIncLabel: React.Dispatch<React.SetStateAction<string>>;
  incAmount: string; setIncAmount: React.Dispatch<React.SetStateAction<string>>;
  incFreq: Income["frequency"]; setIncFreq: React.Dispatch<React.SetStateAction<Income["frequency"]>>;
  addIncome: () => Promise<void>;
  bankConnected: boolean; bankBusy: boolean;
  connectBank: () => Promise<void>; refreshBank: () => Promise<void>;
  handleCSV: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}) {
  return (
    <>
      {/* Quick stats row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <StatCard label="Cash Left" value={`$${Math.max(0, Math.round(cashRemaining)).toLocaleString()}`}
          sub={monthlyIncome > 0 ? `of $${Math.round(monthlyIncome).toLocaleString()} income` : "of budget"}
          color={cashRemaining < 0 ? T.blush : T.sage} />
        <StatCard label="Projected" value={`$${projected.toLocaleString()}`}
          sub={projected > totalBudget ? `⚠ $${projected - totalBudget} over` : `✓ $${totalBudget - projected} under`}
          color={projected > totalBudget ? T.blush : T.sage} />
        {savingsRate > 0 && (
          <StatCard label="Savings Rate" value={`${savingsRate.toFixed(0)}%`}
            sub={savingsRate >= 15 ? "Excellent" : savingsRate >= 10 ? "Good" : "Needs work"}
            color={savingsRate >= 15 ? T.sage : savingsRate >= 5 ? T.gold : T.blush} />
        )}
      </div>

      {/* Category breakdown */}
      <SectionLabel>Spending by Category</SectionLabel>
      {cats.map(c => (
        <Card key={c.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>{c.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp }}>{c.label}</span>
                <span style={{ fontFamily: F.sans, fontSize: 12, color: c.spent > c.budget ? T.blush : T.taupe }}>
                  ${c.spent.toFixed(0)} / ${c.budget}
                </span>
              </div>
              <ProgressBar value={c.spent} max={c.budget} color={c.spent > c.budget ? "#ff6b6b" : c.color} height={5} />
            </div>
          </div>
        </Card>
      ))}

      {/* Add Expense */}
      <div style={{ marginTop: 8 }}>
        {!showAddExp ? (
          <Button onClick={() => setShowAddExp(true)} variant="gold">+ Log Expense</Button>
        ) : (
          <Card>
            <SectionLabel>Log an Expense</SectionLabel>
            <div style={{ position: "relative", marginBottom: 10 }}>
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontFamily: F.sans, fontSize: 18, fontWeight: 700, color: T.taupe }}>$</span>
              <input value={addExpAmount} onChange={e => setAddExpAmount(e.target.value)} placeholder="0.00" type="number" step="0.01"
                style={{ width: "100%", background: T.sand, border: `1.5px solid ${addExpAmount ? T.gold : T.linen}`, borderRadius: 14, padding: "12px 12px 12px 28px", fontFamily: F.sans, fontSize: 22, fontWeight: 700, color: T.esp, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input value={addExpMerchant} onChange={e => setAddExpMerchant(e.target.value)} placeholder="Where?"
                style={{ flex: 1, background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none" }} />
              <input value={addExpNote} onChange={e => setAddExpNote(e.target.value)} placeholder="Note"
                style={{ flex: 1, background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {cats.map(c => (
                <button key={c.id} onClick={() => setAddExpCat(c.id)}
                  style={{ padding: "6px 12px", borderRadius: 16, border: `1.5px solid ${addExpCat === c.id ? c.color : T.linen}`, background: addExpCat === c.id ? `${c.color}20` : "#fff", color: addExpCat === c.id ? c.color : T.bark, fontFamily: F.sans, fontSize: 11, cursor: "pointer", fontWeight: addExpCat === c.id ? 700 : 400 }}>
                  {c.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={addExpense} disabled={!addExpAmount} variant="gold" style={{ flex: 1 }}>Log ${parseFloat(addExpAmount) > 0 ? parseFloat(addExpAmount).toFixed(2) : "0.00"}</Button>
              <Button onClick={() => setShowAddExp(false)} style={{ flex: 1 }}>Cancel</Button>
            </div>
          </Card>
        )}
      </div>

      {/* Income section */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <SectionLabel>Income</SectionLabel>
          <button onClick={() => setShowAddIncome(p => !p)} style={{ background: "none", border: "none", fontFamily: F.sans, fontSize: 12, color: T.teal, cursor: "pointer" }}>
            {showAddIncome ? "Cancel" : "+ Add"}
          </button>
        </div>
        {incomes.map(inc => (
          <div key={inc.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: T.ivory, borderRadius: 12, border: `1px solid ${T.linen}`, marginBottom: 6 }}>
            <div>
              <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>{inc.label}</p>
              <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "2px 0 0" }}>{inc.frequency} · {inc.type}</p>
            </div>
            <p style={{ fontFamily: F.serif, fontSize: 16, fontWeight: 700, color: T.sage, margin: 0 }}>${inc.amount.toLocaleString()}</p>
          </div>
        ))}
        {showAddIncome && (
          <Card>
            <input value={incLabel} onChange={e => setIncLabel(e.target.value)} placeholder="Income source (e.g. Salary)"
              style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none", marginBottom: 8, boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input value={incAmount} onChange={e => setIncAmount(e.target.value)} placeholder="Amount ($)" type="number"
                style={{ flex: 1, background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none" }} />
              <select value={incFreq} onChange={e => setIncFreq(e.target.value as Income["frequency"])}
                style={{ flex: 1, background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }}>
                <option value="monthly">Monthly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="weekly">Weekly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <Button onClick={addIncome} disabled={!incLabel.trim() || !incAmount} variant="gold">Add Income</Button>
          </Card>
        )}
      </div>

      {/* Live bank feed (Plaid) */}
      <div style={{ marginTop: 12, padding: "12px 16px", background: bankConnected ? `${T.sage}12` : T.sand, borderRadius: 16, border: `1px solid ${bankConnected ? `${T.sage}40` : T.linen}`, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 20 }}>◎</span>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>{bankConnected ? "Bank connected" : "Connect your bank"}</p>
          <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "2px 0 0" }}>{bankConnected ? "Transactions sync automatically & categorize" : "Live transactions, auto-categorized by Cleo"}</p>
        </div>
        <button onClick={bankConnected ? refreshBank : connectBank} disabled={bankBusy}
          style={{ background: bankConnected ? "none" : T.esp, color: bankConnected ? T.esp : "#fff", border: bankConnected ? `1.5px solid ${T.linen}` : "none", borderRadius: 10, padding: "6px 14px", fontFamily: F.sans, fontSize: 12, fontWeight: 700, cursor: bankBusy ? "default" : "pointer", minHeight: 32 }}>
          {bankBusy ? "..." : bankConnected ? "↺ Sync" : "Connect"}
        </button>
      </div>

      {/* CSV Import */}
      <div style={{ marginTop: 12, padding: "12px 16px", background: T.sand, borderRadius: 16, border: `1px solid ${T.linen}`, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 20 }}>📄</span>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>Import bank statement</p>
          <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "2px 0 0" }}>Upload CSV — Cleo categorizes automatically</p>
        </div>
        <label style={{ background: T.esp, color: "#fff", borderRadius: 10, padding: "6px 14px", fontFamily: F.sans, fontSize: 12, cursor: "pointer" }}>
          Upload
          <input type="file" accept=".csv" onChange={handleCSV} style={{ display: "none" }} />
        </label>
      </div>

      {/* Recent expenses */}
      {expenses.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <SectionLabel>Recent Transactions</SectionLabel>
          {expenses.slice(0, 8).map(e => {
            const cat = cats.find(c => c.id === e.category);
            return (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: T.ivory, borderRadius: 14, border: `1px solid ${T.linen}`, marginBottom: 6 }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{cat?.icon || "📦"}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>{e.merchant || cat?.label}</p>
                  <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "2px 0 0" }}>
                    {new Date(e.date || Date.now()).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {e.note ? ` · ${e.note}` : ""}
                  </p>
                </div>
                <p style={{ fontFamily: F.serif, fontSize: 16, fontWeight: 600, color: T.esp, margin: 0 }}>${e.amount.toFixed(2)}</p>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
