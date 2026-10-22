// ─── HerNest Decision Engine ──────────────────────────────────────
// Shared scenario planning + Decision Quality reasoning
// Callable from any module — Budget, Calendar, Trips, Family, Cleo
// Updated: full HerNestCFOResponse schema + compliance guardrails

import { aiJSON } from "../ai";
import { s } from "../aiSchema";
import { currencySymbol } from "../../shared/utils/money";
import { runDecisionV2, selectDecisionMode } from "./DecisionEngineV2";
import { saveData, loadData } from "../firebase";
import { saveMemoryFacts } from "../memory";
import type { HouseholdSnapshot } from "../store";

// ── Full response schema per brief ────────────────────────────────
export interface HerNestCFOResponse {
  summary: string;
  riskLevel: "low" | "medium" | "high";
  observation: string;
  whyItMatters: string;
  financialImpact: string;
  tradeoffs: string[];
  options: string[];
  recommendedAction: string;
  nextSteps: string[];
  confidence: "low" | "medium" | "high";
  confidenceLevel: number;
  assumptions: string[];
  suggestedFollowUpQuestions: string[];
  affectedModules: string[];
}

export interface ScenarioRecord {
  id: string;
  question: string;
  result: HerNestCFOResponse;
  createdAt: string;
}

export interface SpendingTrend {
  category: string;
  currentMonthAmount: number;
  previousMonthAmount: number;
  percentageChange: number;
  riskLevel: "low" | "medium" | "high";
  explanation?: string;
}

// ── Compliance disclaimer (defined in ./constants to break a cycle) ──
export { COMPLIANCE_DISCLAIMER } from "./constants";

// ── Context builder ───────────────────────────────────────────────
function buildScenarioContext(snapshot: HouseholdSnapshot, profileName?: string): string {
  const f = snapshot.financial;
  return `
HOUSEHOLD FINANCIAL SNAPSHOT:
- Monthly income: ${currencySymbol()}${Math.round(f.monthlyIncome).toLocaleString()} ${f.monthlyIncome === 0 ? "(not set — reduces confidence)" : ""}
- Total budget: ${currencySymbol()}${f.totalBudget.toLocaleString()}
- Spent this month: ${currencySymbol()}${f.totalSpent.toLocaleString()}
- Cash remaining: ${currencySymbol()}${Math.round(f.cashRemaining).toLocaleString()}
- Savings rate: ${f.savingsRate.toFixed(1)}%
- Total debt: ${currencySymbol()}${f.totalDebt.toLocaleString()}
- Debt-to-income ratio: ${f.debtToIncomeRatio.toFixed(1)}%
- Month-end projection: ${currencySymbol()}${f.projectedMonthEnd.toLocaleString()}
- Financial health: ${f.financialHealthGrade} (${f.financialHealthScore}/100)
- Overspend categories: ${f.topOverspendCategories.join(", ") || "None"}

HOUSEHOLD CONTEXT:
- Calendar load: ${snapshot.calendarLoad.toUpperCase()}
- Busy weeks ahead: ${snapshot.busyWeeksAhead}
- Household stress: ${snapshot.householdStressLevel}
- Active goals: ${snapshot.activeGoals.map(g => `${g.name} (${g.riskStatus})`).join(", ") || "None set"}

USER: ${profileName || "HerNest household"}
`.trim();
}

function confidenceLabel(level: number): "low" | "medium" | "high" {
  if (level >= 70) return "high";
  if (level >= 45) return "medium";
  return "low";
}

// Fixed answer shape for runScenario (structured outputs). Field
// descriptions carry what the prompt used to spell out in a JSON template.
const CFO_SCHEMA = s.object({
  summary: s.string("1-2 sentence plain-English summary"),
  riskLevel: s.enum(["low", "medium", "high"]),
  observation: s.string("what the data shows about this question"),
  whyItMatters: s.string("why this matters to this household specifically"),
  financialImpact: s.string("specific dollar amounts, timeline, cash flow effect"),
  tradeoffs: s.array(s.string("a tradeoff (about 3)")),
  options: s.array(s.string("an option with numbers (about 3)")),
  recommendedAction: s.string("single clear action with specific numbers"),
  nextSteps: s.array(s.string("immediate step, step within the week, step this month")),
  confidence: s.enum(["low", "medium", "high"]),
  confidenceLevel: s.integer("0-100"),
  assumptions: s.array(s.string()),
  suggestedFollowUpQuestions: s.array(s.string("a follow-up question (about 3)")),
  affectedModules: s.array(s.enum(["budget", "calendar", "trips", "family", "thrive"])),
});

