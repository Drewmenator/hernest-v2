import React, { useState, useEffect, useRef } from "react";
import { trackEvent } from "../../core/analytics";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, HeroCard, Pill, Button, Input, ProgressBar, AIBadge, Spinner } from "../../shared/components";
import { saveData, loadData } from "../../core/firebase";
import { ai, aiJSON } from "../../core/ai";
import { askCFO } from "../../core/aiOrchestrator";
import { createActionsFromCFOResponse, executeRecommendedAction } from "../../core/recommendationActions";
import { loadDecisionsV2, buildDecisionTimeline } from "../../core/household/DecisionEngineV2";
import { bus } from "../../core/events";
import toast from "react-hot-toast";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface Category {
  id: string;
  label: string;
  budget: number;
  spent: number;
  color: string;
  icon: string;
}

interface Expense {
  id: string;
  amount: number;
  category: string;
  merchant: string;
  note: string;
  date: string;
  method: "manual" | "receipt" | "csv";
}

interface Income {
  id: string;
  label: string;
  amount: number;
  frequency: "monthly" | "biweekly" | "weekly" | "annual";
  type: "salary" | "freelance" | "rental" | "other";
}

interface Debt {
  id: string;
  label: string;
  balance: number;
  apr: number;
  minimumPayment: number;
  monthlyPayment: number;
  type: "credit_card" | "student_loan" | "car_loan" | "mortgage" | "personal" | "other";
  payoffDate?: string; // computed
}

interface FinancialGoal {
  id: string;
  name: string;
  type: "emergency_fund" | "vacation" | "school_fees" | "medical" | "home" | "car" | "debt_payoff" | "family_event" | "other";
  targetAmount: number;
  currentAmount: number;
  targetDate?: string;
  monthlyContribution: number;
  riskStatus: "on_track" | "at_risk" | "off_track";
  aiRecommendation?: string;
  linkedDebtId?: string;
}

interface Scenario {
  id: string;
  question: string;
  result?: ScenarioResult;
  createdAt: string;
}

interface ScenarioResult {
  financialImpact: string;
  tradeoffs: string[];
  riskLevel: "low" | "medium" | "high";
  recommendedAction: string;
  confidenceLevel: number;
}

interface AIInsight {
  id: string;
  observation: string;
  whyItMatters: string;
  options: string[];
  recommendation: string;
  confidenceLevel: number;
  category: "spending" | "savings" | "debt" | "cashflow" | "stress";
  createdAt: string;
}

interface FinancialHealthScore {
  score: number; // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  summary: string;
  breakdown: { label: string; score: number; color: string }[];
}

interface MonthlyBudgetSummary {
  totalIncome: number;
  fixedExpenses: number;
  variableExpenses: number;
  cashRemaining: number;
  savingsRate: number;
  totalDebt: number;
  debtToIncomeRatio: number;
}

// ═══════════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_CATS: Category[] = [
  { id: "groceries",     label: "Groceries",    budget: 700,  spent: 0, color: T.sage,  icon: "◈" },
  { id: "kids",          label: "Kids",          budget: 400,  spent: 0, color: T.sky,   icon: "🧒" },
  { id: "fitness",       label: "Fitness",       budget: 120,  spent: 0, color: T.blush, icon: "💪" },
  { id: "dining",        label: "Dining",        budget: 300,  spent: 0, color: T.gold,  icon: "◆" },
  { id: "shopping",      label: "Shopping",      budget: 500,  spent: 0, color: T.lav,   icon: "🛍" },
  { id: "transport",     label: "Transport",     budget: 200,  spent: 0, color: T.teal,  icon: "🚗" },
  { id: "health",        label: "Health",        budget: 200,  spent: 0, color: T.sage,  icon: "💊" },
  { id: "bills",         label: "Bills",         budget: 1000, spent: 0, color: T.bark,  icon: "◎" },
  { id: "entertainment", label: "Entertainment", budget: 150,  spent: 0, color: T.lav,   icon: "🎬" },
  { id: "subscriptions", label: "Subscriptions", budget: 100,  spent: 0, color: T.teal,  icon: "🔄" },
  { id: "childcare",     label: "Childcare",     budget: 600,  spent: 0, color: T.sky,   icon: "👶" },
  { id: "medical",       label: "Medical",       budget: 150,  spent: 0, color: T.blush, icon: "🏥" },
  { id: "other",         label: "Other",         budget: 200,  spent: 0, color: T.taupe, icon: "📦" },
];

const GOAL_TYPES = [
  { id: "emergency_fund", label: "Emergency Fund", icon: "🛡" },
  { id: "vacation",       label: "Vacation",        icon: "✈️" },
  { id: "school_fees",    label: "School Fees",     icon: "🎓" },
  { id: "medical",        label: "Medical / Therapy", icon: "💊" },
  { id: "home",           label: "Home Purchase",   icon: "🏠" },
  { id: "car",            label: "Car Purchase",    icon: "🚗" },
  { id: "debt_payoff",    label: "Debt Payoff",     icon: "💳" },
  { id: "family_event",   label: "Family Event",    icon: "🎉" },
  { id: "other",          label: "Other",           icon: "🎯" },
];

