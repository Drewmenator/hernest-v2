// ─── HerNest Decision Engine v2 ──────────────────────────────────
// Household decision intelligence layer.
// Turns messy family questions into structured options, tradeoffs,
// recommendations, confidence scores, and decision history.
//
// This is NOT a chatbot feature.
// It is a core household decision intelligence system.
//
// Three modes:
//   Quick      — low-stakes, fast recommendation
//   Structured — medium-stakes, full options + tradeoffs
//   Deep       — high-stakes, full DQ framework
//
// Integrates with: Orchestrator, Context Graph, State Engine,
//                  Insight Engine, Memory Service, all modules.

import { aiJSON } from "../ai";
import { saveData, loadData } from "../firebase";
import { saveMemoryFacts } from "../memory";
import type { HouseholdSnapshot } from "../store";
import type { HouseholdStateResult } from "./householdStateEngine";
import { COMPLIANCE_DISCLAIMER } from "./DecisionEngine";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type HouseholdDecisionType =
  | "financial"
  | "schedule"
  | "family_planning"
  | "wellness"
  | "trip"
  | "school"
  | "home"
  | "major_purchase"
  | "debt"
  | "career"
  | "caregiving"
  | "general";

export type DecisionMode = "quick" | "structured" | "deep";

export type DecisionStatus =
  | "draft"
  | "framed"
  | "analyzing"
  | "recommended"
  | "decided"
  | "deferred"
  | "closed";

export interface DecisionOption {
  id: string;
  name: string;
  description: string;
  estimatedCost?: number;
  estimatedTimeImpact?: string;
  stressImpact?: "reduces" | "neutral" | "increases";
  riskLevel?: "low" | "medium" | "high";
  pros: string[];
  cons: string[];
}

export interface DecisionCriterion {
  id: string;
  name: string;
  category:
    | "cost" | "time" | "stress" | "family_value"
    | "financial_health" | "convenience" | "wellness"
    | "long_term_benefit" | "risk";
  importance: "low" | "medium" | "high";
  weight?: number; // 0–1, computed from importance if not set
  description?: string;
}

export interface DecisionConstraint {
  id: string;
  description: string;
  type: "budget" | "time" | "schedule" | "health" | "family" | "deadline" | "other";
  hardConstraint: boolean;
}

export interface DecisionUncertainty {
  id: string;
  description: string;
  impact: "low" | "medium" | "high";
  likelihood?: "low" | "medium" | "high";
  canReduceWithMoreInfo: boolean;
  suggestedInfoNeeded?: string;
}

export interface DecisionTradeoff {
  optionA: string;
  optionB: string;
  tradeoffSummary: string;
  givesUp: string;
  gains: string;
  affectedCriteria: string[];
}

export interface DecisionRecommendation {
  recommendedOptionId: string;
  summary: string;
  why: string[];
  risks: string[];
  watchouts: string[];
  confidence: "low" | "medium" | "high";
  explanation: {
    contextUsed: string[];
    assumptions: string[];
    strongestFactors: string[];
  };
}

export interface DecisionNextAction {
  label: string;
  actionType:
    | "create_task" | "create_goal" | "review_budget"
    | "schedule_conversation" | "collect_info"
    | "defer_decision" | "ask_cleo";
  priority: "low" | "medium" | "high";
  targetModule?: string;
}

export interface DecisionOutcome {
  selectedOptionId: string;
  decidedAt: string;
  resultNotes?: string;
  satisfaction?: "low" | "medium" | "high";
  lessonsLearned?: string[];
}

export interface OptionScore {
  optionId: string;
  scores: { criterionId: string; score: number; reasoning: string }[];
  totalWeightedScore: number;
  strengths: string[];
  weaknesses: string[];
}

