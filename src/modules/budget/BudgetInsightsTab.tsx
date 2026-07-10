import React from "react";
import { T, F } from "../../config/theme";
import { ProgressBar, Spinner } from "../../shared/components";
import { SectionLabel, StatCard, InsightCard } from "./BudgetWidgets";
import type { AIInsight, Category, Expense } from "./budgetShared";

export function BudgetInsightsTab({
  cats, expenses, insights, insightsLoading, generateInsights,
  projected, totalBudget, dailyRate, daysInMonth, daysElapsed,
}: {
  cats: Category[]; expenses: Expense[]; insights: AIInsight[];
  insightsLoading: boolean; generateInsights: () => Promise<void>;
  projected: number; totalBudget: number; dailyRate: number; daysInMonth: number; daysElapsed: number;
}) {
  return (
    <>
      {/* Spending intelligence summary */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          { label: "Over Budget", value: cats.filter(c => c.spent > c.budget).length, color: T.blush, icon: "⚠️" },
          { label: "Near Limit", value: cats.filter(c => c.spent / Math.max(c.budget, 1) > 0.8 && c.spent <= c.budget).length, color: T.gold, icon: "🔶" },
          { label: "On Track", value: cats.filter(c => c.spent / Math.max(c.budget, 1) <= 0.8).length, color: T.sage, icon: "✓" },
        ].map(s => (
          <StatCard key={s.label} label={s.label} value={`${s.icon} ${s.value}`} color={s.color} />
        ))}
      </div>

      {/* Spending patterns */}
      <SectionLabel>Spending Patterns</SectionLabel>
      {cats.filter(c => c.spent > 0).sort((a, b) => (b.spent / b.budget) - (a.spent / a.budget)).map(c => {
        const pct = Math.round((c.spent / Math.max(c.budget, 1)) * 100);
        const isOver = c.spent > c.budget;
        const isHigh = pct > 80 && !isOver;
        return (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: isOver ? `${T.blush}08` : T.ivory, borderRadius: 14, border: `1px solid ${isOver ? T.blush : T.linen}`, marginBottom: 6 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>{c.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp }}>{c.label}</span>
                <span style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: isOver ? T.blush : isHigh ? "#8B6914" : T.sage }}>{pct}%</span>
              </div>
              <ProgressBar value={c.spent} max={c.budget} color={isOver ? "#ff6b6b" : isHigh ? T.gold : c.color} height={4} />
              <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "4px 0 0" }}>
                ${c.spent.toFixed(0)} of ${c.budget} · ${Math.max(0, c.budget - c.spent).toFixed(0)} left
              </p>
            </div>
            {isOver && <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: T.blush, flexShrink: 0 }}>OVER</span>}
          </div>
        );
      })}

      {/* AI Insights */}
      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <SectionLabel>AI Intelligence Feed</SectionLabel>
          <button onClick={generateInsights} disabled={insightsLoading}
            style={{ background: "none", border: `1px solid ${T.teal}`, borderRadius: 10, padding: "5px 12px", fontFamily: F.sans, fontSize: 11, color: T.teal, cursor: "pointer" }}>
            {insightsLoading ? "Analyzing..." : insights.length > 0 ? "Refresh ↺" : "Generate ✦"}
          </button>
        </div>

        {insightsLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px", background: T.sand, borderRadius: 16 }}>
            <Spinner size={18} />
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0 }}>Cleo is analyzing your household finances...</p>
          </div>
        )}

        {insights.length > 0 && !insightsLoading && insights.map(ins => (
          <InsightCard key={ins.id} insight={ins} />
        ))}

        {insights.length === 0 && !insightsLoading && (
          <div style={{ padding: "32px 20px", textAlign: "center", background: T.sand, borderRadius: 20, border: `1px dashed ${T.linen}` }}>
            <p style={{ fontFamily: F.serif, fontSize: 20, fontStyle: "italic", color: T.esp, margin: "0 0 8px" }}>No insights yet</p>
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: "0 0 16px" }}>
              Cleo will analyze your spending patterns, flag anomalies, and surface opportunities.
            </p>
            <button onClick={generateInsights}
              style={{ background: T.esp, color: "#fff", border: "none", borderRadius: 14, padding: "10px 24px", fontFamily: F.sans, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Generate Insights ✦
            </button>
          </div>
        )}
      </div>

      {/* Subscription detector */}
      {expenses.length > 0 && (() => {
        const subs = expenses.filter(e => e.category === "subscriptions");
        const subTotal = subs.reduce((a, e) => a + e.amount, 0);
        if (subTotal === 0) return null;
        return (
          <div style={{ marginTop: 16, padding: "14px 16px", background: `${T.lav}15`, borderRadius: 16, border: `1px solid ${T.lav}40` }}>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.lav, margin: "0 0 6px" }}>SUBSCRIPTION TRACKER</p>
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: "0 0 4px" }}>
              ${subTotal.toFixed(2)}/mo in subscriptions tracked
            </p>
            <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>
              That's ${(subTotal * 12).toFixed(0)}/year. Review regularly for unused services.
            </p>
          </div>
        );
      })()}

      {/* Cash flow forecast */}
      <div style={{ marginTop: 16, padding: "14px 16px", background: projected > totalBudget ? `${T.blush}10` : T.sand, borderRadius: 16, border: `1px solid ${projected > totalBudget ? T.blush : T.linen}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 4px" }}>CASH FLOW FORECAST</p>
            <p style={{ fontFamily: F.sans, fontSize: 13, color: projected > totalBudget ? T.blush : T.sage, margin: 0 }}>
              {projected > totalBudget
                ? `Trending $${(projected - totalBudget).toLocaleString()} past plan — small trims now beat big cuts later`
                : `✓ On track to save $${(totalBudget - projected).toLocaleString()}`}
            </p>
          </div>
          <p style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: projected > totalBudget ? T.blush : T.sage, margin: 0 }}>${projected.toLocaleString()}</p>
        </div>
        <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "6px 0 0" }}>
          ${dailyRate.toFixed(2)}/day · {daysInMonth - daysElapsed} days left this month
        </p>
      </div>
    </>
  );
}