const SCENARIO_PROMPTS = [
  "Can we afford a vacation this summer?",
  "What if rent increases by $300/month?",
  "Can we hire a nanny?",
  "What if one parent stops working?",
  "Should we pay off the car loan early?",
  "Can we afford private school next year?",
  "What happens if we add $200/month to savings?",
  "Can we handle a $5,000 emergency right now?",
];

// ═══════════════════════════════════════════════════════════════════
// HELPER HOOKS & UTILS
// ═══════════════════════════════════════════════════════════════════

function computePayoffDate(debt: Debt): string {
  if (debt.monthlyPayment <= 0 || debt.balance <= 0) return "—";
  const monthlyRate = debt.apr / 100 / 12;
  if (monthlyRate === 0) {
    const months = Math.ceil(debt.balance / debt.monthlyPayment);
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  const n = -Math.log(1 - (monthlyRate * debt.balance) / debt.monthlyPayment) / Math.log(1 + monthlyRate);
  if (!isFinite(n) || n < 0) return "Never (payment too low)";
  const d = new Date();
  d.setMonth(d.getMonth() + Math.ceil(n));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function computeTotalInterest(debt: Debt): number {
  const monthlyRate = debt.apr / 100 / 12;
  if (monthlyRate === 0) return 0;
  const n = -Math.log(1 - (monthlyRate * debt.balance) / debt.monthlyPayment) / Math.log(1 + monthlyRate);
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(debt.monthlyPayment * n - debt.balance);
}

function gradeScore(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function gradeColor(grade: string): string {
  const map: Record<string, string> = { A: T.sage, B: T.teal, C: T.gold, D: T.blush, F: "#ff4444" };
  return map[grade] || T.taupe;
}

// ═══════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" }}>
      {children}
    </p>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: "14px 16px", background: T.ivory, borderRadius: 16, border: `1px solid ${T.linen}` }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 6px" }}>{label}</p>
      <p style={{ fontFamily: F.serif, fontSize: 20, fontWeight: 700, color: color || T.esp, margin: 0 }}>{value}</p>
      {sub && <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "3px 0 0" }}>{sub}</p>}
    </div>
  );
}

