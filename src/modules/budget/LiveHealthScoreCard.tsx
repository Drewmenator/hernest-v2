import React from "react";
import { T, F } from "../../config/theme";
import { gradeScore, gradeColor } from "./budgetShared";
import type { Category, FinancialGoal } from "./budgetShared";
import { HealthScoreRing } from "./BudgetWidgets";

// ── Live Health Score Card ─────────────────────────────────────────
export function LiveHealthScoreCard({ snapshot, monthlyIncome, totalSpent, totalBudget, cashRemaining, savingsRate, dti, cats, goals }: {
  snapshot: any; monthlyIncome: number; totalSpent: number; totalBudget: number;
  cashRemaining: number; savingsRate: number; dti: number; cats: Category[]; goals: FinancialGoal[];
}) {
  // Recalculate same 5 dimensions so breakdown is visible
  const savingsScore = savingsRate >= 20 ? 25 : savingsRate >= 10 ? 15 : savingsRate >= 5 ? 8 : 0;
  const overSpendCount = cats.filter(c => c.budget > 0 && c.spent > c.budget).length;
  const adherencePct = totalBudget > 0 ? Math.max(0, (totalBudget - totalSpent) / totalBudget) : 1;
  const adherenceScore = Math.max(0, Math.round(adherencePct * 25) - (overSpendCount * 3));
  const debtScore = monthlyIncome === 0 ? 10 : dti < 15 ? 20 : dti < 25 ? 15 : dti < 35 ? 8 : dti < 50 ? 3 : 0;
  const daysElapsed = new Date().getDate();
  const bufferMonths = totalSpent > 0 ? cashRemaining / (totalSpent / (daysElapsed || 1)) : 0;
  const bufferScore = bufferMonths >= 3 ? 20 : bufferMonths >= 1 ? 14 : bufferMonths >= 0.5 ? 8 : cashRemaining > 0 ? 4 : 0;
  const onTrack = goals.filter(g => (g.riskStatus || "on_track") === "on_track").length;
  const goalsScore = goals.length ? Math.round((onTrack / goals.length) * 10) : 5;

  const score = snapshot?.financial?.financialHealthScore || Math.min(100, savingsScore + adherenceScore + debtScore + bufferScore + goalsScore);
  const grade = snapshot?.financial?.financialHealthGrade || gradeScore(score);
  const color = gradeColor(grade);

  const dimensions = [
    { label: "Savings Rate", score: savingsScore, max: 25, tip: savingsRate < 10 ? "Save 10%+ of income to gain points" : "Great savings rate!" },
    { label: "Budget Discipline", score: adherenceScore, max: 25, tip: overSpendCount > 0 ? `${overSpendCount} categor${overSpendCount > 1 ? "ies" : "y"} over budget` : "Spending within budget ✓" },
    { label: "Debt Load", score: debtScore, max: 20, tip: dti > 25 ? `DTI at ${dti.toFixed(0)}% — aim for under 25%` : "Healthy debt-to-income ratio" },
    { label: "Cash Buffer", score: bufferScore, max: 20, tip: bufferMonths < 1 ? "Build up 1+ month cash buffer" : `${bufferMonths.toFixed(1)} months buffer` },
    { label: "Goals on Track", score: goalsScore, max: 10, tip: goals.length === 0 ? "Set financial goals to unlock" : `${onTrack}/${goals.length} goals on track` },
  ];

  // Find biggest opportunity (lowest score relative to max)
  const opportunity = [...dimensions].sort((a, b) => (a.score / a.max) - (b.score / b.max))[0];
  const pointsToGain = opportunity.max - opportunity.score;

  return (
    <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "20px", marginBottom: 12 }}>
      {/* Score header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <HealthScoreRing score={score} grade={grade} />
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 4px" }}>FINANCIAL HEALTH SCORE</p>
          <p style={{ fontFamily: F.serif, fontSize: 15, fontStyle: "italic", color: T.esp, margin: "0 0 6px", lineHeight: 1.4 }}>
            {grade === "A" ? "Excellent financial health ✦" :
             grade === "B" ? "Good — a few areas to sharpen" :
             grade === "C" ? "Making progress, room to grow" :
             grade === "D" ? "Needs attention across a few areas" :
             "Let's turn this around together"}
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 11, color, fontWeight: 700, margin: 0 }}>
            {score}/100 · Updated live
          </p>
        </div>
      </div>

      {/* 5 dimension bars */}
      {dimensions.map(d => (
        <div key={d.label} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ fontFamily: F.sans, fontSize: 11, color: T.esp, fontWeight: 600 }}>{d.label}</span>
            <span style={{ fontFamily: F.sans, fontSize: 11, color: d.score === d.max ? T.sage : d.score >= d.max * 0.6 ? T.gold : T.blush, fontWeight: 700 }}>{d.score}/{d.max}</span>
          </div>
          <div style={{ height: 6, background: T.linen, borderRadius: 6, overflow: "hidden", marginBottom: 2 }}>
            <div style={{ width: `${(d.score / d.max) * 100}%`, height: "100%", background: d.score === d.max ? T.sage : d.score >= d.max * 0.6 ? T.gold : T.blush, borderRadius: 6, transition: "width 0.8s ease" }} />
          </div>
          <p style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, margin: 0 }}>{d.tip}</p>
        </div>
      ))}

      {/* Path to next grade */}
      {(() => {
        const nextGrade = grade === "F" ? "D" : grade === "D" ? "C" : grade === "C" ? "B" : grade === "B" ? "A" : null;
        const nextThreshold = grade === "F" ? 40 : grade === "D" ? 55 : grade === "C" ? 70 : grade === "B" ? 85 : 100;
        const ptsNeeded = Math.max(0, nextThreshold - score);
        if (!nextGrade || ptsNeeded === 0) return (
          <div style={{ marginTop: 12, padding: "10px 14px", background: `${T.sage}12`, borderRadius: 12, border: `1px solid ${T.sage}30` }}>
            <p style={{ fontFamily: F.sans, fontSize: 12, color: T.sage, fontWeight: 700, margin: 0 }}>✦ Outstanding financial health — keep it up!</p>
          </div>
        );

        // Rank actions by points available
        const actions: { action: string; pts: number; detail: string }[] = [];

        // Savings improvement
        if (savingsScore < 25) {
          const savingsPts = 25 - savingsScore;
          const targetRate = savingsRate < 5 ? 10 : savingsRate < 10 ? 15 : 20;
          const incomeApprox = monthlyIncome || totalBudget;
          const extraNeeded = incomeApprox > 0 ? Math.round(((targetRate - savingsRate) / 100) * incomeApprox) : 0;
          actions.push({
            action: `Increase savings rate to ${targetRate}%`,
            pts: Math.min(savingsPts, ptsNeeded),
            detail: extraNeeded > 0 ? `Save an extra $${extraNeeded}/mo` : "Reduce monthly spending"
          });
        }

        // Budget discipline
        if (adherenceScore < 25 && overSpendCount > 0) {
          const overspentCats = cats.filter(c => c.budget > 0 && c.spent > c.budget);
          const worstCat = overspentCats.sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget))[0];
          const pts = Math.min(overSpendCount * 3, ptsNeeded);
          actions.push({
            action: `Bring ${worstCat?.label || "overspent categories"} back on budget`,
            pts,
            detail: worstCat ? `$${Math.round(worstCat.spent - worstCat.budget)} past plan — a small cap gets it back` : `${overSpendCount} categories running past plan`
          });
        }

        // Debt load
        if (debtScore < 20 && dti > 15) {
          const targetDTI = dti > 35 ? 35 : 25;
          actions.push({
            action: `Reduce debt-to-income ratio to ${targetDTI}%`,
            pts: Math.min(20 - debtScore, ptsNeeded),
            detail: `Currently at ${dti.toFixed(0)}% — pay down highest APR debt first`
          });
        }

        // Cash buffer
        if (bufferScore < 20 && bufferMonths < 1) {
          actions.push({
            action: "Build a 1-month cash buffer",
            pts: Math.min(14 - bufferScore, ptsNeeded),
            detail: `Currently ${bufferMonths.toFixed(1)} months — aim for 1+ month of expenses`
          });
        }

        // Goals
        if (goalsScore < 10 && goals.length > 0) {
          const offTrack = goals.filter(g => g.riskStatus !== "on_track").length;
          if (offTrack > 0) actions.push({
            action: `Get ${offTrack} goal${offTrack > 1 ? "s" : ""} back on track`,
            pts: Math.min(10 - goalsScore, ptsNeeded),
            detail: "Increase monthly contributions or adjust target dates"
          });
        } else if (goals.length === 0) {
          actions.push({
            action: "Set your first financial goal",
            pts: 5,
            detail: "Unlock the full goals scoring dimension"
          });
        }

        // Sort by pts descending, take top 3
        const top = actions.sort((a, b) => b.pts - a.pts).slice(0, 3);
        const totalPtsAvailable = top.reduce((s, a) => s + a.pts, 0);
        const projectedScore = Math.min(100, score + totalPtsAvailable);
        const projectedGrade = projectedScore >= 85 ? "A" : projectedScore >= 70 ? "B" : projectedScore >= 55 ? "C" : projectedScore >= 40 ? "D" : "F";

        return (
          <div style={{ marginTop: 14, padding: "14px", background: `${T.esp}06`, borderRadius: 14, border: `1px solid ${T.esp}15` }}>
            <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.esp, margin: "0 0 10px" }}>
              PATH TO {nextGrade} · {ptsNeeded} PTS NEEDED
            </p>
            {top.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                <div style={{ minWidth: 36, height: 22, background: T.gold, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                  <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: "#fff" }}>+{a.pts}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: T.esp, margin: "0 0 1px" }}>{a.action}</p>
                  <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>{a.detail}</p>
                </div>
              </div>
            ))}
            {totalPtsAvailable > 0 && projectedGrade !== grade && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.linen}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>Do all three →</p>
                <p style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: T.sage, margin: 0 }}>
                  {score} → {projectedScore} · {grade} → {projectedGrade} ✦
                </p>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