// ── Core scenario analysis ────────────────────────────────────────
export async function runScenario(
  question: string,
  snapshot: HouseholdSnapshot,
  profileName?: string
): Promise<HerNestCFOResponse> {
  const context = buildScenarioContext(snapshot, profileName);

  const sys = `You are HerNest CFO, an AI financial intelligence assistant for families.

Your job is to help households understand cash flow, spending behavior, goals, debts, affordability, and major financial decisions.

COMPLIANCE: You are not a bank, lender, investment advisor, tax advisor, or legal advisor. You provide educational budgeting guidance, affordability analysis, scenario planning, and household decision support only.

Decision Quality methodology:
1. Frame the decision clearly
2. Identify what is actually at stake financially
3. Surface real tradeoffs — not just pros/cons
4. Quantify impact with actual numbers
5. Give one clear recommendation
6. Suggest natural follow-up questions

${context}

Rules:
- Use actual numbers from the household data
- If income is not set, note this and reduce confidence
- Consider calendar load alongside finances
- Name tradeoffs explicitly — do not soften risks
- confidenceLevel: 90+ if all data present, 60-70 if partial, below 50 if guessing
- Follow-up questions should feel natural and help the user go deeper
- Never guarantee outcomes or provide investment, legal, or tax advice`;

  const fallback: HerNestCFOResponse = {
    summary: "Unable to analyze — please try again.",
    riskLevel: "medium",
    observation: "Analysis unavailable.",
    whyItMatters: "",
    financialImpact: "Unable to analyze — please try again.",
    tradeoffs: [],
    options: [],
    recommendedAction: "Please retry.",
    nextSteps: [],
    confidence: "low",
    confidenceLevel: 0,
    assumptions: [],
    suggestedFollowUpQuestions: [],
    affectedModules: ["budget"],
  };

  const raw = await aiJSON<HerNestCFOResponse>(
    sys,
    `Analyze this household financial decision: "${question}"`,
    "cleo_chat",
    fallback,
    CFO_SCHEMA
  );

  return { ...raw, confidence: confidenceLabel(raw.confidenceLevel ?? 50) };
}

// ── Save + load scenarios ─────────────────────────────────────────
export async function saveScenario(
  userId: string,
  question: string,
  result: HerNestCFOResponse
): Promise<ScenarioRecord> {
  const record: ScenarioRecord = {
    id: crypto.randomUUID(),
    question,
    result,
    createdAt: new Date().toISOString(),
  };
  try {
    const existing = await loadData(userId, "scenarios");
    const scenarios: ScenarioRecord[] = (existing?.scenarios as ScenarioRecord[]) || [];
    await saveData(userId, "scenarios", { scenarios: [record, ...scenarios].slice(0, 30) });
  } catch (e) {
    console.error("[DecisionEngine] saveScenario failed:", e);
  }
  return record;
}

export async function loadScenarios(userId: string): Promise<ScenarioRecord[]> {
  try {
    const data = await loadData(userId, "scenarios");
    return (data?.scenarios as ScenarioRecord[]) || [];
  } catch { return []; }
}

