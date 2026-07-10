// ─── HerNest Household Context Graph — Pattern Detection ──────────
// src/core/graph/patternDetection.ts
//
// getRelevantContextForAI() + detectCrossModulePatterns().

import { now } from "./internals";
import type { HouseholdContextGraph, DetectedPattern, HouseholdModule } from "./types";

// ═══════════════════════════════════════════════════════════════════
// 3. getRelevantContextForAI()
// Returns ranked plain-text context strings for a given question.
// ═══════════════════════════════════════════════════════════════════

export function getRelevantContextForAI(
  question: string,
  module: HouseholdModule,
  graph: HouseholdContextGraph,
  maxItems = 12
): string[] {
  const q = question.toLowerCase();
  const items: Array<{ text: string; relevance: number }> = [];

  // Always include financial summary
  const summary = graph.finances.find(f => f.id === "fin_monthly_summary");
  if (summary) {
    items.push({
      text: `Finance: $${Math.round(summary.cashRemaining || 0).toLocaleString()} remaining · ${(summary.savingsRate || 0).toFixed(0)}% savings · Grade ${summary.grade}`,
      relevance: 0.95,
    });
  }

  // Always include stress
  if (graph.stress.level !== "low") {
    items.push({
      text: `${graph.stress.isCapacityProblem ? "Capacity problem" : "Household stress"}: ${graph.stress.level} — ${graph.stress.stressSources.map(s => s.signal).join(", ")}`,
      relevance: 0.85,
    });
  }

  // Calendar if relevant
  if (/trip|travel|vacation|afford|busy|schedule|calendar|week/.test(q)) {
    const cal = graph.calendar.find(c => c.id === "cal_load_current");
    if (cal) items.push({ text: `Calendar: ${cal.loadLevel} load · ${cal.eventsThisWeek} events this week`, relevance: 0.8 });
  }

  // Goals
  if (/goal|saving|afford|fund|payoff|debt|school|trip/.test(q)) {
    graph.goals.forEach(g => {
      items.push({
        text: `Goal "${g.title}" (${g.category}): ${g.riskStatus} · $${g.currentAmount?.toLocaleString() || 0} of $${g.targetAmount?.toLocaleString() || 0}`,
        relevance: g.riskStatus !== "on_track" ? 0.9 : 0.65,
      });
    });
  }

  // Debts
  if (/debt|loan|pay off|credit|apr|interest/.test(q)) {
    graph.finances.filter(f => f.subtype === "debt").forEach(d => {
      items.push({ text: `Debt "${d.label}": $${d.balance?.toLocaleString()} @ ${d.apr}% APR`, relevance: 0.85 });
    });
  }

  // Memories — always useful
  graph.memories
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, 5)
    .forEach(m => items.push({ text: `Memory: ${m.content}`, relevance: m.confidenceScore * 0.7 }));

  // Active relationships (cross-module patterns)
  graph.relationships
    .filter(r => r.strength > 0.6)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4)
    .forEach(r => items.push({ text: `Pattern: ${r.description}`, relevance: r.strength * 0.8 }));

  // Active insights
  graph.insights
    .filter(i => !i.dismissed)
    .slice(0, 2)
    .forEach(i => items.push({ text: `Insight: ${i.observation} → ${i.recommendation}`, relevance: i.confidenceLevel / 100 * 0.75 }));

  return items
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxItems)
    .map(i => i.text);
}

// ═══════════════════════════════════════════════════════════════════
// 4. detectCrossModulePatterns()
// ═══════════════════════════════════════════════════════════════════

