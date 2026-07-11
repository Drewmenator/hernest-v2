// ─── HerNest Household Intelligence ──────────────────────────────
// Cross-module insight generation
// Updated: SpendingTrend integration, compliance language, richer prompts

import { aiJSON } from "../ai";
import { currencySymbol } from "../../shared/utils/money";
import { loadData, saveData } from "../firebase";
import { buildMemoryContext } from "../memory";
import { buildMemoryContextV2 } from "../memoryServiceV2";
import { buildSpendingTrends } from "./DecisionEngine";
import { COMPLIANCE_DISCLAIMER } from "./constants";
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
    `- Income: ${currencySymbol()}${Math.round(f.monthlyIncome).toLocaleString()}/mo ${f.monthlyIncome === 0 ? "(not set)" : ""}`,
    `- Spent: ${currencySymbol()}${f.totalSpent.toLocaleString()} / ${currencySymbol()}${f.totalBudget.toLocaleString()} budget`,
    `- Cash remaining: ${currencySymbol()}${Math.round(f.cashRemaining).toLocaleString()}`,
    `- Savings rate: ${f.savingsRate.toFixed(1)}%`,
    `- Total debt: ${currencySymbol()}${f.totalDebt.toLocaleString()}`,
    `- Financial health: ${f.financialHealthGrade} (${f.financialHealthScore}/100)`,
    `- Overspend categories: ${f.topOverspendCategories.join(", ") || "None"}`,
    `- Month-end projection: ${currencySymbol()}${f.projectedMonthEnd.toLocaleString()}`,
  ];

  if (appContext?.spendingTrends?.length) {
    lines.push(``, `SPENDING TRENDS (vs last month):`);
    appContext.spendingTrends
      .filter(t => Math.abs(t.percentageChange) > 10 || t.riskLevel === "high")
      .slice(0, 5)
      .forEach(t => {
        const dir = t.percentageChange > 0 ? `+${t.percentageChange}%` : `${t.percentageChange}%`;
        lines.push(`- ${t.category}: ${currencySymbol()}${t.currentMonthAmount} (${dir} vs last month, ${t.riskLevel} risk)`);
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
  const memory = await buildMemoryContextV2(userId, { maxResults: 10 }).catch(() => buildMemoryContext(userId));

  const sys = `You are HerNest CFO, an AI financial intelligence assistant for families.

${COMPLIANCE_DISCLAIMER}

You have visibility across finances, calendar, wellness, family, and goals.
Generate exactly 4 insights that are genuinely useful to this household.

${context}

${memory ? `CLEO'S MEMORY OF THIS HOUSEHOLD:\n${memory}` : ""}

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
  const results = await aiJSON<RawInsight[]>(sys, "Generate household insights", "cleo_chat", []);
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
  const [budgetData, thriveData, calendarData, tripsData] = await Promise.all([
    loadData(userId, "budget_v2"),
    loadData(userId, "thrive"),
    loadData(userId, "calendar"),
    loadData(userId, "trips"),
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
  const twoWeekStr = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const upcomingEvents = events.filter((e: any) => e.date >= todayStr && e.date <= twoWeekStr);
  const thisWeekEvents = events.filter((e: any) => e.date >= todayStr && e.date <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);
  const busyWeeksAhead = Math.min(3, Math.floor(upcomingEvents.length / 5));
  const calendarLoad: HouseholdSnapshot["calendarLoad"] =
    thisWeekEvents.length >= 12 ? "critical" :
    thisWeekEvents.length >= 7  ? "heavy" :
    thisWeekEvents.length >= 3  ? "normal" : "light";

  const moodLogs = (thriveData?.moodLog as any[]) || [];
  const sleepLogs = (thriveData?.sleepLog as any[]) || [];
  const recentMood = moodLogs.slice(-5).map((l: any) => l.value || 3);
  const recentSleep = sleepLogs.slice(-5).map((l: any) => l.hours || 7);
  const avgMood = recentMood.length ? recentMood.reduce((a: number, b: number) => a + b, 0) / recentMood.length : 3;
  const avgSleep = recentSleep.length ? recentSleep.reduce((a: number, b: number) => a + b, 0) / recentSleep.length : 7;
  const wellnessScore = (thriveData?.weeklyScore as number) || 0;

  // Trips: find upcoming trip within 14 days
  const allTrips = (tripsData?.trips as any[]) || [];
  const upcomingTrip = allTrips.find((t: any) => {
    const du = Math.ceil((new Date(t.departureDate).getTime() - Date.now()) / 86400000);
    return du >= 0 && du <= 14;
  });
  const tripStress = upcomingTrip ? 1 : 0;

  const stressScore =
    (avgMood < 2 ? 3 : avgMood < 3 ? 1 : 0) +
    (avgSleep < 5 ? 3 : avgSleep < 6 ? 1 : 0) +
    (calendarLoad === "critical" ? 2 : calendarLoad === "heavy" ? 1 : 0) +
    (savingsRate < 5 && monthlyIncome > 0 ? 2 : 0) +
    tripStress;

  const householdStressLevel: HouseholdSnapshot["householdStressLevel"] =
    stressScore >= 4 ? "high" : stressScore >= 2 ? "moderate" : "low";

  // ── Live financial health score (5 dimensions) ─────────────────
  // 1. Savings rate (0-25pts)
  const savingsScore =
    savingsRate >= 20 ? 25 :
    savingsRate >= 10 ? 15 :
    savingsRate >= 5  ? 8  : 0;

  // 2. Budget adherence (0-25pts)
  const adherenceScore = (() => {
    if (totalBudget === 0) return 10;
    const adherencePct = Math.max(0, (totalBudget - totalSpent) / totalBudget);
    const overSpendCount = cats.filter((c: any) => c.budget > 0 && c.spent > c.budget).length;
    const base = Math.round(adherencePct * 25);
    return Math.max(0, base - (overSpendCount * 3));
  })();

  // 3. Debt-to-income ratio (0-20pts)
  const debtScore =
    monthlyIncome === 0 ? 10 :
    dti < 15 ? 20 :
    dti < 25 ? 15 :
    dti < 35 ? 8  :
    dti < 50 ? 3  : 0;

  // 4. Cash buffer (0-20pts)
  const bufferMonths = totalSpent > 0 ? cashRemaining / (totalSpent / (now.getDate() || 1)) : 0;
  const bufferScore =
    bufferMonths >= 3 ? 20 :
    bufferMonths >= 1 ? 14 :
    bufferMonths >= 0.5 ? 8 :
    cashRemaining > 0 ? 4 : 0;

  // 5. Goals on track (0-10pts)
  const goalsScore = (() => {
    if (!goals.length) return 5;
    const onTrack = goals.filter((g: any) => (g.riskStatus || "on_track") === "on_track").length;
    return Math.round((onTrack / goals.length) * 10);
  })();

  const rawScore = savingsScore + adherenceScore + debtScore + bufferScore + goalsScore;
  const financialHealthScore = Math.min(100, Math.max(0, rawScore));
  const financialHealthGrade =
    financialHealthScore >= 85 ? "A" :
    financialHealthScore >= 70 ? "B" :
    financialHealthScore >= 55 ? "C" :
    financialHealthScore >= 40 ? "D" : "F";

  return {
    financial: {
      monthlyIncome, totalBudget, totalSpent, cashRemaining,
      savingsRate, totalDebt, debtToIncomeRatio: dti, projectedMonthEnd,
      topOverspendCategories: cats.filter((c: any) => c.spent > c.budget).map((c: any) => c.label),
      financialHealthScore,
      financialHealthGrade,
      upcomingTripObligation: upcomingTrip ? {
        name: upcomingTrip.destination,
        amount: upcomingTrip.budget?.total || 0,
        daysUntil: Math.ceil((new Date(upcomingTrip.departureDate).getTime() - Date.now()) / 86400000),
      } : undefined,
    },
    calendarLoad,
    busyWeeksAhead,
    activeGoals: goals.map((g: any) => ({
      name: g.name,
      riskStatus: (g.riskStatus || "on_track") as "on_track" | "at_risk" | "off_track",
    })),
    householdStressLevel,
    wellness: {
      avgMood: Math.round(avgMood * 10) / 10,
      avgSleep: Math.round(avgSleep * 10) / 10,
      weeklyScore: wellnessScore,
    },
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
