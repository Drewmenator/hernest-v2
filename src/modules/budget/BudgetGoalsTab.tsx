import React from "react";
import { T, F } from "../../config/theme";
import { Card, Button, ProgressBar } from "../../shared/components";
import { SectionLabel } from "./BudgetWidgets";
import { GOAL_TYPES } from "./budgetShared";
import type { FinancialGoal } from "./budgetShared";

export function BudgetGoalsTab({
  goals, showAddGoal, setShowAddGoal,
  goalName, setGoalName, goalType, setGoalType, goalTarget, setGoalTarget,
  goalCurrent, setGoalCurrent, goalMonthly, setGoalMonthly, goalDate, setGoalDate,
  addGoal, addToGoal,
}: {
  goals: FinancialGoal[];
  showAddGoal: boolean; setShowAddGoal: React.Dispatch<React.SetStateAction<boolean>>;
  goalName: string; setGoalName: React.Dispatch<React.SetStateAction<string>>;
  goalType: FinancialGoal["type"]; setGoalType: React.Dispatch<React.SetStateAction<FinancialGoal["type"]>>;
  goalTarget: string; setGoalTarget: React.Dispatch<React.SetStateAction<string>>;
  goalCurrent: string; setGoalCurrent: React.Dispatch<React.SetStateAction<string>>;
  goalMonthly: string; setGoalMonthly: React.Dispatch<React.SetStateAction<string>>;
  goalDate: string; setGoalDate: React.Dispatch<React.SetStateAction<string>>;
  addGoal: () => Promise<void>;
  addToGoal: (goalId: string, amt: number) => Promise<void>;
}) {
  return (
    <>
      {!showAddGoal ? (
        <Button onClick={() => setShowAddGoal(true)} variant="gold">+ New Financial Goal</Button>
      ) : (
        <Card>
          <SectionLabel>Create a Goal</SectionLabel>
          <input value={goalName} onChange={e => setGoalName(e.target.value)} placeholder="Goal name"
            style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none", marginBottom: 8, boxSizing: "border-box" }} />

          {/* Goal type */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {GOAL_TYPES.map(g => (
              <button key={g.id} onClick={() => setGoalType(g.id as FinancialGoal["type"])}
                style={{ padding: "6px 12px", borderRadius: 16, border: `1.5px solid ${goalType === g.id ? T.gold : T.linen}`, background: goalType === g.id ? `${T.gold}20` : "#fff", fontFamily: F.sans, fontSize: 11, color: goalType === g.id ? "#8B6914" : T.bark, cursor: "pointer" }}>
                {g.icon} {g.label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <input value={goalTarget} onChange={e => setGoalTarget(e.target.value)} placeholder="Target ($)" type="number"
              style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }} />
            <input value={goalCurrent} onChange={e => setGoalCurrent(e.target.value)} placeholder="Already saved ($)" type="number"
              style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }} />
            <input value={goalMonthly} onChange={e => setGoalMonthly(e.target.value)} placeholder="Monthly contribution ($)" type="number"
              style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }} />
            <input value={goalDate} onChange={e => setGoalDate(e.target.value)} placeholder="Target date" type="date"
              style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={addGoal} disabled={!goalName.trim() || !goalTarget} variant="gold" style={{ flex: 1 }}>Create Goal ✦</Button>
            <Button onClick={() => setShowAddGoal(false)} style={{ flex: 1 }}>Cancel</Button>
          </div>
        </Card>
      )}

      {goals.map(g => {
        const pct = g.targetAmount > 0 ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 0;
        const typeInfo = GOAL_TYPES.find(t => t.id === g.type);
        const remaining = g.targetAmount - g.currentAmount;
        const monthsLeft = g.targetDate
          ? Math.max(1, (new Date(g.targetDate).getTime() - Date.now()) / (30 * 24 * 60 * 60 * 1000))
          : null;
        const needed = monthsLeft ? remaining / monthsLeft : null;
        const statusColor = g.riskStatus === "on_track" ? T.sage : g.riskStatus === "at_risk" ? T.gold : T.blush;

        return (
          <Card key={g.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 18 }}>{typeInfo?.icon || "🎯"}</span>
                  <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 700, color: T.esp, margin: 0 }}>{g.name}</p>
                  <span style={{ padding: "2px 7px", borderRadius: 6, background: `${statusColor}20`, fontFamily: F.sans, fontSize: 9, fontWeight: 700, color: statusColor }}>
                    {g.riskStatus.replace("_", " ").toUpperCase()}
                  </span>
                </div>
                <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>
                  ${g.currentAmount.toLocaleString()} of ${g.targetAmount.toLocaleString()}
                  {g.targetDate ? ` · by ${new Date(g.targetDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : ""}
                </p>
                {needed && g.monthlyContribution > 0 && (
                  <p style={{ fontFamily: F.sans, fontSize: 11, color: needed > g.monthlyContribution ? T.blush : T.sage, margin: "2px 0 0" }}>
                    Need ${Math.round(needed).toLocaleString()}/mo · Contributing ${g.monthlyContribution.toLocaleString()}/mo
                  </p>
                )}
              </div>
              <span style={{ fontFamily: F.serif, fontSize: 24, fontWeight: 700, color: T.gold, flexShrink: 0 }}>{pct}%</span>
            </div>

            <ProgressBar value={g.currentAmount} max={g.targetAmount} color={statusColor} />

            {g.aiRecommendation && (
              <div style={{ marginTop: 10, padding: "10px 12px", background: `${T.teal}10`, borderRadius: 10 }}>
                <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0, lineHeight: 1.6 }}>✦ {g.aiRecommendation}</p>
              </div>
            )}

            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {[50, 100, 250].map(amt => (
                <button key={amt} onClick={() => addToGoal(g.id, amt)}
                  style={{ flex: 1, padding: "7px", background: T.sand, border: `1px solid ${T.linen}`, borderRadius: 10, fontFamily: F.sans, fontSize: 12, color: T.esp, cursor: "pointer" }}>
                  +${amt}
                </button>
              ))}
            </div>
          </Card>
        );
      })}

      {goals.length === 0 && !showAddGoal && (
        <div style={{ padding: "32px 20px", textAlign: "center", background: T.sand, borderRadius: 20, border: `1px dashed ${T.linen}`, marginTop: 12 }}>
          <p style={{ fontFamily: F.serif, fontSize: 20, fontStyle: "italic", color: T.esp, margin: "0 0 8px" }}>No goals yet</p>
          <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0 }}>Create your first financial goal — vacation, emergency fund, home, and more.</p>
        </div>
      )}
    </>
  );
}