export async function detectCrossModulePatterns(
  graph: HouseholdContextGraph,
  userId: string
): Promise<DetectedPattern[]> {
  const patterns: DetectedPattern[] = [];
  const calLoad = graph.calendar.find(c => c.id === "cal_load_current");
  const summary = graph.finances.find(f => f.id === "fin_monthly_summary");
  const atRiskGoals = graph.goals.filter(g => g.riskStatus === "at_risk" || g.riskStatus === "off_track");

  // Pattern 1: Heavy calendar → spending increase
  if (calLoad && summary && (calLoad.loadLevel === "heavy" || calLoad.loadLevel === "critical")) {
    const spendPct = (summary.totalSpent || 0) / Math.max(summary.totalBudget || 1, 1);
    if (spendPct > 0.75) {
      patterns.push({
        id: "cross_calendar_spending",
        description: `${calLoad.loadLevel} calendar load coincides with ${Math.round(spendPct * 100)}% budget usage`,
        fromNodeType: "calendar",
        toNodeType: "financial",
        relationshipType: "causes",
        strength: 0.72,
        evidenceCount: 1,
        evidence: [`${calLoad.eventsThisWeek} events`, `${Math.round(spendPct * 100)}% budget used`],
        suggestedRelationship: {
          fromNodeId: "cal_load_current",
          toNodeId: "fin_monthly_summary",
          relationshipType: "causes",
          strength: 0.72,
          evidence: [`Heavy calendar + high spend detected`],
          description: "Heavy calendar load is causing elevated spending",
          sourceModule: "calendar",
          isInferred: true,
        },
        actionable: true,
        suggestedInsight: {
          type: "insight",
          insightType: "financial",
          severity: "watch",
          observation: `Calendar load is ${calLoad.loadLevel} and spending is at ${Math.round(spendPct * 100)}% of budget`,
          whyItMatters: "Busy weeks historically increase food delivery and convenience spending",
          options: ["Pre-plan meals this Sunday", "Set a weekly discretionary limit", "Review dining budget"],
          recommendation: "Pre-plan meals before the heavy week to reduce convenience spending",
          nextSteps: ["Block 1 hour Sunday for meal prep", "Set $50 dining limit for the week"],
          followUpQuestions: ["Would you like help planning meals for the week?", "Should I flag when spending spikes during busy weeks?"],
          confidenceLevel: 72,
          confidenceLabel: "medium",
          relatedNodeIds: ["cal_load_current", "fin_monthly_summary"],
          sourceModules: ["calendar", "budget"],
          crossModulePattern: true,
        },
      });
    }
  }

  // Pattern 2: Goal at risk + upcoming trip
  const tripNodes = graph.calendar.filter(c => c.subtype === "travel_block");
  if (atRiskGoals.length > 0 && tripNodes.length > 0) {
    atRiskGoals.forEach(goal => {
      tripNodes.forEach(trip => {
        patterns.push({
          id: `cross_trip_goal_${goal.id}`,
          description: `Upcoming trip "${trip.title}" conflicts with at-risk goal "${goal.title}"`,
          fromNodeType: "calendar",
          toNodeType: "goal",
          relationshipType: "conflicts_with",
          strength: 0.8,
          evidenceCount: 1,
          evidence: [`Goal "${goal.title}" is ${goal.riskStatus}`, `Trip cost: ~$${trip.estimatedCost || "?"}`],
          suggestedRelationship: {
            fromNodeId: trip.id,
            toNodeId: goal.id,
            relationshipType: "conflicts_with",
            strength: 0.8,
            evidence: [`Trip may delay goal`],
            description: `Trip may delay "${goal.title}" goal`,
            sourceModule: "trips",
            isInferred: true,
          },
          actionable: true,
        });
      });
    });
  }

  // Pattern 3: Stress → dining/delivery overspend
  if (graph.stress.level === "high" || graph.stress.level === "critical") {
    const diningNode = graph.finances.find(f =>
      f.subtype === "expense" && (f.category || "").toLowerCase().includes("dining")
    );
    if (diningNode && diningNode.trendRiskLevel !== "low") {
      patterns.push({
        id: "cross_stress_dining",
        description: `${graph.stress.level} stress appears to be driving elevated dining spend`,
        fromNodeType: "stress",
        toNodeType: "financial",
        relationshipType: "contributes_to",
        strength: 0.65,
        evidenceCount: 1,
        evidence: [`Stress: ${graph.stress.level}`, `Dining risk: ${diningNode.trendRiskLevel}`],
        suggestedRelationship: {
          fromNodeId: graph.stress.id,
          toNodeId: diningNode.id,
          relationshipType: "contributes_to",
          strength: 0.65,
          evidence: ["Stress + dining overspend correlated"],
          description: "Household stress contributing to comfort spending on dining",
          sourceModule: "thrive",
          isInferred: true,
        },
        actionable: true,
        suggestedInsight: {
          type: "insight",
          insightType: "wellness",
          severity: "watch",
          observation: "Dining and delivery spending is elevated during a high-stress period",
          whyItMatters: "This looks less like overspending and more like a capacity problem — the household needs support, not more willpower",
          options: ["Pre-plan meals to reduce decision fatigue", "Batch cook on a lighter day", "Set a weekly delivery budget and stick to it"],
          recommendation: "Address the capacity problem first — reduce calendar load or add support before cutting spending",
          nextSteps: ["Identify which days are creating the most pressure", "Consider delegating one recurring task"],
          followUpQuestions: ["What's creating the most pressure this week?", "Would it help to look at your schedule together?"],
          confidenceLevel: 65,
          confidenceLabel: "medium",
          relatedNodeIds: [graph.stress.id, diningNode.id],
          sourceModules: ["thrive", "budget"],
          crossModulePattern: true,
        },
      });
    }
  }

  // Pattern 4: Debt payments → goal capacity conflict
  const debtNodes = graph.finances.filter(f => f.subtype === "debt" && (f.minimumPayment || 0) > 150);
  if (debtNodes.length > 0 && atRiskGoals.length > 0) {
    const totalMin = debtNodes.reduce((a, d) => a + (d.minimumPayment || 0), 0);
    patterns.push({
      id: "cross_debt_goals",
      description: `$${totalMin}/mo in debt minimums is reducing capacity for ${atRiskGoals.length} at-risk goal(s)`,
      fromNodeType: "financial",
      toNodeType: "goal",
      relationshipType: "conflicts_with",
      strength: 0.78,
      evidenceCount: debtNodes.length,
      evidence: [`Total minimums: $${totalMin}/mo`, `${atRiskGoals.length} goals at risk`],
      suggestedRelationship: {
        fromNodeId: debtNodes[0].id,
        toNodeId: atRiskGoals[0].id,
        relationshipType: "conflicts_with",
        strength: 0.78,
        evidence: [`$${totalMin}/mo in debt payments`],
        description: `Debt payments reducing capacity for "${atRiskGoals[0].title}"`,
        sourceModule: "budget",
        isInferred: false,
      },
      actionable: true,
    });
  }

  // Pattern 5: Missed routines → household load
  const routinesWithMisses = graph.tasks.filter(r => (r.missedCount || 0) > 2);
  if (routinesWithMisses.length > 0) {
    patterns.push({
      id: "cross_routine_stress",
      description: `${routinesWithMisses.length} routine(s) with ${routinesWithMisses.reduce((a, r) => a + (r.missedCount || 0), 0)} total misses — contributing to household load`,
      fromNodeType: "routine",
      toNodeType: "stress",
      relationshipType: "contributes_to",
      strength: 0.55,
      evidenceCount: routinesWithMisses.length,
      evidence: routinesWithMisses.map(r => `"${r.name}" missed ${r.missedCount}x`),
      suggestedRelationship: {
        fromNodeId: routinesWithMisses[0].id,
        toNodeId: graph.stress.id,
        relationshipType: "contributes_to",
        strength: 0.55,
        evidence: ["Missed routines correlate with stress signals"],
        description: "Missed routines contributing to household stress",
        sourceModule: "thrive",
        isInferred: true,
      },
      actionable: false,
    });
  }

  // Persist actionable patterns as relationships
  patterns.filter(p => p.actionable).forEach(p => {
    const exists = graph.relationships.find(r => r.id === `rel_${p.id}`);
    if (!exists) {
      graph.relationships.push({
        id: `rel_${p.id}`,
        ...p.suggestedRelationship,
        detectedAt: now(),
        confirmedCount: 1,
      });
    } else {
      exists.confirmedCount += 1;
      exists.lastConfirmed = now();
      exists.strength = Math.min(1, exists.strength + 0.05);
    }
  });

  return patterns;
}
