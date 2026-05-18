// ─── HerNest Household Intelligence ──────────────────────────────
// Cross-module insight generation
// Updated: SpendingTrend integration, compliance language, richer prompts

import { aiJSON } from "../ai";
import { loadData, saveData } from "../firebase";
import { buildMemoryContext } from "../memory";
import { buildMemoryContextV2 } from "../memoryServiceV2";
import { buildSpendingTrends, COMPLIANCE_DISCLAIMER } from "./DecisionEngine";
import type { HouseholdInsight, HouseholdSnapshot } from "../store";

// ── Build prompt context ──────────────────────────────────────────
export function buildIntelligencePromptContext(
  snapshot: HouseholdSnapshot,
  appContext?: {
    calendarDensity?: string;
    tasksOverdue?: number;
    upcomingTrip?: string;
    wellnessScore?: number;
    sleepTrend?: number[];
    moodTrend?: number[];
    profileName?: string;
    kids?: string[];
    spendingTrends?: ReturnType<typeof buildSpendingTrends>;
  }
): string {
  const f = snapshot.financial;

  const lines = [
    `HOUSEHOLD SNAPSHOT (${new Date(snapshot.lastRefreshed).toLocaleDateString()}):`,
    ``,
    `FINANCES:`,
    `- Income: $${Math.round(f.monthlyIncome).toLocaleString()}/mo ${f.monthlyIncome === 0 ? "(not set)" : ""}`,
    `- Spent: $${f.totalSpent.toLocaleString()} / $${f.totalBudget.toLocaleString()} budget`,
    `- Cash remaining: $${Math.round(f.cashRemaining).toLocaleString()}`,
    `- Savings rate: ${f.savingsRate.toFixed(1)}%`,
    `- Total debt: $${f.totalDebt.toLocaleString()}`,
    `- Financial health: ${f.financialHealthGrade} (${f.financialHealthScore}/100)`,
    `- Overspend categories: ${f.topOverspendCategories.join(", ") || "None"}`,
    `- Month-end projection: $${f.projectedMonthEnd.toLocaleString()}`,
  ];

  if (appContext?.spendingTrends?.length) {
    lines.push(``, `SPENDING TRENDS (vs last month):`);
    appContext.spendingTrends
      .filter(t => Math.abs(t.percentageChange) > 10 || t.riskLevel === "high")
      .slice(0, 5)
      .forEach(t => {
        const dir = t.percentageChange > 0 ? `+${t.percentageChange}%` : `${t.percentageChange}%`;
        lines.push(`- ${t.category}: $${t.currentMonthAmount} (${dir} vs last month, ${t.riskLevel} risk)`);
      });
  }

  lines.push(``, `GOALS:`);
  if (snapshot.activeGoals.length) {
    snapshot.activeGoals.forEach(g => lines.push(`- ${g.name}: ${g.riskStatus.replace("_", " ")}`));
  } else {
    lines.push(`- No goals set`);
  }

  if (appContext) {
    lines.push(``, `CALENDAR & LOAD:`);
    lines.push(`- Load: ${snapshot.calendarLoad.toUpperCase()}, Busy weeks ahead: ${snapshot.busyWeeksAhead}`);
    if (appContext.calendarDensity) lines.push(`- Today: ${appContext.calendarDensity}`);
    if (appContext.tasksOverdue) lines.push(`- Overdue tasks: ${appContext.tasksOverdue}`);
    if (appContext.upcomingTrip) lines.push(`- Upcoming trip: ${appContext.upcomingTrip}`);

    lines.push(``, `WELLNESS:`);
    lines.push(`- Household stress: ${snapshot.householdStressLevel}`);
    if (appContext.wellnessScore) lines.push(`- Weekly score: ${appContext.wellnessScore}/10`);
    if (appContext.sleepTrend?.length) lines.push(`- Sleep (7d): ${appContext.sleepTrend.join(", ")}h`);
    if (appContext.moodTrend?.length) lines.push(`- Mood (7d): ${appContext.moodTrend.join(", ")}/5`);

    if (appContext.kids?.length) {
      lines.push(``, `FAMILY:`);
      lines.push(`- Children: ${appContext.kids.join(", ")}`);
    }
  }

  return lines.join("\n");
}

