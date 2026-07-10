// ─── HerNest Household Context Graph — Internal Helpers ──────────
// src/core/graph/internals.ts
//
// Shared constants + helper functions used across the graph modules.

import type {
  HouseholdContextGraph, GraphNode, ContextRelationship,
  Person, HouseholdStressContext, Memory, Insight,
  HouseholdModule, StressSource, GoalStatus,
} from "./types";

export const GRAPH_KEY = "household_graph";
export const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export const COMPLIANCE_NOTE =
  "This is educational budgeting guidance, not financial, legal, tax, investment, or lending advice. Consult a qualified professional for complex decisions.";

// ═══════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════

export function now(): string { return new Date().toISOString(); }
export function uuid(): string { return crypto.randomUUID(); }

export function addRelationship(
  graph: HouseholdContextGraph,
  rel: Omit<ContextRelationship, "id" | "detectedAt" | "confirmedCount">
): void {
  const id = `rel_${rel.fromNodeId}_${rel.relationshipType}_${rel.toNodeId}`;
  const existing = graph.relationships.find(r => r.id === id);
  if (existing) {
    existing.confirmedCount += 1;
    existing.lastConfirmed = now();
    existing.strength = Math.min(1, existing.strength + 0.05);
    existing.evidence = [...new Set([...existing.evidence, ...rel.evidence])];
  } else {
    graph.relationships.push({ ...rel, id, detectedAt: now(), confirmedCount: 1 });
  }
  // Keep nodeIndex up to date
  graph.nodeIndex[rel.fromNodeId] = graph.nodeIndex[rel.fromNodeId];
  graph.nodeIndex[rel.toNodeId] = graph.nodeIndex[rel.toNodeId];
}

export function indexNode(graph: HouseholdContextGraph, node: GraphNode): void {
  graph.nodeIndex[node.id] = node;
}

export function baseNode(
  id: string, type: GraphNode["type"],
  sourceModule: HouseholdModule, confidence: number, tags: string[]
): Pick<GraphNode, "id" | "type" | "createdAt" | "updatedAt" | "sourceModule" | "confidence" | "tags"> {
  return { id, type, createdAt: now(), updatedAt: now(), sourceModule, confidence, tags };
}

// ═══════════════════════════════════════════════════════════════════
// PRIVATE UTILITIES
// ═══════════════════════════════════════════════════════════════════

export function buildStressNode(thriveData: any, tasksData: any, calendarData: any): HouseholdStressContext {
  const t = now();
  const moodLogs = (thriveData?.moodLog as any[]) || [];
  const recentMoods = moodLogs.slice(-3).map((l: any) => l.value || 3);
  const avgMood = recentMoods.length ? recentMoods.reduce((a: number, b: number) => a + b, 0) / recentMoods.length : 3;

  const allTasks = (tasksData?.tasks as any[]) || [];
  // Open = not completed. The field is `status` ("pending"|"completed"); the old
  // `!task.done` check was always true (no `done` field), so completed-but-overdue
  // tasks were wrongly counted as backlog.
  const isOpen = (task: any) => (task.status ? task.status !== "completed" : !task.done);
  const taskBacklog = allTasks.filter((task: any) => isOpen(task) && task.dueDate && task.dueDate < new Date().toISOString().split("T")[0]).length;

  const events = (calendarData?.events as any[]) || [];
  const todayStr = new Date().toISOString().split("T")[0];
  const nextWeekStr = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const upcomingCount = events.filter((e: any) => e.date >= todayStr && e.date <= nextWeekStr).length;
  const loadLevel = upcomingCount >= 10 ? "critical" : upcomingCount >= 6 ? "heavy" : upcomingCount >= 3 ? "normal" : "light";

  const sources: StressSource[] = [];
  if (avgMood < 2.5) sources.push({ source: "thrive", signal: `Avg mood ${avgMood.toFixed(1)}/5`, weight: 0.4, detectedAt: t });
  if (loadLevel === "heavy" || loadLevel === "critical") sources.push({ source: "calendar", signal: `${loadLevel} calendar load`, weight: 0.3, detectedAt: t });
  if (taskBacklog > 2) sources.push({ source: "plan", signal: `${taskBacklog} overdue tasks`, weight: 0.2, detectedAt: t });

  const schedulePressure = (loadLevel === "critical" ? "high" : loadLevel === "heavy" ? "moderate" : "low") as "low" | "moderate" | "high";
  const totalWeight = sources.reduce((a, s) => a + s.weight, 0);
  const level = totalWeight >= 0.8 ? "critical" : totalWeight >= 0.5 ? "high" : totalWeight >= 0.25 ? "moderate" : "low";
  const isCapacityProblem = (loadLevel === "heavy" || loadLevel === "critical") && taskBacklog > 2;

  return {
    ...baseNode("stress_current", "stress", "home", 0.75, ["current", level]) as any,
    level,
    stressSources: sources,
    overloadDays: [],
    emotionalSignals: avgMood < 2.5 ? [`Average mood ${avgMood.toFixed(1)}/5 over last 3 logs`] : [],
    schedulePressure,
    financialPressure: "low",
    taskBacklog,
    missedRoutineCount: 0,
    isCapacityProblem,
    capacityInsight: isCapacityProblem ? `${loadLevel} calendar + ${taskBacklog} overdue tasks — this is a load problem` : undefined,
    period: { start: t },
  };
}

export function recalculateStress(stress: HouseholdStressContext): void {
  const total = stress.stressSources.reduce((a, s) => a + s.weight, 0);
  stress.level = total >= 0.8 ? "critical" : total >= 0.5 ? "high" : total >= 0.25 ? "moderate" : "low";
  stress.isCapacityProblem = stress.schedulePressure === "high" && stress.taskBacklog > 2;
}

export function getAgeGroup(age?: number): Person["ageGroup"] {
  if (!age) return "adult";
  if (age < 2) return "infant";
  if (age < 5) return "toddler";
  if (age < 13) return "child";
  if (age < 18) return "teen";
  if (age < 65) return "adult";
  return "senior";
}

export function mapRiskToStatus(riskStatus: string): GoalStatus {
  const map: Record<string, GoalStatus> = {
    on_track: "on_track", at_risk: "at_risk", off_track: "off_track", achieved: "achieved",
  };
  return map[riskStatus] || "in_progress";
}

export function insightToMemoryType(insightType: string): Memory["memoryType"] {
  const map: Record<string, Memory["memoryType"]> = {
    financial: "financial_pattern", schedule: "seasonal_pattern",
    wellness: "stress_pattern", planning: "fact",
    opportunity: "financial_pattern", risk: "warning",
  };
  return map[insightType] || "fact";
}

// HouseholdInsight.category (store) → graph Insight.insightType
export function mapCategoryToInsightType(category?: string): Insight["insightType"] {
  const map: Record<string, Insight["insightType"]> = {
    spending: "financial", savings: "financial", debt: "financial", cashflow: "financial",
    scheduling: "schedule", stress: "wellness", health: "wellness",
    family: "planning", decision: "planning", opportunity: "opportunity",
  };
  return map[category || ""] || "financial";
}
