// ─── HerNest Household Context Graph — Explainability & Memory ────
// src/core/graph/explainability.ts
//
// saveMemoryFromInsight() + explainWhyRecommendationWasMade().

import { aiJSON } from "../ai";
import { saveMemoryFacts } from "../memory";
import {
  COMPLIANCE_NOTE, now, uuid, addRelationship, indexNode, baseNode, insightToMemoryType,
} from "./internals";
import { saveGraphToFirestore } from "./persistence";
import type { HouseholdContextGraph, RecommendationExplanation, Memory, Insight } from "./types";

// ═══════════════════════════════════════════════════════════════════
// 7. saveMemoryFromInsight()
// ═══════════════════════════════════════════════════════════════════

export async function saveMemoryFromInsight(
  userId: string,
  insight: Insight,
  graph: HouseholdContextGraph
): Promise<void> {
  const t = now();
  const memNode: Memory = {
    ...baseNode(`mem_insight_${insight.id}`, "memory", "home", insight.confidenceLevel / 100, ["insight_derived", insight.insightType]) as any,
    memoryType: insightToMemoryType(insight.insightType),
    content: `${insight.observation}. Recommendation: ${insight.recommendation}`,
    confidenceScore: insight.confidenceLevel / 100,
    reinforcedCount: 1,
    lastConfirmedAt: t,
    linkedEntityIds: insight.relatedNodeIds,
  };

  graph.memories.push(memNode);
  indexNode(graph, memNode);
  insight.savedToMemory = true;

  addRelationship(graph, {
    fromNodeId: insight.id,
    toNodeId: memNode.id,
    relationshipType: "causes",
    strength: 0.8,
    evidence: [`Insight converted to memory`],
    description: `Insight generated memory: "${insight.observation.substring(0, 60)}..."`,
    sourceModule: "home",
    isInferred: false,
  });

  // Write to cleo_memory for backward compatibility
  try {
    await saveMemoryFacts(userId, [{
      id: uuid(),
      statement: memNode.content,
      type: "goal",
      source: "inferred",
      confidence: memNode.confidenceScore,
      createdAt: Date.now(),
    }]);
  } catch (e) { console.warn("[Graph] operation failed:", e); }

  await saveGraphToFirestore(userId, graph);
}

// ═══════════════════════════════════════════════════════════════════
// 8. explainWhyRecommendationWasMade()
// ═══════════════════════════════════════════════════════════════════

export async function explainWhyRecommendationWasMade(
  recommendation: string,
  graph: HouseholdContextGraph,
  userId: string
): Promise<RecommendationExplanation> {
  const summary = graph.finances.find(f => f.id === "fin_monthly_summary");
  const calLoad = graph.calendar.find(c => c.id === "cal_load_current");

  const reasoning: string[] = [];
  if (summary) reasoning.push(`Household has $${Math.round(summary.cashRemaining || 0).toLocaleString()} remaining (${(summary.savingsRate || 0).toFixed(0)}% savings rate)`);
  if (graph.stress.level !== "low") reasoning.push(`Household stress is ${graph.stress.level}${graph.stress.isCapacityProblem ? " — this is a capacity problem" : ""}: ${graph.stress.stressSources.map(s => s.signal).join(", ")}`);
  if (calLoad && calLoad.loadLevel !== "light") reasoning.push(`Calendar is ${calLoad.loadLevel} with ${calLoad.eventsThisWeek} events`);
  graph.goals.filter(g => g.riskStatus !== "on_track").forEach(g => reasoning.push(`Goal "${g.title}" is ${g.riskStatus}`));

  const strongRelationships = graph.relationships
    .filter(r => r.strength > 0.6)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5);

  const dataPoints: RecommendationExplanation["dataPoints"] = strongRelationships.map(r => {
    const node = graph.nodeIndex[r.fromNodeId];
    return {
      nodeId: r.fromNodeId,
      nodeType: node?.type || "financial",
      contribution: r.evidence[0] || r.description,
    };
  });

  const sys = `You are HerNest's explainability engine. Given a recommendation and supporting evidence, write 3-5 short bullet points explaining WHY this recommendation was made. Be specific with numbers. Return JSON: {"steps": ["step 1", "step 2", ...]}`;
  const prompt = `Recommendation: "${recommendation}"\nEvidence:\n${reasoning.join("\n")}\n${strongRelationships.slice(0, 3).map(r => `- ${r.description}`).join("\n")}`;

  const result = await aiJSON<{ steps: string[] }>(sys, prompt, "budget_coach", { steps: reasoning });

  return {
    recommendation,
    reasoning: result.steps || reasoning,
    dataPoints,
    relationships: strongRelationships.slice(0, 4).map(r => ({
      from: graph.nodeIndex[r.fromNodeId]?.type || r.fromNodeId,
      to: graph.nodeIndex[r.toNodeId]?.type || r.toNodeId,
      type: r.relationshipType,
      description: r.description,
    })),
    confidence: strongRelationships.length > 2 ? 0.8 : 0.6,
    assumptions: [
      summary?.monthlyIncome === 0 ? "Income not set — estimates based on budget only" : "Income data provided",
      "Based on manually entered household data",
    ],
    limitations: ["Analysis based on available data only", COMPLIANCE_NOTE],
  };
}