export interface HouseholdDecisionV2 {
  id: string;
  householdId: string;
  question: string;
  type: HouseholdDecisionType;
  mode: DecisionMode;
  status: DecisionStatus;
  purpose: string;
  options: DecisionOption[];
  criteria: DecisionCriterion[];
  constraints: DecisionConstraint[];
  uncertainties: DecisionUncertainty[];
  tradeoffs: DecisionTradeoff[];
  scores?: OptionScore[];
  recommendation?: DecisionRecommendation;
  confidence: "low" | "medium" | "high";
  assumptions: string[];
  nextActions: DecisionNextAction[];
  outcome?: DecisionOutcome;
  linkedContext: {
    financialContextIds?: string[];
    calendarEventIds?: string[];
    goalIds?: string[];
    memoryIds?: string[];
    insightIds?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface DecisionTimelineItem {
  id: string;
  decisionId: string;
  title: string;
  type: HouseholdDecisionType;
  status: DecisionStatus;
  selectedOption?: string;
  createdAt: string;
  decidedAt?: string;
}

// ═══════════════════════════════════════════════════════════════════
// CRITERIA LIBRARY
// Reusable criteria per decision domain
// ═══════════════════════════════════════════════════════════════════

export const DECISION_CRITERIA_LIBRARY: Record<string, string[]> = {
  financial:  ["Cash-flow stability", "Debt impact", "Savings impact", "Emergency fund protection", "Affordability"],
  household:  ["Stress reduction", "Family alignment", "Ease of execution", "Time burden", "Partner coordination"],
  child:      ["Child benefit", "Routine stability", "School impact", "Therapy/medical continuity"],
  planning:   ["Timing", "Flexibility", "Preparation effort", "Risk of delay"],
  emotional:  ["Peace of mind", "Mental load reduction", "Confidence", "Joy/family value"],
  risk:       ["Reversibility", "Worst-case impact", "Likelihood of problems", "Recovery time"],
};

// Importance → weight mapping
const IMPORTANCE_WEIGHT: Record<string, number> = {
  high: 0.5, medium: 0.3, low: 0.2
};

// ═══════════════════════════════════════════════════════════════════
// MODE SELECTOR
// Determines decision depth from question complexity signals
// ═══════════════════════════════════════════════════════════════════

const DEEP_SIGNALS   = /\b(move|relocate|quit|leave|change school|stop work|hire|fire|divorce|major surgery|refinance|buy a house|sell)\b/i;
const QUICK_SIGNALS  = /\b(tonight|today|this week|small|quick|minor|cheap|order|buy|skip)\b/i;

export function selectDecisionMode(question: string): DecisionMode {
  if (DEEP_SIGNALS.test(question))  return "deep";
  if (QUICK_SIGNALS.test(question)) return "quick";
  return "structured";
}

// ═══════════════════════════════════════════════════════════════════
// CONFIDENCE CALCULATOR
// ═══════════════════════════════════════════════════════════════════

function calculateConfidence(params: {
  hasIncome: boolean;
  hasGoals: boolean;
  hasDates: boolean;
  uncertaintyCount: number;
  optionCount: number;
}): "low" | "medium" | "high" {
  let score = 0;
  if (params.hasIncome)      score += 30;
  if (params.hasGoals)       score += 20;
  if (params.hasDates)       score += 20;
  if (params.optionCount >= 2) score += 20;
  score -= params.uncertaintyCount * 10;
  score = Math.max(0, Math.min(100, score));
  if (score >= 65) return "high";
  if (score >= 35) return "medium";
  return "low";
}

// ═══════════════════════════════════════════════════════════════════
// OPTION SCORER
// Simple weighted score — no Monte Carlo in v1
// ═══════════════════════════════════════════════════════════════════

export function scoreOptions(
  options: DecisionOption[],
  criteria: DecisionCriterion[]
): OptionScore[] {
  return options.map(option => {
    const scores: OptionScore["scores"] = criteria.map(criterion => {
      // Heuristic scoring based on option fields
      let score = 3; // neutral default

      if (criterion.category === "cost") {
        if (option.estimatedCost !== undefined) {
          // Lower cost = higher score
          const maxCost = Math.max(...options.map(o => o.estimatedCost ?? 0));
          score = maxCost > 0 ? Math.round(5 - (option.estimatedCost / maxCost) * 4) : 3;
        }
      } else if (criterion.category === "stress") {
        const stressMap = { reduces: 5, neutral: 3, increases: 1 };
        score = stressMap[option.stressImpact ?? "neutral"];
      } else if (criterion.category === "risk") {
        const riskMap = { low: 5, medium: 3, high: 1 };
        score = riskMap[option.riskLevel ?? "medium"];
      } else {
        // Fallback: count pros vs cons
        const prosScore = Math.min(5, option.pros.length + 2);
        const consScore = Math.max(1, 4 - option.cons.length);
        score = Math.round((prosScore + consScore) / 2);
      }

      const weight = criterion.weight ?? IMPORTANCE_WEIGHT[criterion.importance] ?? 0.3;
      return {
        criterionId: criterion.id,
        score,
        reasoning: `Based on ${criterion.category} analysis`,
      };
    });

    const totalWeightedScore = criteria.reduce((sum, criterion, i) => {
      const weight = criterion.weight ?? IMPORTANCE_WEIGHT[criterion.importance] ?? 0.3;
      return sum + (scores[i]?.score ?? 3) * weight;
    }, 0);

    return {
      optionId: option.id,
      scores,
      totalWeightedScore: Math.round(totalWeightedScore * 10) / 10,
      strengths: option.pros.slice(0, 2),
      weaknesses: option.cons.slice(0, 2),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// CONTEXT BUILDER
// Assembles relevant household context for the AI prompt
// ═══════════════════════════════════════════════════════════════════

function buildDecisionContext(
  snapshot: HouseholdSnapshot | null,
  householdState: HouseholdStateResult | null,
  profileName?: string
): string {
  const lines: string[] = [];
  lines.push(`HOUSEHOLD: ${profileName || "HerNest household"}`);

  if (snapshot) {
    const f = snapshot.financial;
    lines.push(`FINANCES:`);
    lines.push(`- Income: $${Math.round(f.monthlyIncome).toLocaleString()}/mo ${f.monthlyIncome === 0 ? "(not set)" : ""}`);
    lines.push(`- Cash remaining: $${Math.round(f.cashRemaining).toLocaleString()}`);
    lines.push(`- Savings rate: ${f.savingsRate.toFixed(1)}%`);
    lines.push(`- Total debt: $${f.totalDebt.toLocaleString()}`);
    lines.push(`- Financial health: ${f.financialHealthGrade}`);
    if (snapshot.activeGoals.length) {
      lines.push(`GOALS: ${snapshot.activeGoals.map(g => `${g.name} (${g.riskStatus})`).join(", ")}`);
    }
    lines.push(`CALENDAR: ${snapshot.calendarLoad} load, ${snapshot.busyWeeksAhead} busy weeks ahead`);
  }

  if (householdState) {
    lines.push(`HOUSEHOLD STATE: ${householdState.primary.state.replace("_", " ")} (${householdState.primary.confidence}% confidence)`);
    lines.push(`KEY SIGNALS: ${householdState.primary.topSignals.join(", ")}`);
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// SYSTEM PROMPTS PER MODE
// ═══════════════════════════════════════════════════════════════════

const BASE_DECISION_PROMPT = `You are Cleo, HerNest's household decision intelligence system.
Your role is to help families think clearly before making decisions — not to decide for them.

You use Decision Quality methodology: purpose, options, criteria, tradeoffs, uncertainty, recommendation, confidence.

${COMPLIANCE_DISCLAIMER}

Rules:
- Never guarantee outcomes
- State all assumptions clearly  
- Do not invent financial data
- Be calm and practical — never alarmist
- Connect financial, schedule, goal, and stress context when relevant
- Always surface the lowest-stress option as one of the options
- Confidence should reflect data completeness`;

const QUICK_PROMPT = `${BASE_DECISION_PROMPT}

MODE: Quick Decision — keep it concise. 2–3 options max, top tradeoff, one clear recommendation.`;

const STRUCTURED_PROMPT = `${BASE_DECISION_PROMPT}

MODE: Structured Decision — full options, criteria, tradeoffs, recommendation with reasoning.`;

const DEEP_PROMPT = `${BASE_DECISION_PROMPT}

MODE: Deep Decision — comprehensive DQ framework. Full options, all criteria, uncertainties, scenario comparison, recommendation with full explanation. This is a high-stakes decision.`;

// ═══════════════════════════════════════════════════════════════════
// MAIN ENGINE FUNCTION
// ═══════════════════════════════════════════════════════════════════

export async function runDecisionV2(params: {
  userId: string;
  question: string;
  snapshot: HouseholdSnapshot | null;
  householdState: HouseholdStateResult | null;
  profileName?: string;
  mode?: DecisionMode;
}): Promise<HouseholdDecisionV2> {
  const { userId, question, snapshot, householdState, profileName } = params;
  const mode = params.mode ?? selectDecisionMode(question);

  const context = buildDecisionContext(snapshot, householdState, profileName);

  const promptMap: Record<DecisionMode, string> = {
    quick: QUICK_PROMPT,
    structured: STRUCTURED_PROMPT,
    deep: DEEP_PROMPT,
  };

  const optionCountMap: Record<DecisionMode, number> = {
    quick: 2, structured: 3, deep: 4
  };

  const sys = `${promptMap[mode]}

${context}

Return ONLY valid JSON matching this exact structure:
{
  "type": "financial|schedule|family_planning|wellness|trip|school|home|major_purchase|debt|career|caregiving|general",
  "purpose": "one sentence — what this decision is really about",
  "options": [
    {
      "id": "opt_1",
      "name": "Option name",
      "description": "brief description",
      "estimatedCost": 0,
      "stressImpact": "reduces|neutral|increases",
      "riskLevel": "low|medium|high",
      "pros": ["pro 1", "pro 2"],
      "cons": ["con 1", "con 2"]
    }
  ],
  "criteria": [
    {
      "id": "crit_1",
      "name": "criterion name",
      "category": "cost|time|stress|family_value|financial_health|convenience|wellness|long_term_benefit|risk",
      "importance": "low|medium|high"
    }
  ],
  "constraints": [
    {
      "id": "con_1",
      "description": "constraint description",
      "type": "budget|time|schedule|health|family|deadline|other",
      "hardConstraint": true
    }
  ],
  "uncertainties": [
    {
      "id": "unc_1",
      "description": "what is uncertain",
      "impact": "low|medium|high",
      "canReduceWithMoreInfo": true,
      "suggestedInfoNeeded": "what info would help"
    }
  ],
  "tradeoffs": [
    {
      "optionA": "option name",
      "optionB": "option name",
      "tradeoffSummary": "summary",
      "givesUp": "what you give up",
      "gains": "what you gain",
      "affectedCriteria": ["criterion name"]
    }
  ],
  "recommendation": {
    "recommendedOptionId": "opt_1",
    "summary": "clear recommendation",
    "why": ["reason 1", "reason 2"],
    "risks": ["risk 1"],
    "watchouts": ["watchout 1"],
    "confidence": "low|medium|high",
    "explanation": {
      "contextUsed": ["what data was used"],
      "assumptions": ["assumption 1"],
      "strongestFactors": ["factor 1"]
    }
  },
  "assumptions": ["assumption 1"],
  "nextActions": [
    {
      "label": "action label",
      "actionType": "create_task|create_goal|review_budget|schedule_conversation|collect_info|defer_decision|ask_cleo",
      "priority": "low|medium|high",
      "targetModule": "finances|calendar|tasks|trips|wellness"
    }
  ]
}

Generate ${optionCountMap[mode]} options. Include at least one low-stress option.`;

  const fallback: Partial<HouseholdDecisionV2> = {
    type: "general",
    purpose: "Unable to frame decision — please try again.",
    options: [],
    criteria: [],
    constraints: [],
    uncertainties: [],
    tradeoffs: [],
    assumptions: ["AI analysis unavailable"],
    nextActions: [{ label: "Ask Cleo", actionType: "ask_cleo", priority: "medium" }],
  };

  const result = await aiJSON<Partial<HouseholdDecisionV2>>(
    sys,
    `Frame this household decision: "${question}"`,
    "household_cfo",
    fallback
  );

  // Score options if we have enough data
  const scores = (result.options?.length && result.criteria?.length)
    ? scoreOptions(result.options, result.criteria)
    : undefined;

  // Calculate confidence
  const confidence = calculateConfidence({
    hasIncome:       (snapshot?.financial.monthlyIncome ?? 0) > 0,
    hasGoals:        (snapshot?.activeGoals.length ?? 0) > 0,
    hasDates:        question.toLowerCase().includes("august") ||
                     question.toLowerCase().includes("next") ||
                     question.toLowerCase().includes("by "),
    uncertaintyCount: result.uncertainties?.length ?? 0,
    optionCount:      result.options?.length ?? 0,
  });

  const decision: HouseholdDecisionV2 = {
    id: crypto.randomUUID(),
    householdId: userId,
    question,
    type: result.type ?? "general",
    mode,
    status: "recommended",
    purpose: result.purpose ?? "",
    options: result.options ?? [],
    criteria: result.criteria ?? [],
    constraints: result.constraints ?? [],
    uncertainties: result.uncertainties ?? [],
    tradeoffs: result.tradeoffs ?? [],
    scores,
    recommendation: result.recommendation,
    confidence,
    assumptions: result.assumptions ?? [],
    nextActions: result.nextActions ?? [],
    linkedContext: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Override AI confidence with computed confidence if lower
  if (decision.recommendation) {
    const confidenceRank = { low: 0, medium: 1, high: 2 };
    const aiRank = confidenceRank[decision.recommendation.confidence];
    const computedRank = confidenceRank[confidence];
    if (computedRank < aiRank) {
      decision.recommendation.confidence = confidence;
    }
  }

  return decision;
}

// ═══════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════

export async function saveDecisionV2(userId: string, decision: HouseholdDecisionV2): Promise<void> {
  try {
    const existing = await loadDecisionsV2(userId);
    const updated = [decision, ...existing.filter(d => d.id !== decision.id)].slice(0, 50);
    await saveData(userId, "decisions_v2", {
      decisions: updated,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[DecisionV2] save failed:", e);
  }
}

export async function loadDecisionsV2(userId: string): Promise<HouseholdDecisionV2[]> {
  try {
    const data = await loadData(userId, "decisions_v2");
    return (data?.decisions as HouseholdDecisionV2[]) || [];
  } catch {
    return [];
  }
}

export async function updateDecisionOutcome(
  userId: string,
  decisionId: string,
  outcome: DecisionOutcome
): Promise<void> {
  const decisions = await loadDecisionsV2(userId);
  const updated = decisions.map(d =>
    d.id === decisionId
      ? { ...d, outcome, status: "decided" as DecisionStatus, updatedAt: new Date().toISOString() }
      : d
  );
  await saveData(userId, "decisions_v2", { decisions: updated, updatedAt: new Date().toISOString() });
}

// ═══════════════════════════════════════════════════════════════════
// TIMELINE
// ═══════════════════════════════════════════════════════════════════

export function buildDecisionTimeline(decisions: HouseholdDecisionV2[]): DecisionTimelineItem[] {
  return decisions
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(d => ({
      id: crypto.randomUUID(),
      decisionId: d.id,
      title: d.question,
      type: d.type,
      status: d.status,
      selectedOption: d.outcome?.selectedOptionId
        ? d.options.find(o => o.id === d.outcome?.selectedOptionId)?.name
        : d.recommendation
          ? d.options.find(o => o.id === d.recommendation?.recommendedOptionId)?.name
          : undefined,
      createdAt: d.createdAt,
      decidedAt: d.outcome?.decidedAt,
    }));
}

// ═══════════════════════════════════════════════════════════════════
// MEMORY WRITEBACK
// Saves durable decision preferences to memory
// ═══════════════════════════════════════════════════════════════════

export async function writeDecisionToMemory(
  userId: string,
  decision: HouseholdDecisionV2
): Promise<void> {
  if (!decision.recommendation) return;

  const selectedOption = decision.options.find(
    o => o.id === decision.recommendation?.recommendedOptionId
  );
  if (!selectedOption) return;

  const facts = [
    {
      id: crypto.randomUUID(),
      statement: `For "${decision.question}", household preferred: ${selectedOption.name}. ${decision.recommendation.summary}`,
      type: "preference" as const,
      source: "inferred" as const,
      confidence: 0.75,
      createdAt: Date.now(),
    },
    ...(decision.assumptions.length
      ? [{
          id: crypto.randomUUID(),
          statement: `Decision assumptions: ${decision.assumptions.slice(0, 2).join("; ")}`,
          type: "preference" as const,
          source: "inferred" as const,
          confidence: 0.6,
          createdAt: Date.now(),
        }]
      : []),
  ];

  try {
    await saveMemoryFacts(userId, facts);
  } catch (e) {
    console.warn("[DecisionV2] Memory writeback failed (non-fatal):", e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXPLAIN
// Human-readable explanation of why a recommendation was made
// ═══════════════════════════════════════════════════════════════════

export function explainDecision(decision: HouseholdDecisionV2): string {
  if (!decision.recommendation) return "No recommendation available.";

  const rec = decision.recommendation;
  const option = decision.options.find(o => o.id === rec.recommendedOptionId);
  const lines: string[] = [];

  lines.push(`Cleo recommended "${option?.name ?? rec.recommendedOptionId}" because:`);
  rec.why.forEach(w => lines.push(`• ${w}`));

  if (rec.risks.length) {
    lines.push(`\nKey risks to watch:`);
    rec.risks.forEach(r => lines.push(`• ${r}`));
  }

  if (rec.explanation.assumptions.length) {
    lines.push(`\nThis assumed: ${rec.explanation.assumptions.join(", ")}.`);
  }

  lines.push(`\nConfidence: ${rec.confidence} — ${rec.explanation.contextUsed.join(", ")}.`);

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// RELEVANT PAST DECISIONS
// Finds past decisions similar to current question
// ═══════════════════════════════════════════════════════════════════

export async function getRelevantPastDecisions(
  userId: string,
  question: string,
  limit = 3
): Promise<HouseholdDecisionV2[]> {
  const all = await loadDecisionsV2(userId);
  const words = question.toLowerCase().split(/\s+/).filter(w => w.length > 4);

  return all
    .filter(d => words.some(w => d.question.toLowerCase().includes(w)))
    .slice(0, limit);
}
