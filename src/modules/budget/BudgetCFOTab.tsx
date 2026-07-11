import React from "react";
import { T, F } from "../../config/theme";
import { Card, Button, ProgressBar, Spinner } from "../../shared/components";
import { SectionLabel } from "./BudgetWidgets";
import { LiveHealthScoreCard } from "./LiveHealthScoreCard";
import { computePayoffDate, computeTotalInterest, getScenarioPrompts } from "./budgetShared";
import type { Category, Debt, FinancialGoal, Scenario } from "./budgetShared";
import { formatMoney, currencySymbol } from "../../shared/utils/money";

interface CoachMessage { role: "user" | "assistant"; content: string; }

export function BudgetCFOTab({
  householdSnapshot, monthlyIncome, totalSpent, totalBudget, cashRemaining, savingsRate, dti, cats, goals,
  showAddDebt, setShowAddDebt, decisionHistory,
  debtLabel, setDebtLabel, debtType, setDebtType, debtBalance, setDebtBalance,
  debtAPR, setDebtAPR, debtMin, setDebtMin, debtMonthly, setDebtMonthly, addDebt,
  debts, debtStrategy, setDebtStrategy,
  scenarioInput, setScenarioInput, runScenario, scenarioLoading, activeScenario,
  coachMsgs, coachLoading, coachInput, setCoachInput, askCoach, chatEndRef,
}: {
  householdSnapshot: any; monthlyIncome: number; totalSpent: number; totalBudget: number;
  cashRemaining: number; savingsRate: number; dti: number; cats: Category[]; goals: FinancialGoal[];
  showAddDebt: boolean; setShowAddDebt: React.Dispatch<React.SetStateAction<boolean>>;
  decisionHistory: any[];
  debtLabel: string; setDebtLabel: React.Dispatch<React.SetStateAction<string>>;
  debtType: Debt["type"]; setDebtType: React.Dispatch<React.SetStateAction<Debt["type"]>>;
  debtBalance: string; setDebtBalance: React.Dispatch<React.SetStateAction<string>>;
  debtAPR: string; setDebtAPR: React.Dispatch<React.SetStateAction<string>>;
  debtMin: string; setDebtMin: React.Dispatch<React.SetStateAction<string>>;
  debtMonthly: string; setDebtMonthly: React.Dispatch<React.SetStateAction<string>>;
  addDebt: () => Promise<void>;
  debts: Debt[];
  debtStrategy: "avalanche" | "snowball";
  setDebtStrategy: React.Dispatch<React.SetStateAction<"avalanche" | "snowball">>;
  scenarioInput: string; setScenarioInput: React.Dispatch<React.SetStateAction<string>>;
  runScenario: (question?: string) => Promise<void>;
  scenarioLoading: boolean; activeScenario: Scenario | null;
  coachMsgs: CoachMessage[]; coachLoading: boolean;
  coachInput: string; setCoachInput: React.Dispatch<React.SetStateAction<string>>;
  askCoach: () => Promise<void>;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      {/* Financial Health Score — Live */}
      <LiveHealthScoreCard
        snapshot={householdSnapshot}
        monthlyIncome={monthlyIncome}
        totalSpent={totalSpent}
        totalBudget={totalBudget}
        cashRemaining={cashRemaining}
        savingsRate={savingsRate}
        dti={dti}
        cats={cats}
        goals={goals}
      />

      {/* Debt Coach */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <SectionLabel>Debt Coach</SectionLabel>
          <button onClick={() => setShowAddDebt(p => !p)}
            style={{ background: "none", border: "none", fontFamily: F.sans, fontSize: 12, color: T.teal, cursor: "pointer" }}>
            {showAddDebt ? "Cancel" : "+ Add Debt"}
          </button>
        </div>

      {/* Decision Timeline */}
      {decisionHistory.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionLabel>Decision History</SectionLabel>
          {decisionHistory.slice(0, 5).map((item: any, i: number) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.linen}` }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.gold, flexShrink: 0, marginTop: 5 }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: T.esp, margin: "0 0 2px" }}>{item.title}</p>
                <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>{item.date} · {item.confidence} confidence</p>
              </div>
            </div>
          ))}
        </div>
      )}

        {showAddDebt && (
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input value={debtLabel} onChange={e => setDebtLabel(e.target.value)} placeholder="Debt name"
                style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none" }} />
              <select value={debtType} onChange={e => setDebtType(e.target.value as Debt["type"])}
                style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }}>
                <option value="credit_card">Credit Card</option>
                <option value="student_loan">Student Loan</option>
                <option value="car_loan">Car Loan</option>
                <option value="mortgage">Mortgage</option>
                <option value="personal">Personal Loan</option>
                <option value="other">Other</option>
              </select>
              <input value={debtBalance} onChange={e => setDebtBalance(e.target.value)} placeholder={`Balance (${currencySymbol()})`} type="number"
                style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none" }} />
              <input value={debtAPR} onChange={e => setDebtAPR(e.target.value)} placeholder="APR (%)" type="number"
                style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none" }} />
              <input value={debtMin} onChange={e => setDebtMin(e.target.value)} placeholder={`Min payment (${currencySymbol()})`} type="number"
                style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none" }} />
              <input value={debtMonthly} onChange={e => setDebtMonthly(e.target.value)} placeholder={`Monthly payment (${currencySymbol()})`} type="number"
                style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none" }} />
            </div>
            <Button onClick={addDebt} disabled={!debtLabel.trim() || !debtBalance} variant="gold">Add Debt</Button>
          </Card>
        )}

        {debts.length > 0 && (
          <>
            {/* Strategy toggle */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {(["avalanche", "snowball"] as const).map(s => (
                <button key={s} onClick={() => setDebtStrategy(s)}
                  style={{ flex: 1, padding: "8px", borderRadius: 12, border: `1.5px solid ${debtStrategy === s ? T.esp : T.linen}`, background: debtStrategy === s ? T.esp : T.ivory, fontFamily: F.sans, fontSize: 12, color: debtStrategy === s ? "#fff" : T.esp, cursor: "pointer", fontWeight: debtStrategy === s ? 700 : 400 }}>
                  {s === "avalanche" ? "⚡ Avalanche (save most)" : "❄️ Snowball (motivation)"}
                </button>
              ))}
            </div>
            <div style={{ padding: "10px 14px", background: `${T.teal}10`, borderRadius: 12, border: `1px solid ${T.teal}30`, marginBottom: 12 }}>
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0, lineHeight: 1.6 }}>
                {debtStrategy === "avalanche"
                  ? "✦ Pay minimums on all debts, throw extra at the highest APR first. Saves the most interest over time."
                  : "✦ Pay minimums on all debts, throw extra at the smallest balance first. Builds momentum and motivation."}
              </p>
            </div>

            {/* Sorted debts */}
            {[...debts]
              .sort((a, b) => debtStrategy === "avalanche" ? b.apr - a.apr : a.balance - b.balance)
              .map((d, i) => {
                const payoff = computePayoffDate(d);
                const interest = computeTotalInterest(d);
                const pct = Math.min(100, Math.round((d.monthlyPayment / Math.max(d.balance, 1)) * 100 * 12));
                return (
                  <Card key={d.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          {i === 0 && <span style={{ background: T.gold, color: "#fff", borderRadius: 6, padding: "2px 6px", fontFamily: F.sans, fontSize: 9, fontWeight: 700 }}>FOCUS</span>}
                          <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 700, color: T.esp, margin: 0 }}>{d.label}</p>
                        </div>
                        <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>
                          {d.apr}% APR · Min {formatMoney(d.minimumPayment)}/mo · Payoff {payoff}
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ fontFamily: F.serif, fontSize: 18, fontWeight: 700, color: T.blush, margin: 0 }}>{formatMoney(d.balance)}</p>
                        {interest > 0 && <p style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, margin: "2px 0 0" }}>+{formatMoney(interest)} interest</p>}
                      </div>
                    </div>
                    <ProgressBar value={d.monthlyPayment * 12} max={d.balance} color={T.teal} height={4} />
                    <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "6px 0 0" }}>
                      Paying {formatMoney(d.monthlyPayment)}/mo
                    </p>
                  </Card>
                );
              })}
          </>
        )}

        {debts.length === 0 && !showAddDebt && (<div style={{ textAlign:"center", padding:"24px 16px" }}><p style={{ fontFamily:F.serif, fontSize:18, fontStyle:"italic", color:T.esp, margin:"0 0 8px" }}>No debt tracked yet</p><p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 16px" }}>Add any loans, credit cards, or lines of credit to unlock debt strategy insights.</p></div>) }
      </div>

      {/* Scenario Planner */}
      <div style={{ marginTop: 20 }}>
        <SectionLabel>Scenario Planner</SectionLabel>
        <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 12px", lineHeight: 1.6 }}>
          Ask any financial "what if" — your CFO will analyze the impact, tradeoffs, and best path forward.
        </p>

        {/* Suggested prompts */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12, paddingBottom: 4, scrollbarWidth: "none" }}>
          {getScenarioPrompts().map((p, i) => (
            <button key={i} onClick={() => runScenario(p)}
              style={{ padding: "8px 14px", borderRadius: 20, border: `1px solid ${T.linen}`, background: T.ivory, fontFamily: F.sans, fontSize: 11, color: T.esp, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
              {p}
            </button>
          ))}
        </div>

        {/* Custom scenario input */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input value={scenarioInput} onChange={e => setScenarioInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && runScenario()}
            placeholder="Ask your own what-if..."
            style={{ flex: 1, background: T.ivory, border: `1.5px solid ${T.linen}`, borderRadius: 14, padding: "11px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none" }} />
          <button onClick={() => runScenario()} disabled={!scenarioInput.trim() || scenarioLoading}
            style={{ width: 44, height: 44, borderRadius: 14, background: scenarioInput.trim() ? T.esp : T.linen, border: "none", color: "#fff", fontSize: 18, cursor: scenarioInput.trim() ? "pointer" : "not-allowed", flexShrink: 0 }}>
            →
          </button>
        </div>

        {/* Active scenario result */}
        {scenarioLoading && (
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
              <Spinner size={18} />
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0 }}>Your CFO is analyzing the numbers...</p>
            </div>
          </Card>
        )}

        {activeScenario?.result && !scenarioLoading && (
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 6px" }}>SCENARIO ANALYSIS</p>
            <p style={{ fontFamily: F.serif, fontSize: 16, fontStyle: "italic", color: T.esp, margin: "0 0 14px", lineHeight: 1.5 }}>"{activeScenario.question}"</p>

            {/* Risk badge */}
            <div style={{ display: "inline-block", padding: "4px 10px", borderRadius: 8, marginBottom: 12, background: activeScenario.result.riskLevel === "high" ? `${T.blush}20` : activeScenario.result.riskLevel === "medium" ? `${T.gold}20` : `${T.sage}20` }}>
              <span style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: activeScenario.result.riskLevel === "high" ? T.blush : activeScenario.result.riskLevel === "medium" ? "#8B6914" : T.sage }}>
                {activeScenario.result.riskLevel.toUpperCase()} RISK · {activeScenario.result.confidenceLevel}% confidence
              </span>
            </div>

            <div style={{ marginBottom: 12 }}>
              <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: T.taupe, margin: "0 0 6px" }}>FINANCIAL IMPACT</p>
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0, lineHeight: 1.6 }}>{activeScenario.result.financialImpact}</p>
            </div>

            {activeScenario.result.tradeoffs.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: T.taupe, margin: "0 0 6px" }}>TRADEOFFS</p>
                {activeScenario.result.tradeoffs.map((t, i) => (
                  <p key={i} style={{ fontFamily: F.sans, fontSize: 12, color: T.bark, margin: "0 0 4px", paddingLeft: 12, borderLeft: `2px solid ${T.linen}`, lineHeight: 1.5 }}>
                    {t}
                  </p>
                ))}
              </div>
            )}

            <div style={{ padding: "12px 14px", background: `${T.esp}08`, borderRadius: 12, borderLeft: `3px solid ${T.esp}` }}>
              <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: T.taupe, margin: "0 0 4px" }}>RECOMMENDATION</p>
              <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0, lineHeight: 1.6 }}>
                ✦ {activeScenario.result.recommendedAction}
              </p>
            </div>
          </Card>
        )}
      </div>

      {/* CFO Chat */}
      <div style={{ marginTop: 20 }}>
        <SectionLabel>Ask Your CFO</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", minHeight: "40vh" }}>
          <div style={{ flex: 1, marginBottom: 12 }}>
            {coachMsgs.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 10 }}>
                <div style={{ maxWidth: "85%", background: m.role === "user" ? `linear-gradient(135deg, ${T.esp}, #4a3020)` : T.ivory, borderRadius: m.role === "user" ? "20px 20px 4px 20px" : "20px 20px 20px 4px", padding: "12px 16px", border: m.role === "assistant" ? `1px solid ${T.linen}` : "none" }}>
                  {m.content.split("\n").filter(l => l.trim()).map((line, j) => (
                    <p key={j} style={{ fontFamily: F.sans, fontSize: 13, color: m.role === "user" ? "rgba(255,255,255,.9)" : T.esp, margin: "0 0 4px", lineHeight: 1.6 }}>{line}</p>
                  ))}
                </div>
              </div>
            ))}
            {coachLoading && (
              <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
                <div style={{ background: T.ivory, borderRadius: "20px 20px 20px 4px", padding: "12px 16px", border: `1px solid ${T.linen}` }}>
                  <Spinner size={16} />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div style={{ display: "flex", gap: 8, borderTop: `1px solid ${T.linen}`, paddingTop: 8 }}>
            <input value={coachInput} onChange={e => setCoachInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && askCoach()}
              placeholder="Ask your household CFO anything..."
              style={{ flex: 1, background: T.ivory, border: `1.5px solid ${T.linen}`, borderRadius: 14, padding: "11px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none" }} />
            <button onClick={askCoach} disabled={!coachInput.trim() || coachLoading}
              style={{ width: 44, height: 44, borderRadius: 14, background: coachInput.trim() ? T.esp : T.linen, border: "none", color: "#fff", fontSize: 18, cursor: coachInput.trim() ? "pointer" : "not-allowed", flexShrink: 0 }}>
              →
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
