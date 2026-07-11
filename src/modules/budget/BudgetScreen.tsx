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
import { DEFAULT_CATS, gradeScore } from "./budgetShared";
import type {
  Category, Expense, Income, Debt, FinancialGoal, Scenario, ScenarioResult,
  AIInsight, FinancialHealthScore, MonthlyBudgetSummary,
} from "./budgetShared";
import { BudgetOverviewTab } from "./BudgetOverviewTab";
import { ReceiptsInbox, type GmailReceipt } from "./ReceiptsInbox";
import { BudgetCFOTab } from "./BudgetCFOTab";
import { BudgetGoalsTab } from "./BudgetGoalsTab";
import { BudgetBillsTab } from "./BudgetBillsTab";
import { BudgetInsightsTab } from "./BudgetInsightsTab";
import { formatMoney, currencySymbol } from "../../shared/utils/money";

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function BudgetScreen() {
  const { user, profile, householdSnapshot } = useStore();
  const [tab, setTab] = useState<"overview" | "bills" | "cfo" | "goals" | "insights">("overview");
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
    const cur = currencySymbol();
    const catSummary = cats.map(c => `${c.label}: ${cur}${c.spent}/${cur}${c.budget} (${Math.round(c.spent / Math.max(c.budget, 1) * 100)}%)`).join(", ");
    const goalSummary = goals.map(g => `${g.name}: ${cur}${g.currentAmount}/${cur}${g.targetAmount} (${g.riskStatus})`).join(", ");
    const debtSummary = debts.map(d => `${d.label}: ${cur}${d.balance} @ ${d.apr}% APR, paying ${cur}${d.monthlyPayment}/mo`).join(", ");
    const overBudget  = cats.filter(c => c.spent > c.budget).map(c => c.label).join(", ");
    const nearLimit   = cats.filter(c => c.spent / Math.max(c.budget, 1) > 0.8 && c.spent <= c.budget).map(c => c.label).join(", ");

    return `
HOUSEHOLD FINANCIAL SNAPSHOT:
- Monthly income: ${formatMoney(monthlyIncome)} ${monthlyIncome === 0 ? "(not set — use your judgment)" : ""}
- Total budget: ${formatMoney(totalBudget)}
- Total spent this month: ${formatMoney(totalSpent)}
- Cash remaining: ${formatMoney(cashRemaining)}
- Savings rate: ${savingsRate.toFixed(1)}%
- Total debt: ${formatMoney(totalDebt)}
- Debt-to-income ratio: ${dti.toFixed(1)}%
- Days elapsed: ${daysElapsed}/${daysInMonth}
- Month-end projection: ${formatMoney(projected)} (${projected > totalBudget ? "over budget" : "under budget"})

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

  // Gmail receipt approved → real expense (same shape as a manual add)
  const applyReceipt = async (r: GmailReceipt) => {
    const catId = cats.some(c => c.id === r.category) ? r.category : "other";
    const exp: Expense = {
      id: crypto.randomUUID(),
      amount: r.amount,
      category: catId,
      merchant: r.merchant,
      note: "From Gmail receipt",
      date: r.date || new Date().toISOString(),
      method: "receipt",
    };
    const updatedCats = cats.map(c => c.id === catId ? { ...c, spent: c.spent + r.amount } : c);
    const updatedExpenses = [exp, ...expenses];
    setCats(updatedCats);
    setExpenses(updatedExpenses);
    await persist({ cats: updatedCats, expenses: updatedExpenses });
    await bus.publish("budget.expense.logged", exp, { userId: user!.uid, source: "budget" }).catch(() => {});
  };

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
      toast.success(`${formatMoney(amt)} logged ✓`);
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

    const sys = `You are Cleo, HerNest's Household CFO — a warm, brilliant financial advisor for modern families. You combine emotional intelligence with rigorous financial analysis using Decision Quality methodology.

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
    toast("Cleo is reading your transactions...", { icon: "✦" });
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
  // PLAID — live bank feed (Wave 3)
  // ═══════════════════════════════════════════════════════════════

  const [bankConnected, setBankConnected] = useState(false);
  const [bankCount, setBankCount] = useState(0);
  const [bankBusy, setBankBusy] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "integrations").then(() => {}).catch(() => {});
    import("firebase/firestore").then(async ({ doc, getDoc }) => {
      const { db } = await import("../../core/firebase");
      try {
        const snap = await getDoc(doc(db, "users", user.uid, "integrations", "plaid"));
        const d = snap.exists() ? snap.data() : null;
        // New multi-bank summary uses `connected`/`bankCount`; fall back to the
        // legacy single-doc `accessToken` so a pre-migration connection still shows.
        const count = d?.bankCount ?? (d?.accessToken ? 1 : 0);
        setBankCount(count);
        setBankConnected(!!(d?.connected || count > 0));
      } catch { /* non-fatal */ }
    });
  }, [user?.uid]);

  // Turn synced Plaid transactions into expenses + update category spend,
  // deduped by transaction id — mirrors the CSV importer.
  const applyBankTransactions = async () => {
    const { syncBankTransactions } = await import("../../core/plaidService");
    const { transactions, error, reauthRequired } = await syncBankTransactions();
    if (error && error !== "not_connected") { toast.error("Couldn't sync transactions"); return 0; }
    // Soft reauth: one bank needs reconnecting, but others may have synced.
    if (reauthRequired) toast("One bank needs reconnecting — tap Add to re-link it", { icon: "🔑" });
    if (!transactions.length) return 0;

    const existingIds = new Set(expenses.map(e => e.id));
    const fresh = transactions.filter(t => !existingIds.has(t.id));
    if (!fresh.length) return 0;

    let updatedCats = [...cats];
    const newExpenses: Expense[] = fresh.map(t => {
      updatedCats = updatedCats.map(c => c.id === t.category ? { ...c, spent: c.spent + Math.abs(t.amount) } : c);
      return { id: t.id, amount: Math.abs(t.amount), category: t.category, merchant: t.merchant, note: "Bank feed", date: t.date, method: "plaid" as const };
    });
    const updatedExpenses = [...newExpenses, ...expenses];
    setCats(updatedCats);
    setExpenses(updatedExpenses);
    await persist({ cats: updatedCats, expenses: updatedExpenses });
    return fresh.length;
  };

  const connectBank = async () => {
    setBankBusy(true);
    try {
      const { connectBank: startConnect } = await import("../../core/plaidService");
      const result = await startConnect();
      if (result === "not_configured") { toast("Bank connections aren't set up yet", { icon: "🔌" }); return; }
      if (result === "cancelled") return;
      if (result !== "connected") { toast.error("Couldn't connect — try again"); return; }
      setBankConnected(true);
      setBankCount(c => c + 1);
      toast("Cleo is pulling your transactions...", { icon: "✦" });
      const n = await applyBankTransactions();
      toast.success(n > 0 ? `Imported ${n} transaction${n === 1 ? "" : "s"} ✓` : "Bank connected ✓");
    } catch {
      toast.error("Couldn't connect — try again");
    } finally {
      setBankBusy(false);
    }
  };

  const refreshBank = async () => {
    setBankBusy(true);
    try {
      const n = await applyBankTransactions();
      toast.success(n > 0 ? `${n} new transaction${n === 1 ? "" : "s"} ✓` : "Up to date ✓");
    } finally {
      setBankBusy(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  if (!hasLoaded) return <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner /></div>;

  const pct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle eyebrow="FINANCES" title="Financial Hub" />

      <ReceiptsInbox onApprove={applyReceipt} />

      {/* First-use: without income, Cleo's whole financial brain is blind —
          make the first step unmissable instead of showing an empty grid. */}
      {monthlyIncome === 0 && expenses.length === 0 && (
        <div style={{ background:`linear-gradient(135deg,${T.gold}18,${T.gold}08)`, border:`1.5px solid ${T.gold}40`, borderRadius:20, padding:"18px", marginBottom:12 }}>
          <p style={{ fontFamily:F.serif, fontSize:19, fontStyle:"italic", color:T.esp, margin:"0 0 6px" }}>Let's give Cleo the numbers</p>
          <p style={{ fontFamily:F.sans, fontSize:12.5, color:T.bark, margin:"0 0 14px", lineHeight:1.6 }}>Start with your monthly income — even a rough figure unlocks the health score, insights, and the CFO. Everything else can follow.</p>
          <button onClick={()=>setShowAddIncome(true)}
            style={{ background:T.esp, color:"#fff", border:"none", borderRadius:12, padding:"12px 20px", fontFamily:F.sans, fontSize:13.5, fontWeight:700, cursor:"pointer", minHeight:46, touchAction:"manipulation" }}>
            Add your income ✦
          </button>
        </div>
      )}

      {/* ── HERO ──────────────────────────────────────────────────── */}
      <HeroCard
        eyebrow="THIS MONTH"
        title={`${formatMoney(totalSpent)} spent`}
        subtitle={
          monthlyIncome > 0
            ? `${formatMoney(cashRemaining)} remaining · ${savingsRate.toFixed(0)}% savings rate`
            : `${formatMoney(totalBudget - totalSpent)} remaining · ${pct}% of budget`
        }
        color={pct > 90 ? T.blush : pct > 70 ? "#8B6914" : T.esp}
      >
        <div style={{ marginTop: 12 }}>
          <ProgressBar value={totalSpent} max={Math.max(totalBudget, 1)} color={pct > 90 ? "#ff6b6b" : T.gold} />
        </div>
        {monthlyIncome > 0 && (
          <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
            <span style={{ fontFamily: F.sans, fontSize: 11, color: "rgba(255,255,255,.7)" }}>
              Income: {formatMoney(monthlyIncome)}/mo
            </span>
            {totalDebt > 0 && (
              <span style={{ fontFamily: F.sans, fontSize: 11, color: "rgba(255,255,255,.7)" }}>
                Debt: {formatMoney(totalDebt)}
              </span>
            )}
          </div>
        )}
      </HeroCard>

      {/* ── TABS ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, justifyContent: "center", flexWrap: "wrap" }}>
        {[
          { id: "overview", label: "Overview" },
          { id: "bills",    label: "💳 Bills" },
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
        <BudgetOverviewTab
          cats={cats} expenses={expenses} incomes={incomes}
          monthlyIncome={monthlyIncome} cashRemaining={cashRemaining} projected={projected}
          totalBudget={totalBudget} savingsRate={savingsRate}
          showAddExp={showAddExp} setShowAddExp={setShowAddExp}
          addExpAmount={addExpAmount} setAddExpAmount={setAddExpAmount}
          addExpMerchant={addExpMerchant} setAddExpMerchant={setAddExpMerchant}
          addExpNote={addExpNote} setAddExpNote={setAddExpNote}
          addExpCat={addExpCat} setAddExpCat={setAddExpCat}
          addExpense={addExpense}
          showAddIncome={showAddIncome} setShowAddIncome={setShowAddIncome}
          incLabel={incLabel} setIncLabel={setIncLabel}
          incAmount={incAmount} setIncAmount={setIncAmount}
          incFreq={incFreq} setIncFreq={setIncFreq}
          addIncome={addIncome}
          bankConnected={bankConnected} bankCount={bankCount} bankBusy={bankBusy}
          connectBank={connectBank} refreshBank={refreshBank}
          handleCSV={handleCSV}
        />
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB: BILLS
      ════════════════════════════════════════════════════════════ */}
      {tab === "bills" && user?.uid && <BudgetBillsTab uid={user.uid} />}

      {/* ════════════════════════════════════════════════════════════
          TAB: HOUSEHOLD CFO
      ════════════════════════════════════════════════════════════ */}
      {tab === "cfo" && (
        <BudgetCFOTab
          householdSnapshot={householdSnapshot}
          monthlyIncome={monthlyIncome} totalSpent={totalSpent} totalBudget={totalBudget}
          cashRemaining={cashRemaining} savingsRate={savingsRate} dti={dti}
          cats={cats} goals={goals}
          showAddDebt={showAddDebt} setShowAddDebt={setShowAddDebt}
          decisionHistory={decisionHistory}
          debtLabel={debtLabel} setDebtLabel={setDebtLabel}
          debtType={debtType} setDebtType={setDebtType}
          debtBalance={debtBalance} setDebtBalance={setDebtBalance}
          debtAPR={debtAPR} setDebtAPR={setDebtAPR}
          debtMin={debtMin} setDebtMin={setDebtMin}
          debtMonthly={debtMonthly} setDebtMonthly={setDebtMonthly}
          addDebt={addDebt}
          debts={debts} debtStrategy={debtStrategy} setDebtStrategy={setDebtStrategy}
          scenarioInput={scenarioInput} setScenarioInput={setScenarioInput}
          runScenario={runScenario} scenarioLoading={scenarioLoading} activeScenario={activeScenario}
          coachMsgs={coachMsgs} coachLoading={coachLoading}
          coachInput={coachInput} setCoachInput={setCoachInput}
          askCoach={askCoach} chatEndRef={chatEndRef}
        />
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB: GOALS
      ════════════════════════════════════════════════════════════ */}
      {tab === "goals" && (
        <BudgetGoalsTab
          goals={goals}
          showAddGoal={showAddGoal} setShowAddGoal={setShowAddGoal}
          goalName={goalName} setGoalName={setGoalName}
          goalType={goalType} setGoalType={setGoalType}
          goalTarget={goalTarget} setGoalTarget={setGoalTarget}
          goalCurrent={goalCurrent} setGoalCurrent={setGoalCurrent}
          goalMonthly={goalMonthly} setGoalMonthly={setGoalMonthly}
          goalDate={goalDate} setGoalDate={setGoalDate}
          addGoal={addGoal} addToGoal={addToGoal}
        />
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB: INSIGHTS
      ════════════════════════════════════════════════════════════ */}
      {tab === "insights" && (
        <BudgetInsightsTab
          cats={cats} expenses={expenses} insights={insights}
          insightsLoading={insightsLoading} generateInsights={generateInsights}
          projected={projected} totalBudget={totalBudget}
          dailyRate={dailyRate} daysInMonth={daysInMonth} daysElapsed={daysElapsed}
        />
      )}
    </div>
  );
}
