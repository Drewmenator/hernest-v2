// ─── HerNest Household Context Graph — Event Handling ─────────────
// src/core/graph/graphEvents.ts
//
// updateGraphFromModuleEvent(): incremental updates — no full rebuild
// needed on each event.

import { now, addRelationship, indexNode, baseNode, recalculateStress } from "./internals";
import { scheduleGraphSave } from "./persistence";
import type { HouseholdContextGraph, ModuleEvent, Goal, CalendarContext } from "./types";

// ═══════════════════════════════════════════════════════════════════
// 2. updateGraphFromModuleEvent()
// Incremental updates — no full rebuild needed on each event.
// ═══════════════════════════════════════════════════════════════════

export async function updateGraphFromModuleEvent(
  userId: string,
  event: ModuleEvent,
  graph: HouseholdContextGraph
): Promise<HouseholdContextGraph> {
  const t = now();

  switch (event.type) {

    case "budget.expense.logged": {
      const { amount, category } = event.payload as any;
      const summary = graph.finances.find(f => f.id === "fin_monthly_summary");
      if (summary) {
        summary.totalSpent = (summary.totalSpent || 0) + amount;
        summary.cashRemaining = (summary.monthlyIncome || 0) - (summary.totalSpent || 0);
        summary.updatedAt = t;
        indexNode(graph, summary);
      }
      // Strengthen calendar→financial edge on heavy weeks
      const calLoad = graph.calendar.find(c => c.id === "cal_load_current");
      if (calLoad?.loadLevel === "heavy" || calLoad?.loadLevel === "critical") {
        const rel = graph.relationships.find(r =>
          r.fromNodeId === "cal_load_current" && r.toNodeId === "fin_monthly_summary"
        );
        if (rel) {
          rel.confirmedCount += 1;
          rel.strength = Math.min(1, rel.strength + 0.05);
          rel.evidence.push(`$${amount} logged in ${category} during ${calLoad.loadLevel} week`);
          rel.lastConfirmed = t;
        }
      }
      break;
    }

    case "budget.savings.goal.created": {
      const g = event.payload as any;
      const goalNode: Goal = {
        ...baseNode(`goal_${g.id}`, "goal", "budget", 0.9, ["financial", g.type || "other"]) as any,
        title: g.name,
        category: g.type || "finance",
        priority: "medium",
        status: "in_progress",
        targetAmount: g.targetAmount,
        currentAmount: g.currentAmount || 0,
        targetDate: g.targetDate,
        monthlyContribution: g.monthlyContribution || 0,
        linkedEventIds: [],
        linkedTaskIds: [],
        linkedFinancialNodeIds: ["fin_monthly_summary"],
        riskStatus: "on_track",
      };
      graph.goals.push(goalNode);
      indexNode(graph, goalNode);
      addRelationship(graph, {
        fromNodeId: "fin_monthly_summary",
        toNodeId: `goal_${g.id}`,
        relationshipType: "supports",
        strength: 0.65,
        evidence: [`New goal created: ${g.name}`],
        description: `Household cash flow supports "${g.name}"`,
        sourceModule: "budget",
        isInferred: false,
      });
      break;
    }

    case "thrive.mood.logged": {
      const { value } = event.payload as any;
      if (value < 3) {
        const existing = graph.stress.stressSources.find(s => s.source === "thrive");
        if (existing) {
          existing.signal = `Mood logged at ${value}/5`;
          existing.detectedAt = t;
        } else {
          graph.stress.stressSources.push({
            source: "thrive",
            signal: `Mood logged at ${value}/5`,
            weight: 0.35,
            detectedAt: t,
          });
        }
        recalculateStress(graph.stress);
        graph.stress.updatedAt = t;
        indexNode(graph, graph.stress);
      }
      break;
    }

    case "trips.trip.created": {
      const t2 = event.payload as any;
      const tripCal: CalendarContext = {
        ...baseNode(`cal_trip_${t2.id}`, "calendar", "trips", 0.95, ["trip", t2.destination]) as any,
        subtype: "travel_block",
        title: `Trip: ${t2.destination}`,
        date: t2.departureDate,
        estimatedCost: t2.budget?.total,
        requiresBudgetAdjustment: true,
      };
      graph.calendar.push(tripCal);
      indexNode(graph, tripCal);
      if (t2.budget?.total) {
        addRelationship(graph, {
          fromNodeId: `cal_trip_${t2.id}`,
          toNodeId: "fin_monthly_summary",
          relationshipType: "impacts",
          strength: 0.8,
          evidence: [`New trip: ${t2.destination}`, `Budget: $${t2.budget.total}`],
          description: `New trip to ${t2.destination} requires ~$${t2.budget.total}`,
          sourceModule: "trips",
          isInferred: false,
        });
        // If any goals at risk, add conflicts_with relationship
        graph.goals.filter(g => g.riskStatus === "at_risk" || g.riskStatus === "off_track").forEach(g => {
          addRelationship(graph, {
            fromNodeId: `cal_trip_${t2.id}`,
            toNodeId: g.id,
            relationshipType: "conflicts_with",
            strength: 0.75,
            evidence: [`Trip cost $${t2.budget.total}`, `Goal "${g.title}" is ${g.riskStatus}`],
            description: `Trip to ${t2.destination} may delay "${g.title}" goal`,
            sourceModule: "trips",
            isInferred: true,
          });
        });
      }
      break;
    }

    case "plan.task.created": {
      const task = event.payload as any;
      if (task.dueDate && task.dueDate < new Date().toISOString().split("T")[0]) {
        graph.stress.taskBacklog = (graph.stress.taskBacklog || 0) + 1;
        const existing = graph.stress.stressSources.find(s => s.source === "plan");
        if (existing) {
          existing.weight = Math.min(0.4, existing.weight + 0.05);
          existing.signal = `${graph.stress.taskBacklog} overdue tasks`;
        } else {
          graph.stress.stressSources.push({ source: "plan", signal: "Overdue task added", weight: 0.15, detectedAt: now() });
        }
        recalculateStress(graph.stress);
        graph.stress.updatedAt = t;
      }
      break;
    }
  }

  graph.lastUpdated = t;
  scheduleGraphSave(userId, graph);
  return graph;
}