// ── Main entry point for all modules ─────────────────────────────
export async function analyzeScenario(
  question: string,
  snapshot: HouseholdSnapshot,
  userId: string,
  profileName?: string
): Promise<{ record: ScenarioRecord; result: HerNestCFOResponse }> {
  // Use V2 engine with DQ methodology, fall back to V1 on error
  let result: HerNestCFOResponse;
  try {
    const mode = selectDecisionMode(question);
    const v2 = await runDecisionV2({ question, snapshot, userId, householdState: null, profileName, mode });
    const rec = v2.recommendation;
    result = {
      summary: rec?.summary || question,
      riskLevel: v2.confidence === "high" ? "low" : v2.confidence === "medium" ? "medium" : "high",
      observation: v2.purpose || question,
      whyItMatters: rec?.why?.join(" ") || "",
      financialImpact: v2.uncertainties?.map(u => u.description || "").join("; ") || "",
      tradeoffs: v2.tradeoffs?.map(t => `${t.optionA} vs ${t.optionB}: ${t.tradeoffSummary}`) || [],
      options: v2.options?.map(o => `${o.name}: ${o.description || ""}`) || [],
      recommendedAction: rec?.summary || "Review the analysis above.",
      nextSteps: v2.nextActions?.map(a => a.label) || [],
      confidence: v2.confidence,
      confidenceLevel: v2.confidence === "high" ? 85 : v2.confidence === "medium" ? 60 : 35,
      assumptions: v2.assumptions || [],
      suggestedFollowUpQuestions: [],
      affectedModules: ["budget"],
    };
  } catch {
    result = await runScenario(question, snapshot, profileName);
  }
  const record = await saveScenario(userId, question, result);

  try {
    await saveMemoryFacts(userId, [{
      id: crypto.randomUUID(),
      statement: `Analyzed: "${question}" — Risk: ${result.riskLevel}, Confidence: ${result.confidence}. Action: ${result.recommendedAction.substring(0, 100)}`,
      type: "goal",
      source: "inferred",
      confidence: 0.9,
      createdAt: Date.now(),
    }]);
  } catch (e) { console.warn("[DecisionEngine] scenario failed:", e); }

  return { record, result };
}

// ── Rule-based affordability check (no AI call) ───────────────────
export function quickAffordabilityCheck(
  cost: number,
  snapshot: HouseholdSnapshot
): { affordable: boolean; reason: string; confidence: "low" | "medium" | "high" } {
  const f = snapshot.financial;
  const available = f.cashRemaining;
  const buffer = f.monthlyIncome > 0 ? f.monthlyIncome * 0.1 : available * 0.15;

  if (f.monthlyIncome === 0) return {
    affordable: cost <= available * 0.3,
    reason: `Income not set. ${currencySymbol()}${Math.round(available).toLocaleString()} available this month.`,
    confidence: "low",
  };
  if (cost <= available - buffer) return {
    affordable: true,
    reason: `${currencySymbol()}${Math.round(available - cost).toLocaleString()} would remain — above your safety buffer.`,
    confidence: "high",
  };
  if (cost > available) return {
    affordable: false,
    reason: `Exceeds remaining cash by ${currencySymbol()}${Math.round(cost - available).toLocaleString()}.`,
    confidence: "high",
  };
  return {
    affordable: false,
    reason: `Would leave only ${currencySymbol()}${Math.round(available - cost).toLocaleString()} — below recommended buffer.`,
    confidence: "medium",
  };
}

// ── Build spending trends (current vs previous month) ─────────────
export function buildSpendingTrends(
  currentCats: Array<{ id: string; label: string; spent: number; budget: number }>,
  previousCats?: Array<{ id: string; label: string; spent: number }>
): SpendingTrend[] {
  return currentCats
    .filter(c => c.spent > 0 || (previousCats?.find(p => p.id === c.id)?.spent ?? 0) > 0)
    .map(c => {
      const prev = previousCats?.find(p => p.id === c.id)?.spent ?? 0;
      const pct = prev > 0 ? Math.round(((c.spent - prev) / prev) * 100) : 0;
      return {
        category: c.label,
        currentMonthAmount: c.spent,
        previousMonthAmount: prev,
        percentageChange: pct,
        riskLevel: (c.spent > c.budget ? "high" : pct > 30 ? "medium" : "low") as SpendingTrend["riskLevel"],
        explanation: pct > 20 ? `Up ${pct}% vs last month` : pct < -20 ? `Down ${Math.abs(pct)}% vs last month` : undefined,
      };
    })
    .sort((a, b) => Math.abs(b.percentageChange) - Math.abs(a.percentageChange));
}

export function buildFinancialContextString(snapshot: HouseholdSnapshot | null): string {
  if (!snapshot) return "Financial data not yet loaded.";
  return buildScenarioContext(snapshot);
}