// ── Generate cross-module insights ────────────────────────────────
export async function generateHouseholdInsights(
  snapshot: HouseholdSnapshot,
  userId: string,
  appContext?: Parameters<typeof buildIntelligencePromptContext>[1]
): Promise<HouseholdInsight[]> {
  const context = buildIntelligencePromptContext(snapshot, appContext);
  const memory = await buildMemoryContextV2(userId).catch(() => buildMemoryContext(userId));

  const sys = `You are HerNest CFO, an AI financial intelligence assistant for families.

${COMPLIANCE_DISCLAIMER}

You have visibility across finances, calendar, wellness, family, and goals.
Generate exactly 4 insights that are genuinely useful to this household.

${context}

${memory ? `NORA'S MEMORY OF THIS HOUSEHOLD:\n${memory}` : ""}

Prioritize insights that CROSS modules:
- High calendar load + increased spending = stress spending pattern
- Goal at risk + upcoming trip = timing conflict
- Low wellness + overspending = emotional spending signal
- Subscription creep detection
- Seasonal spending spikes
- Unusual transactions vs normal patterns

Return ONLY valid JSON array — no markdown:
[{
  "observation": "specific, data-driven, 1-2 sentences with numbers",
  "whyItMatters": "why this affects this household specifically",
  "options": ["concrete option 1", "concrete option 2", "concrete option 3"],
  "recommendation": "single best action, specific and actionable",
  "confidenceLevel": 0-100,
  "category": "spending|savings|debt|cashflow|stress|scheduling|family|health|decision|opportunity",
  "sourceModules": ["budget", "calendar"]
}]

Rules:
- Use actual numbers
- At least 2 of 4 insights must connect multiple modules
- Include at least 1 positive/opportunity insight
- Write like a smart trusted friend, not a financial report
- Never guarantee outcomes or provide investment/legal/tax advice`;

  type RawInsight = Omit<HouseholdInsight, "id" | "createdAt">;
  const results = await aiJSON<RawInsight[]>(sys, "Generate household insights", "nora_chat", []);
  if (!results.length) return [];

  return results.map(ins => ({
    ...ins,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    dismissed: false,
  }));
}

// ── Persist + load insights ───────────────────────────────────────
export async function saveHouseholdInsights(userId: string, insights: HouseholdInsight[]): Promise<void> {
  try {
    await saveData(userId, "household_insights", { insights, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("[Intelligence] save failed:", e);
  }
}

export async function loadHouseholdInsights(userId: string): Promise<HouseholdInsight[]> {
  try {
    const data = await loadData(userId, "household_insights");
    return (data?.insights as HouseholdInsight[]) || [];
  } catch { return []; }
}

// ── Build household snapshot from Firestore ───────────────────────
export async function buildHouseholdSnapshot(userId: string): Promise<HouseholdSnapshot> {
  const [budgetData, thriveData, calendarData] = await Promise.all([
    loadData(userId, "budget_v2"),
    loadData(userId, "thrive"),
    loadData(userId, "calendar"),
  ]);

  const cats = (budgetData?.categories as any[]) || [];
  const incomes = (budgetData?.incomes as any[]) || [];
  const debts = (budgetData?.debts as any[]) || [];
  const goals = (budgetData?.goals as any[]) || [];

  const monthlyIncome = incomes.reduce((a: number, inc: any) => {
    const m: Record<string, number> = { monthly: 1, biweekly: 26 / 12, weekly: 52 / 12, annual: 1 / 12 };
    return a + (inc.amount || 0) * (m[inc.frequency] || 1);
  }, 0);

  const totalBudget = cats.reduce((a: number, c: any) => a + (c.budget || 0), 0);
  const totalSpent  = cats.reduce((a: number, c: any) => a + (c.spent || 0), 0);
  const totalDebt   = debts.reduce((a: number, d: any) => a + (d.balance || 0), 0);
  const totalMin    = debts.reduce((a: number, d: any) => a + (d.minimumPayment || 0), 0);
  const cashRemaining = monthlyIncome > 0 ? monthlyIncome - totalSpent : totalBudget - totalSpent;
  const savingsRate   = monthlyIncome > 0 ? Math.max(0, ((monthlyIncome - totalSpent) / monthlyIncome) * 100) : 0;
  const dti           = monthlyIncome > 0 ? (totalMin / monthlyIncome) * 100 : 0;

  const now = new Date();
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedMonthEnd = Math.round(daysElapsed > 0 ? (totalSpent / daysElapsed) * daysInMonth : 0);

  const events = (calendarData?.events as any[]) || [];
  const todayStr = now.toISOString().split("T")[0];
  const nextWeekStr = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const upcomingEvents = events.filter((e: any) => e.date >= todayStr && e.date <= nextWeekStr);
  const busyWeeksAhead = Math.min(3, Math.floor(upcomingEvents.length / 3));
  const calendarLoad: HouseholdSnapshot["calendarLoad"] =
    upcomingEvents.length >= 10 ? "critical" :
    upcomingEvents.length >= 6  ? "heavy" :
    upcomingEvents.length >= 3  ? "normal" : "light";

  const moodLogs = (thriveData?.moodLog as any[]) || [];
  const recentMood = moodLogs.slice(-3).map((l: any) => l.value || 3);
  const avgMood = recentMood.length ? recentMood.reduce((a: number, b: number) => a + b, 0) / recentMood.length : 3;
  const householdStressLevel: HouseholdSnapshot["householdStressLevel"] =
    avgMood < 2 || (calendarLoad === "critical" && savingsRate < 5) ? "high" :
    avgMood < 3 || calendarLoad === "heavy" ? "moderate" : "low";

  const healthScore = (budgetData?.healthScore as any) || null;

  return {
    financial: {
      monthlyIncome, totalBudget, totalSpent, cashRemaining,
      savingsRate, totalDebt, debtToIncomeRatio: dti, projectedMonthEnd,
      topOverspendCategories: cats.filter((c: any) => c.spent > c.budget).map((c: any) => c.label),
      financialHealthScore: healthScore?.score || 0,
      financialHealthGrade: healthScore?.grade || "—",
    },
    calendarLoad,
    busyWeeksAhead,
    activeGoals: goals.map((g: any) => ({
      name: g.name,
      riskStatus: (g.riskStatus || "on_track") as "on_track" | "at_risk" | "off_track",
    })),
    householdStressLevel,
    lastRefreshed: new Date().toISOString(),
  };
}

// ── Get top undismissed insight for Home screen ───────────────────
export function getTopInsight(insights: HouseholdInsight[]): HouseholdInsight | null {
  const active = insights.filter(i => !i.dismissed);
  if (!active.length) return null;
  const opportunity = active.find(i => i.category === "opportunity");
  if (opportunity) return opportunity;
  const highRisk = active.find(i => ["cashflow", "debt", "stress"].includes(i.category) && i.confidenceLevel >= 70);
  if (highRisk) return highRisk;
  return active[0];
}