function InsightCard({ insight, onDismiss }: { insight: AIInsight; onDismiss?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const catColors: Record<string, string> = {
    spending: T.gold, savings: T.sage, debt: T.blush, cashflow: T.teal, stress: T.lav
  };
  const color = catColors[insight.category] || T.taupe;

  return (
    <div style={{ padding: "16px", background: T.ivory, borderRadius: 18, border: `1px solid ${T.linen}`, marginBottom: 10, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color, margin: "0 0 6px" }}>
            {insight.category.replace("_", " ")} · {insight.confidenceLevel}% confidence
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: "0 0 4px", lineHeight: 1.5 }}>{insight.observation}</p>
        </div>
        <button onClick={() => setExpanded(p => !p)} style={{ background: "none", border: "none", color: T.taupe, cursor: "pointer", fontSize: 18, flexShrink: 0, padding: 0 }}>
          {expanded ? "↑" : "↓"}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${T.linen}`, paddingTop: 12 }}>
          <p style={{ fontFamily: F.sans, fontSize: 12, color: T.bark, margin: "0 0 10px", lineHeight: 1.6 }}>
            <strong>Why it matters:</strong> {insight.whyItMatters}
          </p>
          {insight.options.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: T.taupe, margin: "0 0 6px" }}>OPTIONS</p>
              {insight.options.map((o, i) => (
                <p key={i} style={{ fontFamily: F.sans, fontSize: 12, color: T.bark, margin: "0 0 4px", paddingLeft: 12, borderLeft: `2px solid ${T.linen}`, lineHeight: 1.5 }}>
                  {o}
                </p>
              ))}
            </div>
          )}
          <div style={{ padding: "10px 14px", background: `${color}10`, borderRadius: 10 }}>
            <p style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: T.esp, margin: 0, lineHeight: 1.5 }}>
              ✦ {insight.recommendation}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function HealthScoreRing({ score, grade }: { score: number; grade: string }) {
  const color = gradeColor(grade);
  const radius = 38;
  const circ = 2 * Math.PI * radius;
  const filled = (score / 100) * circ;

  return (
    <div style={{ position: "relative", width: 100, height: 100, flexShrink: 0 }}>
      <svg width={100} height={100} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={50} cy={50} r={radius} fill="none" stroke={T.linen} strokeWidth={8} />
        <circle cx={50} cy={50} r={radius} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color }}>{grade}</span>
        <span style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe }}>{score}/100</span>
      </div>
    </div>
  );
}

// ── Live Health Score Card ─────────────────────────────────────────
function LiveHealthScoreCard({ snapshot, monthlyIncome, totalSpent, totalBudget, cashRemaining, savingsRate, dti, cats, goals }: {
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
            detail: worstCat ? `Over by $${Math.round(worstCat.spent - worstCat.budget)} this month` : `${overSpendCount} categories over budget`
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

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function BudgetScreen() {
  const { user, profile, householdSnapshot } = useStore();
  const [tab, setTab] = useState<"overview" | "cfo" | "goals" | "insights">("overview");
  const [hasLoaded, setHasLoaded] = useState(false);

  // ── Core financial data ──────────────────────────────────────────
  const [cats, setCats] = useState<Category[]>(DEFAULT_CATS);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [goals, setGoals] = useState<FinancialGoal[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [healthScore, setHealthScore] = useState<FinancialHealthScore | null>(null);

  // ── Add expense UI ───────────────────────────────────────────────
  const [addExpAmount, setAddExpAmount] = useState("");
  const [addExpMerchant, setAddExpMerchant] = useState("");
  const [addExpNote, setAddExpNote] = useState("");
  const [addExpCat, setAddExpCat] = useState("groceries");
  const [showAddExp, setShowAddExp] = useState(false);

  // ── Income UI ────────────────────────────────────────────────────
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [incLabel, setIncLabel] = useState("");
  const [incAmount, setIncAmount] = useState("");
  const [incFreq, setIncFreq] = useState<Income["frequency"]>("monthly");
  const [incType, setIncType] = useState<Income["type"]>("salary");

  // ── Debt UI ──────────────────────────────────────────────────────
  const [showAddDebt, setShowAddDebt] = useState(false);
  const [debtLabel, setDebtLabel] = useState("");
  const [debtBalance, setDebtBalance] = useState("");
  const [debtAPR, setDebtAPR] = useState("");
  const [debtMin, setDebtMin] = useState("");
  const [debtMonthly, setDebtMonthly] = useState("");
  const [debtType, setDebtType] = useState<Debt["type"]>("credit_card");
  const [debtStrategy, setDebtStrategy] = useState<"avalanche" | "snowball">("avalanche");

  // ── Goal UI ──────────────────────────────────────────────────────
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalType, setGoalType] = useState<FinancialGoal["type"]>("emergency_fund");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalCurrent, setGoalCurrent] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [goalMonthly, setGoalMonthly] = useState("");

  // ── Load decision history ────────────────────────────────────────
  useEffect(() => {
    if (tab !== "cfo" || !user?.uid) return;
    loadDecisionsV2(user.uid).then(decisions => {
      setDecisionHistory(buildDecisionTimeline(decisions));
    }).catch(() => {});
  }, [tab, user?.uid]);

  // ── CFO / Scenario UI ───────────────────────────────────────────
  const [scenarioInput, setScenarioInput] = useState("");
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [decisionHistory, setDecisionHistory] = useState<any[]>([]);
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);

  // ── Coach chat ───────────────────────────────────────────────────
  interface CoachMessage { role: "user" | "assistant"; content: string; }
  const [coachMsgs, setCoachMsgs] = useState<CoachMessage[]>([
    { role: "assistant", content: `Hello${profile?.name ? `, ${profile.name}` : ""}! I'm your Household CFO. Ask me anything — spending patterns, debt strategy, what-if scenarios, or how to hit your goals faster.` }
  ]);
  const [coachInput, setCoachInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── AI generation flags ──────────────────────────────────────────
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [scoreLoading, setScoreLoading] = useState(false);

  // ═══════════════════════════════════════════════════════════════
  // COMPUTED SUMMARY
  // ═══════════════════════════════════════════════════════════════

  const monthlyIncome = incomes.reduce((a, inc) => {
    const m = { monthly: 1, biweekly: 26 / 12, weekly: 52 / 12, annual: 1 / 12 };
    return a + inc.amount * (m[inc.frequency] || 1);
  }, 0);

  const totalBudget   = cats.reduce((a, c) => a + c.budget, 0);
  const totalSpent    = cats.reduce((a, c) => a + c.spent, 0);
  const totalDebt     = debts.reduce((a, d) => a + d.balance, 0);
  const totalMinDebt  = debts.reduce((a, d) => a + d.minimumPayment, 0);
  const cashRemaining = monthlyIncome > 0 ? monthlyIncome - totalSpent : totalBudget - totalSpent;
  const savingsRate   = monthlyIncome > 0 ? Math.max(0, ((monthlyIncome - totalSpent) / monthlyIncome) * 100) : 0;
  const dti           = monthlyIncome > 0 ? (totalMinDebt / monthlyIncome) * 100 : 0;

  const now = new Date();
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dailyRate   = daysElapsed > 0 ? totalSpent / daysElapsed : 0;
  const projected   = Math.round(dailyRate * daysInMonth);

  const summary: MonthlyBudgetSummary = {
    totalIncome: monthlyIncome,
    fixedExpenses: cats.filter(c => ["bills", "childcare", "subscriptions"].includes(c.id)).reduce((a, c) => a + c.spent, 0),
    variableExpenses: totalSpent,
    cashRemaining,
    savingsRate,
    totalDebt,
    debtToIncomeRatio: dti,
  };

  // ═══════════════════════════════════════════════════════════════
  // LOAD / SAVE
  // ═══════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!user?.uid) { setHasLoaded(true); return; }
    loadData(user.uid, "budget_v2").then(d => {
      if (d?.categories) setCats(d.categories as Category[]);
      if (d?.expenses)   setExpenses(d.expenses as Expense[]);
      if (d?.incomes)    setIncomes(d.incomes as Income[]);
      if (d?.debts)      setDebts(d.debts as Debt[]);
      if (d?.goals)      setGoals(d.goals as FinancialGoal[]);
      if (d?.scenarios)  setScenarios(d.scenarios as Scenario[]);
      if (d?.insights)   setInsights(d.insights as AIInsight[]);
      if (d?.healthScore) setHealthScore(d.healthScore as FinancialHealthScore);
    }).finally(() => setHasLoaded(true));
  }, [user?.uid]);

  useEffect(() => {
    // Also load old budget data for migration
    if (!user?.uid) return;
    loadData(user.uid, "budget").then(d => {
      if (d?.categories && !hasLoaded) setCats(d.categories as Category[]);
      if (d?.expenses && !hasLoaded) setExpenses(d.expenses as Expense[]);
      if (d?.goals && !hasLoaded) {
        // Migrate old SavingsGoal → FinancialGoal
        const migrated = (d.goals as any[]).map((g: any) => ({
          id: g.id,
          name: g.name,
          type: "other" as FinancialGoal["type"],
          targetAmount: g.target,
          currentAmount: g.saved,
          targetDate: g.deadline,
          monthlyContribution: 0,
          riskStatus: "on_track" as FinancialGoal["riskStatus"],
        }));
        setGoals(migrated);
      }
    });
  }, [user?.uid]);

  const persist = async (updates: Partial<{
    cats: Category[]; expenses: Expense[]; incomes: Income[];
    debts: Debt[]; goals: FinancialGoal[]; scenarios: Scenario[];
    insights: AIInsight[]; healthScore: FinancialHealthScore;
  }>) => {
    if (!hasLoaded || !user?.uid) return;
    await saveData(user.uid, "budget_v2", {
      categories: updates.cats ?? cats,
      expenses:   updates.expenses ?? expenses,
      incomes:    updates.incomes ?? incomes,
      debts:      updates.debts ?? debts,
      goals:      updates.goals ?? goals,
      scenarios:  updates.scenarios ?? scenarios,
      insights:   updates.insights ?? insights,
      healthScore: updates.healthScore ?? healthScore,
    } as Record<string, unknown>);
  };

  // ═══════════════════════════════════════════════════════════════
  // AI CONTEXT BUILDER
  // ═══════════════════════════════════════════════════════════════

  const buildFinancialContext = () => {
    const catSummary = cats.map(c => `${c.label}: $${c.spent}/$${c.budget} (${Math.round(c.spent / Math.max(c.budget, 1) * 100)}%)`).join(", ");
    const goalSummary = goals.map(g => `${g.name}: $${g.currentAmount}/$${g.targetAmount} (${g.riskStatus})`).join(", ");
    const debtSummary = debts.map(d => `${d.label}: $${d.balance} @ ${d.apr}% APR, paying $${d.monthlyPayment}/mo`).join(", ");
    const overBudget  = cats.filter(c => c.spent > c.budget).map(c => c.label).join(", ");
    const nearLimit   = cats.filter(c => c.spent / Math.max(c.budget, 1) > 0.8 && c.spent <= c.budget).map(c => c.label).join(", ");

    return `
HOUSEHOLD FINANCIAL SNAPSHOT:
- Monthly income: $${Math.round(monthlyIncome).toLocaleString()} ${monthlyIncome === 0 ? "(not set — use your judgment)" : ""}
- Total budget: $${totalBudget.toLocaleString()}
- Total spent this month: $${totalSpent.toLocaleString()}
- Cash remaining: $${Math.round(cashRemaining).toLocaleString()}
- Savings rate: ${savingsRate.toFixed(1)}%
- Total debt: $${totalDebt.toLocaleString()}
- Debt-to-income ratio: ${dti.toFixed(1)}%
- Days elapsed: ${daysElapsed}/${daysInMonth}
- Month-end projection: $${projected.toLocaleString()} (${projected > totalBudget ? "over budget" : "under budget"})

SPENDING BY CATEGORY: ${catSummary}
${overBudget ? `OVER BUDGET: ${overBudget}` : ""}
${nearLimit ? `NEAR LIMIT (>80%): ${nearLimit}` : ""}

FINANCIAL GOALS: ${goalSummary || "None set"}
DEBTS: ${debtSummary || "None tracked"}

USER PROFILE: ${profile?.name || "HerNest user"}, family household
`.trim();
  };

  // ═══════════════════════════════════════════════════════════════
  // ADD EXPENSE
  // ═══════════════════════════════════════════════════════════════

  const addExpense = async () => {
    const amt = parseFloat(addExpAmount);
    if (!amt || isNaN(amt) || amt <= 0) return;
    const exp: Expense = {
      id: crypto.randomUUID(),
      amount: amt,
      category: addExpCat,
      merchant: addExpMerchant.trim() || addExpCat,
      note: addExpNote.trim(),
      date: new Date().toISOString(),
      method: "manual",
    };
    const updatedCats = cats.map(c => c.id === addExpCat ? { ...c, spent: c.spent + amt } : c);
    const updatedExpenses = [exp, ...expenses];
    setCats(updatedCats);
    setExpenses(updatedExpenses);
    setAddExpAmount(""); setAddExpMerchant(""); setAddExpNote(""); setShowAddExp(false);
    await persist({ cats: updatedCats, expenses: updatedExpenses });
    const cat = updatedCats.find(c => c.id === addExpCat);
    if (cat && cat.spent / cat.budget > 0.8) {
      toast(`${cat.icon} ${cat.label} at ${Math.round(cat.spent / cat.budget * 100)}% of budget`, { icon: "⚠️" });
    } else {
      toast.success(`$${amt.toFixed(2)} logged ✓`);
    }
    bus.publish("budget.expense.logged", exp, { userId: user!.uid, source: "budget" });
  };

  // ═══════════════════════════════════════════════════════════════
  // ADD INCOME
  // ═══════════════════════════════════════════════════════════════

  const addIncome = async () => {
    if (!incLabel.trim() || !incAmount) return;
    const inc: Income = {
      id: crypto.randomUUID(),
      label: incLabel.trim(),
      amount: parseFloat(incAmount),
      frequency: incFreq,
      type: incType,
    };
    const updated = [...incomes, inc];
    setIncomes(updated);
    setIncLabel(""); setIncAmount(""); setShowAddIncome(false);
    await persist({ incomes: updated });
    toast.success("Income added ✦");
  };

  // ═══════════════════════════════════════════════════════════════
  // ADD DEBT
  // ═══════════════════════════════════════════════════════════════

  const addDebt = async () => {
    if (!debtLabel.trim() || !debtBalance) return;
    const debt: Debt = {
      id: crypto.randomUUID(),
      label: debtLabel.trim(),
      balance: parseFloat(debtBalance),
      apr: parseFloat(debtAPR) || 0,
      minimumPayment: parseFloat(debtMin) || 0,
      monthlyPayment: parseFloat(debtMonthly) || parseFloat(debtMin) || 0,
      type: debtType,
    };
    const updated = [...debts, debt];
    setDebts(updated);
    setDebtLabel(""); setDebtBalance(""); setDebtAPR(""); setDebtMin(""); setDebtMonthly(""); setShowAddDebt(false);
    await persist({ debts: updated });
    toast.success("Debt added ✦");
  };

  // ═══════════════════════════════════════════════════════════════
  // ADD GOAL
  // ═══════════════════════════════════════════════════════════════

  const addGoal = async () => {
    if (!goalName.trim() || !goalTarget) return;
    const target = parseFloat(goalTarget);
    const current = parseFloat(goalCurrent) || 0;
    const monthly = parseFloat(goalMonthly) || 0;
    let riskStatus: FinancialGoal["riskStatus"] = "on_track";
    if (goalDate) {
      const months = Math.max(1, (new Date(goalDate).getTime() - Date.now()) / (30 * 24 * 60 * 60 * 1000));
      const needed = (target - current) / months;
      if (monthly < needed * 0.8) riskStatus = "off_track";
      else if (monthly < needed) riskStatus = "at_risk";
    }
    const goal: FinancialGoal = {
      id: crypto.randomUUID(),
      name: goalName.trim(),
      type: goalType,
      targetAmount: target,
      currentAmount: current,
      targetDate: goalDate || undefined,
      monthlyContribution: monthly,
      riskStatus,
    };
    const updated = [...goals, goal];
    setGoals(updated);
    setGoalName(""); setGoalTarget(""); setGoalCurrent(""); setGoalDate(""); setGoalMonthly(""); setShowAddGoal(false);
    await persist({ goals: updated });
    toast.success("Goal created ✦");
    bus.publish("budget.savings.goal.created", goal, { userId: user!.uid, source: "budget" });
  };

  const addToGoal = async (goalId: string, amt: number) => {
    const updated = goals.map(g => {
      if (g.id !== goalId) return g;
      const newAmt = Math.min(g.currentAmount + amt, g.targetAmount);
      const prevPct = g.targetAmount > 0 ? (g.currentAmount / g.targetAmount) * 100 : 0;
      const newPct  = g.targetAmount > 0 ? (newAmt / g.targetAmount) * 100 : 0;
      if (prevPct < 25 && newPct >= 25) toast.success(`🎉 25% of ${g.name} saved!`);
      if (prevPct < 50 && newPct >= 50) toast.success(`🎉 Halfway to ${g.name}!`);
      if (prevPct < 75 && newPct >= 75) toast.success(`🎉 75% toward ${g.name}!`);
      if (prevPct < 100 && newPct >= 100) toast.success(`🎉 ${g.name} complete!`);
      return { ...g, currentAmount: newAmt };
    });
    setGoals(updated);
    await persist({ goals: updated });
  };

  // ═══════════════════════════════════════════════════════════════
  // SCENARIO PLANNER
  // ═══════════════════════════════════════════════════════════════

  const runScenario = async (question?: string) => {
    const q = question || scenarioInput.trim();
    if (!q || scenarioLoading) return;
    setScenarioLoading(true);
    setScenarioInput("");

    const scenario: Scenario = { id: crypto.randomUUID(), question: q, createdAt: new Date().toISOString() };
    setActiveScenario(scenario);

    const sys = `You are a Household CFO AI for HerNest. You use Decision Quality methodology to analyze financial scenarios with rigor, clarity, and compassion.

${buildFinancialContext()}

Return ONLY valid JSON matching this exact structure:
{
  "financialImpact": "specific dollar impact and timeline analysis",
  "tradeoffs": ["tradeoff 1", "tradeoff 2", "tradeoff 3"],
  "riskLevel": "low|medium|high",
  "recommendedAction": "clear, specific recommendation with numbers",
  "confidenceLevel": 0-100
}

Rules:
- Use actual numbers from the household data
- Consider cash flow, savings goals, debt obligations
- Be direct about tradeoffs — do not sugarcoat risks
- Confidence should reflect data completeness (low if income not set)
- Sound like a smart, caring financial advisor`;

    const result = await aiJSON<ScenarioResult>(sys, `Analyze this household financial scenario: "${q}"`, "household_cfo", {
      financialImpact: "Unable to analyze — please try again.",
      tradeoffs: [],
      riskLevel: "medium",
      recommendedAction: "Please retry.",
      confidenceLevel: 0,
    });

    const completed: Scenario = { ...scenario, result };
    setActiveScenario(completed);
    const updated = [completed, ...scenarios.slice(0, 9)];
    setScenarios(updated);
    await persist({ scenarios: updated });
    setScenarioLoading(false);
  };

  // ═══════════════════════════════════════════════════════════════
  // GENERATE AI INSIGHTS
  // ═══════════════════════════════════════════════════════════════

  const generateInsights = async () => {
    setInsightsLoading(true);
    const sys = `You are a Household CFO AI. Analyze this household's financial data and return exactly 4 insights.

${buildFinancialContext()}

Return ONLY valid JSON array:
[
  {
    "observation": "specific, data-driven observation",
    "whyItMatters": "why this affects the household",
    "options": ["option 1", "option 2", "option 3"],
    "recommendation": "single best recommendation",
    "confidenceLevel": 0-100,
    "category": "spending|savings|debt|cashflow|stress"
  }
]

Rules:
- Be specific with numbers
- Prioritize insights that drive action
- Include at least one positive insight
- Detect stress spending, subscription creep, seasonal patterns`;

    const result = await aiJSON<AIInsight[]>(sys, "Generate 4 financial insights for this household", "household_cfo", []);
    if (result.length > 0) {
      const stamped = result.map(ins => ({ ...ins, id: crypto.randomUUID(), createdAt: new Date().toISOString() }));
      setInsights(stamped);
      await persist({ insights: stamped });
      toast.success("Insights refreshed ✦");
    } else {
      toast.error("Couldn't generate insights — try again");
    }
    setInsightsLoading(false);
  };

  // ═══════════════════════════════════════════════════════════════
  // GENERATE HEALTH SCORE
  // ═══════════════════════════════════════════════════════════════

  const generateHealthScore = async () => {
    setScoreLoading(true);
    const sys = `You are a Household CFO AI. Score this household's financial health.

${buildFinancialContext()}

Return ONLY valid JSON:
{
  "score": 0-100,
  "summary": "2-sentence summary of financial health",
  "breakdown": [
    { "label": "Cash Flow", "score": 0-100, "color": "#hex" },
    { "label": "Savings", "score": 0-100, "color": "#hex" },
    { "label": "Debt Load", "score": 0-100, "color": "#hex" },
    { "label": "Budget Discipline", "score": 0-100, "color": "#hex" }
  ]
}

Scoring guidelines:
- Cash flow: positive = high score
- Savings rate >15% = A, <5% = D
- DTI <20% = A, >40% = D
- Budget adherence <80% spent = A, >100% = D`;

    const result = await aiJSON<FinancialHealthScore>(sys, "Score this household's financial health", "household_cfo", {
      score: 0, grade: "F", summary: "Unable to score.", breakdown: []
    });
    if (result.score > 0) {
      const scored = { ...result, grade: gradeScore(result.score) };
      setHealthScore(scored);
      await persist({ healthScore: scored });
    }
    setScoreLoading(false);
  };

  // ═══════════════════════════════════════════════════════════════
  // COACH CHAT
  // ═══════════════════════════════════════════════════════════════

  const askCoach = async () => {
    if (!coachInput.trim() || coachLoading) return;
    const userMsg: CoachMessage = { role: "user", content: coachInput };
    setCoachMsgs(p => [...p, userMsg]);
    setCoachInput("");
    setCoachLoading(true);

    const sys = `You are Nora, HerNest's Household CFO — a warm, brilliant financial advisor for modern families. You combine emotional intelligence with rigorous financial analysis using Decision Quality methodology.

${buildFinancialContext()}

Your response style:
- Lead with empathy, then analysis
- Use actual numbers from the household data
- Offer 2-3 concrete options when relevant
- Flag risks without catastrophizing
- End with one clear recommended next step
- Keep it conversational — this is a chat, not a report
- Never lecture or moralize
- Think like a trusted CFO friend`;

    const history = coachMsgs.slice(-8).map(m => ({ role: m.role, content: m.content }));
    // ── Orchestrator handles context, model routing, memory writeback ──
    const cfoText = await askCFO(user!.uid, (profile || {}) as Record<string, unknown>, coachInput, history);

    setCoachMsgs(p => [...p, {
      role: "assistant",
      content: cfoText || "I'm having trouble connecting right now. Please try again."
    }]);
    setCoachLoading(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  // ═══════════════════════════════════════════════════════════════
  // CSV IMPORT (preserved from original)
  // ═══════════════════════════════════════════════════════════════

  const handleCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    toast("Nora is reading your transactions...", { icon: "✦" });
    const sys = `Categorize these bank transactions. Return ONLY valid JSON array:
[{"merchant":"string","amount":0.00,"category":"groceries|kids|fitness|dining|shopping|transport|health|bills|entertainment|subscriptions|childcare|medical|other","date":"YYYY-MM-DD"}]
Maximum 50 transactions.`;
    const result = await ai(sys, text.substring(0, 3000), "csv_import");
    if (result.error) { toast.error("Couldn't read CSV"); return; }
    try {
      const s = result.text.indexOf("["); const en = result.text.lastIndexOf("]");
      const transactions = JSON.parse(result.text.slice(s, en + 1));
      let updatedCats = [...cats];
      const newExpenses: Expense[] = transactions.map((t: any) => {
        updatedCats = updatedCats.map(c => c.id === t.category ? { ...c, spent: c.spent + Math.abs(t.amount) } : c);
        return { id: crypto.randomUUID(), amount: Math.abs(t.amount), category: t.category, merchant: t.merchant, note: "Imported", date: t.date || new Date().toISOString(), method: "csv" as const };
      });
      const updatedExpenses = [...newExpenses, ...expenses];
      setCats(updatedCats);
      setExpenses(updatedExpenses);
      await persist({ cats: updatedCats, expenses: updatedExpenses });
      toast.success(`Imported ${transactions.length} transactions ✓`);
    } catch { toast.error("Couldn't parse CSV"); }
    e.target.value = "";
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  if (!hasLoaded) return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner /></div>;

  const pct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle eyebrow="FINANCES" title="Financial Hub" />

      {/* ── HERO ──────────────────────────────────────────────────── */}
      <HeroCard
        eyebrow="THIS MONTH"
        title={`$${totalSpent.toLocaleString()} spent`}
        subtitle={
          monthlyIncome > 0
            ? `$${Math.round(cashRemaining).toLocaleString()} remaining · ${savingsRate.toFixed(0)}% savings rate`
            : `$${(totalBudget - totalSpent).toLocaleString()} remaining · ${pct}% of budget`
        }
        color={pct > 90 ? T.blush : pct > 70 ? "#8B6914" : T.esp}
      >
        <div style={{ marginTop: 12 }}>
          <ProgressBar value={totalSpent} max={Math.max(totalBudget, 1)} color={pct > 90 ? "#ff6b6b" : T.gold} />
        </div>
        {monthlyIncome > 0 && (
          <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
            <span style={{ fontFamily: F.sans, fontSize: 11, color: "rgba(255,255,255,.7)" }}>
              Income: ${Math.round(monthlyIncome).toLocaleString()}/mo
            </span>
            {totalDebt > 0 && (
              <span style={{ fontFamily: F.sans, fontSize: 11, color: "rgba(255,255,255,.7)" }}>
                Debt: ${totalDebt.toLocaleString()}
              </span>
            )}
          </div>
        )}
      </HeroCard>

      {/* ── TABS ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, justifyContent: "center", flexWrap: "wrap" }}>
        {[
          { id: "overview", label: "Overview" },
          { id: "cfo",      label: "✦ CFO" },
          { id: "goals",    label: "🎯 Goals" },
          { id: "insights", label: "💡 Insights" },
        ].map(t => (
          <Pill key={t.id} label={t.label} active={tab === t.id as any} onClick={() => setTab(t.id as any)} />
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════
          TAB: OVERVIEW
      ════════════════════════════════════════════════════════════ */}
      {tab === "overview" && (
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

          {/* CSV Import */}
          <div style={{ marginTop: 12, padding: "12px 16px", background: T.sand, borderRadius: 16, border: `1px solid ${T.linen}`, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>📄</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>Import bank statement</p>
              <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "2px 0 0" }}>Upload CSV — Nora categorizes automatically</p>
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
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB: HOUSEHOLD CFO
      ════════════════════════════════════════════════════════════ */}
      {tab === "cfo" && (
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
                    style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }} />
                  <select value={debtType} onChange={e => setDebtType(e.target.value as Debt["type"])}
                    style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }}>
                    <option value="credit_card">Credit Card</option>
                    <option value="student_loan">Student Loan</option>
                    <option value="car_loan">Car Loan</option>
                    <option value="mortgage">Mortgage</option>
                    <option value="personal">Personal Loan</option>
                    <option value="other">Other</option>
                  </select>
                  <input value={debtBalance} onChange={e => setDebtBalance(e.target.value)} placeholder="Balance ($)" type="number"
                    style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }} />
                  <input value={debtAPR} onChange={e => setDebtAPR(e.target.value)} placeholder="APR (%)" type="number"
                    style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }} />
                  <input value={debtMin} onChange={e => setDebtMin(e.target.value)} placeholder="Min payment ($)" type="number"
                    style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }} />
                  <input value={debtMonthly} onChange={e => setDebtMonthly(e.target.value)} placeholder="Monthly payment ($)" type="number"
                    style={{ background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }} />
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
                              {d.apr}% APR · Min ${d.minimumPayment}/mo · Payoff {payoff}
                            </p>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <p style={{ fontFamily: F.serif, fontSize: 18, fontWeight: 700, color: T.blush, margin: 0 }}>${d.balance.toLocaleString()}</p>
                            {interest > 0 && <p style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, margin: "2px 0 0" }}>+${interest.toLocaleString()} interest</p>}
                          </div>
                        </div>
                        <ProgressBar value={d.monthlyPayment * 12} max={d.balance} color={T.teal} height={4} />
                        <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "6px 0 0" }}>
                          Paying ${d.monthlyPayment}/mo
                        </p>
                      </Card>
                    );
                  })}
              </>
            )}

            {debts.length === 0 && !showAddDebt && (<div style={{ textAlign:"center", padding:"24px 16px" }}><p style={{ fontFamily:F.serif, fontSize:18, fontStyle:"italic", color:T.esp, margin:"0 0 8px" }}>No debt tracked yet</p><p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 16px" }}>Add any loans, credit cards, or lines of credit to unlock debt strategy insights.</p></div>) } {false && (
              <div style={{ padding: "20px", textAlign: "center", background: T.sand, borderRadius: 16, border: `1px dashed ${T.linen}` }}>
                <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0 }}>No debts tracked. Add one to get payoff strategy and interest analysis.</p>
              </div>
            )}
          </div>

          {/* Scenario Planner */}
          <div style={{ marginTop: 20 }}>
            <SectionLabel>Scenario Planner</SectionLabel>
            <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 12px", lineHeight: 1.6 }}>
              Ask any financial "what if" — your CFO will analyze the impact, tradeoffs, and best path forward.
            </p>

            {/* Suggested prompts */}
            <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12, paddingBottom: 4, scrollbarWidth: "none" }}>
              {SCENARIO_PROMPTS.map((p, i) => (
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
                style={{ flex: 1, background: T.ivory, border: `1.5px solid ${T.linen}`, borderRadius: 14, padding: "11px 14px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none" }} />
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
                  style={{ flex: 1, background: T.ivory, border: `1.5px solid ${T.linen}`, borderRadius: 14, padding: "11px 14px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none" }} />
                <button onClick={askCoach} disabled={!coachInput.trim() || coachLoading}
                  style={{ width: 44, height: 44, borderRadius: 14, background: coachInput.trim() ? T.esp : T.linen, border: "none", color: "#fff", fontSize: 18, cursor: coachInput.trim() ? "pointer" : "not-allowed", flexShrink: 0 }}>
                  →
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB: GOALS
      ════════════════════════════════════════════════════════════ */}
      {tab === "goals" && (
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
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB: INSIGHTS
      ════════════════════════════════════════════════════════════ */}
      {tab === "insights" && (
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
                <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0 }}>Nora is analyzing your household finances...</p>
              </div>
            )}

            {insights.length > 0 && !insightsLoading && insights.map(ins => (
              <InsightCard key={ins.id} insight={ins} />
            ))}

            {insights.length === 0 && !insightsLoading && (
              <div style={{ padding: "32px 20px", textAlign: "center", background: T.sand, borderRadius: 20, border: `1px dashed ${T.linen}` }}>
                <p style={{ fontFamily: F.serif, fontSize: 20, fontStyle: "italic", color: T.esp, margin: "0 0 8px" }}>No insights yet</p>
                <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: "0 0 16px" }}>
                  Nora will analyze your spending patterns, flag anomalies, and surface opportunities.
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
                    ? `⚠ On track to overspend by $${(projected - totalBudget).toLocaleString()}`
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
      )}
    </div>
  );
}
