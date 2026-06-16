// ─── HerNest Household Context Graph — Service ───────────────────
// src/core/graph/GraphService.ts
//
// All 8 graph operations matching the HerNest Context Graph brief.

import { aiJSON } from "../ai";
import { loadData, saveData } from "../firebase";
import { saveMemoryFacts } from "../memory";
import type {
  HouseholdContextGraph, GraphNode, ContextRelationship,
  ModuleEvent, DetectedPattern, RecommendationExplanation,
  CleoContextPack, CFOContextPack,
  Person, FinancialContext, CalendarContext, RoutineContext,
  Goal, HouseholdStressContext, HouseholdDecision, Memory, Insight,
  RelationshipType, NodeType, HouseholdModule, StressSource,
  GoalStatus,
} from "./types";

const GRAPH_KEY = "household_graph";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export const COMPLIANCE_NOTE =
  "This is educational budgeting guidance, not financial, legal, tax, investment, or lending advice. Consult a qualified professional for complex decisions.";

// ═══════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════

function now(): string { return new Date().toISOString(); }
function uuid(): string { return crypto.randomUUID(); }

function addRelationship(
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

function indexNode(graph: HouseholdContextGraph, node: GraphNode): void {
  graph.nodeIndex[node.id] = node;
}

function baseNode(
  id: string, type: GraphNode["type"],
  sourceModule: HouseholdModule, confidence: number, tags: string[]
): Pick<GraphNode, "id" | "type" | "createdAt" | "updatedAt" | "sourceModule" | "confidence" | "tags"> {
  return { id, type, createdAt: now(), updatedAt: now(), sourceModule, confidence, tags };
}

// ═══════════════════════════════════════════════════════════════════
// 1. createContextGraph()
// Builds a fresh graph from all Firestore module data.
// ═══════════════════════════════════════════════════════════════════

export async function createContextGraph(userId: string): Promise<HouseholdContextGraph> {
  const [profileData, budgetData, calendarData, tasksData, thriveData, tripsData,
         schoolData, circleData, memoryV2Data, insightsData] =
    await Promise.all([
      loadData(userId, "profile"),
      loadData(userId, "budget_v2"),
      loadData(userId, "calendar"),
      loadData(userId, "tasks"),
      loadData(userId, "thrive"),
      loadData(userId, "trips"),
      loadData(userId, "school"),
      loadData(userId, "circle"),
      loadData(userId, "cleo_memory_v2"),
      loadData(userId, "household_insights"),
    ]);

  const graph: HouseholdContextGraph = {
    householdId: userId,
    version: 1,
    lastUpdated: now(),
    people: [],
    finances: [],
    calendar: [],
    tasks: [],
    goals: [],
    stress: buildStressNode(thriveData, tasksData, calendarData),
    decisions: [],
    memories: [],
    insights: [],
    relationships: [],
    nodeIndex: {},
    primaryUserId: `person_${userId}`,
  };

  // ── People ────────────────────────────────────────────────────
  const primaryUser: Person = {
    ...baseNode(`person_${userId}`, "person", "family", 1, ["primary"]) as any,
    name: (profileData?.name as string) || "User",
    role: "primary",
    ageGroup: "adult",
    isUser: true,
    preferences: {
      energyPattern: (profileData?.energyPattern as any) || "morning",
      diet: (profileData?.diet as string) || undefined,
    },
    responsibilities: [],
    routines: [],
    relatedGoalIds: [],
    stressTriggers: [],
  };
  graph.people.push(primaryUser);
  indexNode(graph, primaryUser);

  const kids = (profileData?.kids as any[]) || [];
  kids.forEach((k: any) => {
    const child: Person = {
      ...baseNode(`person_child_${k.id || k.name}`, "person", "family", 1, ["child"]) as any,
      name: k.name,
      role: "child",
      ageGroup: getAgeGroup(k.age),
      isUser: false,
      preferences: {},
      responsibilities: [],
      routines: [],
      relatedGoalIds: [],
      stressTriggers: [],
      schoolInfo: k.school ? { schoolName: k.school, grade: k.grade } : undefined,
    };
    graph.people.push(child);
    indexNode(graph, child);
  });

  // ── Finances ──────────────────────────────────────────────────
  const cats = (budgetData?.categories as any[]) || [];
  const incomes = (budgetData?.incomes as any[]) || [];
  const debts = (budgetData?.debts as any[]) || [];
  const budgetGoals = (budgetData?.goals as any[]) || [];

  const monthlyIncome = incomes.reduce((a: number, inc: any) => {
    const m: Record<string, number> = { monthly: 1, biweekly: 26/12, weekly: 52/12, annual: 1/12 };
    return a + (inc.amount || 0) * (m[inc.frequency] || 1);
  }, 0);
  const totalSpent = cats.reduce((a: number, c: any) => a + (c.spent || 0), 0);
  const totalBudget = cats.reduce((a: number, c: any) => a + (c.budget || 0), 0);
  const totalDebt = debts.reduce((a: number, d: any) => a + (d.balance || 0), 0);
  const totalMin = debts.reduce((a: number, d: any) => a + (d.minimumPayment || 0), 0);
  const fixedExpenses = cats
    .filter((c: any) => ["bills", "subscriptions", "childcare"].includes(c.id))
    .reduce((a: number, c: any) => a + (c.spent || 0), 0);
  const cashRemaining = monthlyIncome > 0 ? monthlyIncome - totalSpent : totalBudget - totalSpent;
  const savingsRate = monthlyIncome > 0 ? Math.max(0, ((monthlyIncome - totalSpent) / monthlyIncome) * 100) : 0;
  const d = new Date();
  const daysElapsed = d.getDate();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const projectedMonthEnd = daysElapsed > 0 ? Math.round((totalSpent / daysElapsed) * daysInMonth) : 0;
  const healthScore = (budgetData?.healthScore as any) || null;

  // Monthly summary node
  const summaryNode: FinancialContext = {
    ...baseNode("fin_monthly_summary", "financial", "budget", monthlyIncome > 0 ? 0.9 : 0.6, ["summary", "monthly"]) as any,
    subtype: "monthly_summary",
    monthlyIncome, fixedExpenses,
    variableExpenses: totalSpent - fixedExpenses,
    totalBudget, totalSpent, cashRemaining, savingsRate,
    projectedMonthEnd, totalDebt,
    debtToIncomeRatio: monthlyIncome > 0 ? (totalMin / monthlyIncome) * 100 : 0,
    score: healthScore?.score || 0,
    grade: healthScore?.grade || "—",
  };
  graph.finances.push(summaryNode);
  indexNode(graph, summaryNode);

  // Category nodes for overspend/near-limit
  cats.filter((c: any) => c.spent > 0 && (c.spent / Math.max(c.budget, 1)) > 0.7).forEach((c: any) => {
    const pct = c.budget > 0 ? (c.spent / c.budget) : 0;
    const catNode: FinancialContext = {
      ...baseNode(`fin_cat_${c.id}`, "financial", "budget", 0.95, ["category", c.id, pct > 1 ? "overspend" : "near-limit"]) as any,
      subtype: "expense",
      label: c.label,
      category: c.label,
      amount: c.spent,
      totalBudget: c.budget,
      trendRiskLevel: pct > 1 ? "high" : pct > 0.85 ? "medium" : "low",
    };
    graph.finances.push(catNode);
    indexNode(graph, catNode);
  });

  // Debt nodes
  debts.forEach((d: any) => {
    const debtNode: FinancialContext = {
      ...baseNode(`fin_debt_${d.id}`, "financial", "budget", 0.95, ["debt", d.type || "other"]) as any,
      subtype: "debt",
      label: d.label,
      balance: d.balance,
      apr: d.apr,
      minimumPayment: d.minimumPayment,
    };
    graph.finances.push(debtNode);
    indexNode(graph, debtNode);
  });

  // Goals from budget
  budgetGoals.forEach((g: any) => {
    const goalNode: Goal = {
      ...baseNode(`goal_${g.id}`, "goal", "budget", 0.9, ["financial", g.type || "other"]) as any,
      title: g.name,
      category: g.type || "finance",
      priority: g.priority || "medium",
      status: mapRiskToStatus(g.riskStatus),
      targetAmount: g.targetAmount,
      currentAmount: g.currentAmount,
      targetDate: g.targetDate,
      monthlyContribution: g.monthlyContribution || 0,
      requiredMonthlyContribution: g.requiredMonthlyContribution,
      linkedEventIds: [],
      linkedTaskIds: [],
      linkedFinancialNodeIds: ["fin_monthly_summary"],
      riskStatus: g.riskStatus || "on_track",
    };
    graph.goals.push(goalNode);
    indexNode(graph, goalNode);

    // Relationship: summary → goal
    addRelationship(graph, {
      fromNodeId: "fin_monthly_summary",
      toNodeId: `goal_${g.id}`,
      relationshipType: cashRemaining > 0 ? "supports" : "conflicts_with",
      strength: 0.7,
      evidence: [`Cash remaining: $${Math.round(cashRemaining).toLocaleString()}`],
      description: cashRemaining > 0
        ? `Cash flow supports "${g.name}"`
        : `Cash flow conflicts with "${g.name}"`,
      sourceModule: "budget",
      isInferred: false,
    });
  });

  // ── Calendar ──────────────────────────────────────────────────
  const calEvents = (calendarData?.events as any[]) || [];
  const todayStr = new Date().toISOString().split("T")[0];
  const nextWeekStr = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const upcoming = calEvents.filter((e: any) => e.date >= todayStr && e.date <= nextWeekStr);
  const loadLevel = upcoming.length >= 10 ? "critical" : upcoming.length >= 6 ? "heavy" : upcoming.length >= 3 ? "normal" : "light";

  const calLoadNode: CalendarContext = {
    ...baseNode("cal_load_current", "calendar", "calendar", 0.85, ["load", loadLevel]) as any,
    subtype: "load_assessment",
    loadLevel,
    busyWeeksAhead: Math.min(3, Math.floor(upcoming.length / 3)),
    eventsThisWeek: upcoming.length,
    highLoadDays: upcoming.filter((_: any, i: number) => i < 3).map((e: any) => e.date),
  };
  graph.calendar.push(calLoadNode);
  indexNode(graph, calLoadNode);

  if (loadLevel === "heavy" || loadLevel === "critical") {
    addRelationship(graph, {
      fromNodeId: "cal_load_current",
      toNodeId: "fin_monthly_summary",
      relationshipType: "impacts",
      strength: 0.65,
      evidence: [`${upcoming.length} events this week`, `Load: ${loadLevel}`],
      description: `${loadLevel} calendar load historically increases discretionary spending`,
      sourceModule: "calendar",
      isInferred: true,
    });
  }

  // Trip calendar blocks
  const trips = (tripsData?.trips as any[]) || [];
  trips.filter((t: any) => t.departureDate > todayStr).slice(0, 3).forEach((t: any) => {
    const daysUntil = Math.ceil((new Date(t.departureDate).getTime() - Date.now()) / 86400000);
    const tripCalNode: CalendarContext = {
      ...baseNode(`cal_trip_${t.id}`, "calendar", "trips", 0.95, ["trip", t.destination]) as any,
      subtype: "travel_block",
      title: `Trip: ${t.destination}`,
      date: t.departureDate,
      endDate: t.returnDate,
      estimatedCost: t.budget?.total,
      requiresBudgetAdjustment: daysUntil <= 60,
    };
    graph.calendar.push(tripCalNode);
    indexNode(graph, tripCalNode);

    if (t.budget?.total) {
      addRelationship(graph, {
        fromNodeId: `cal_trip_${t.id}`,
        toNodeId: "fin_monthly_summary",
        relationshipType: "impacts",
        strength: daysUntil <= 30 ? 0.9 : 0.65,
        evidence: [`Trip cost: ~$${t.budget.total}`, `${daysUntil} days away`],
        description: `${t.destination} trip (~$${t.budget.total}) impacts household finances`,
        sourceModule: "trips",
        isInferred: false,
      });
    }
  });

  // ── School events (calendar nodes) ────────────────────────────
  const schoolEvents = (schoolData?.events as any[]) || [];
  schoolEvents
    .filter((e: any) => e.date >= todayStr)
    .slice(0, 12)
    .forEach((e: any) => {
      const schoolNode: CalendarContext = {
        ...baseNode(`cal_school_${e.id || e.date + e.title}`, "calendar", "calendar", 0.9, ["school", e.child || ""]) as any,
        subtype: "school_event",
        title: e.title,
        date: e.date,
        forPersonId: e.child ? `person_child_${e.child}` : undefined,
        requiresParentAction: !!e.requiresAction,
        actionType: e.actionType,
        actionDeadline: e.actionDeadline || e.date,
      };
      graph.calendar.push(schoolNode);
      indexNode(graph, schoolNode);
    });

  // ── Individual upcoming calendar events / appointments ────────
  upcoming
    .filter((e: any) => e.type !== "trip")
    .slice(0, 12)
    .forEach((e: any, i: number) => {
      const evNode: CalendarContext = {
        ...baseNode(`cal_event_${e.id || e.date + "_" + i}`, "calendar", "calendar", 0.85, ["event"]) as any,
        subtype: e.type === "appointment" ? "appointment" : "event",
        title: e.title,
        date: e.date,
        time: e.time,
        location: e.location,
      };
      graph.calendar.push(evNode);
      indexNode(graph, evNode);
    });

  // ── Circle: upcoming birthdays (as appointments) ──────────────
  const contacts = (circleData?.contacts as any[]) || [];
  const yr = new Date().getFullYear();
  [...contacts, ...kids, ...((profileData?.parents as any[]) || [])]
    .filter((p: any) => p?.birthday)
    .map((p: any) => {
      const [mm, dd] = String(p.birthday).split("-").map(Number);
      let next = new Date(yr, (mm || 1) - 1, dd || 1);
      if (next < new Date()) next = new Date(yr + 1, (mm || 1) - 1, dd || 1);
      return { name: p.name as string, days: Math.ceil((next.getTime() - Date.now()) / 86400000), date: next.toISOString().split("T")[0] };
    })
    .filter((b) => b.days >= 0 && b.days <= 21)
    .slice(0, 6)
    .forEach((b) => {
      const bdayNode: CalendarContext = {
        ...baseNode(`cal_bday_${b.name}`, "calendar", "circle", 0.9, ["birthday"]) as any,
        subtype: "appointment",
        title: `${b.name}'s birthday`,
        date: b.date,
      };
      graph.calendar.push(bdayNode);
      indexNode(graph, bdayNode);
    });

  // ── Index stress node ─────────────────────────────────────────
  indexNode(graph, graph.stress);

  if (graph.stress.level !== "low") {
    addRelationship(graph, {
      fromNodeId: graph.stress.id,
      toNodeId: "fin_monthly_summary",
      relationshipType: "contributes_to",
      strength: 0.6,
      evidence: graph.stress.stressSources.map(s => s.signal),
      description: `${graph.stress.level} household stress contributing to discretionary spending`,
      sourceModule: "home",
      isInferred: true,
    });
  }

  // ── Memories (V2 governance store — V1 migrated into V2 in Step 4) ──
  const v2Memories = (memoryV2Data?.memories as any[]) || [];
  const confToScore: Record<string, number> = { low: 0.4, medium: 0.7, high: 0.9 };
  v2Memories
    .filter((m: any) => m.status === "active")
    .slice(0, 20)
    .forEach((m: any) => {
      const v2Node: Memory = {
        ...baseNode(`mem_v2_${m.id}`, "memory", "cleo", confToScore[m.confidence] ?? 0.7, [m.type, "cleo_memory_v2"]) as any,
        visibility: m.sensitivity === "high" ? "private" : "household",
        memoryType: (m.type as any) || "fact",
        content: m.content,
        confidenceScore: confToScore[m.confidence] ?? 0.7,
        reinforcedCount: (m.evidence?.length as number) || 1,
        lastConfirmedAt: m.lastConfirmedAt,
        linkedEntityIds: (m.linkedEntities || []).map((e: any) => e.entityId).filter(Boolean),
      };
      graph.memories.push(v2Node);
      indexNode(graph, v2Node);
    });

  // ── Insights (from HouseholdIntelligence's saved output) ──────
  const savedInsights = (insightsData?.insights as any[]) || [];
  savedInsights
    .filter((i: any) => !i.dismissed)
    .slice(0, 6)
    .forEach((i: any) => {
      const insightNode: Insight = {
        ...baseNode(`insight_${i.id}`, "insight", (i.sourceModules?.[0] as HouseholdModule) || "home", (i.confidenceLevel || 70) / 100, ["generated", i.category || "opportunity"]) as any,
        insightType: mapCategoryToInsightType(i.category),
        severity: (i.confidenceLevel || 0) >= 80 ? "alert" : "watch",
        observation: i.observation,
        whyItMatters: i.whyItMatters || "",
        options: i.options || [],
        recommendation: i.recommendation || "",
        nextSteps: [],
        followUpQuestions: [],
        confidenceLevel: i.confidenceLevel || 70,
        confidenceLabel: (i.confidenceLevel || 0) >= 75 ? "high" : (i.confidenceLevel || 0) >= 50 ? "medium" : "low",
        relatedNodeIds: [],
        sourceModules: (i.sourceModules as HouseholdModule[]) || [],
        crossModulePattern: (i.sourceModules?.length || 0) > 1,
        dismissed: false,
        actedOn: false,
        savedToMemory: false,
      };
      graph.insights.push(insightNode);
      indexNode(graph, insightNode);
    });

  graph.lastUpdated = now();
  await saveGraphToFirestore(userId, graph);
  return graph;
}

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

// ═══════════════════════════════════════════════════════════════════
// 5. generateContextPackForCleo()
// ═══════════════════════════════════════════════════════════════════

export function generateContextPackForCleo(graph: HouseholdContextGraph, viewerUid?: string): CleoContextPack {
  const summary = graph.finances.find(f => f.id === "fin_monthly_summary");
  const calLoad = graph.calendar.find(c => c.id === "cal_load_current");
  const primaryUser = graph.people.find(p => p.isUser);
  const family = graph.people.filter(p => !p.isUser);
  const tripNodes = graph.calendar.filter(c => c.subtype === "travel_block" && c.date && c.date > new Date().toISOString().split("T")[0]);
  const crossModulePatterns = graph.relationships
    .filter(r => r.strength > 0.6 && r.isInferred)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4)
    .map(r => r.description);

  const upcomingObligations = graph.finances
    .filter(f => f.subtype === "upcoming_obligation")
    .flatMap(f => (f.upcomingObligations || []).map(o => ({
      description: o.description,
      estimatedCost: o.estimatedCost,
      date: o.date,
    })));

  const missedRoutines = graph.tasks
    .filter(r => (r.missedCount || 0) > 0)
    .map(r => r.name);

  const activeBottlenecks = graph.tasks
    .flatMap(r => r.bottlenecks)
    .filter(Boolean);

  return {
    householdProfile: {
      primaryUser: primaryUser?.name || "User",
      familyMembers: family.map(p => ({ name: p.name, role: p.role, age: p.ageGroup, routines: p.routines })),
      stage: family.some(p => p.role === "child") ? "family_with_children" : "couple_or_individual",
      stressTriggers: primaryUser?.stressTriggers || [],
    },
    financialSummary: {
      monthlyIncome: summary?.monthlyIncome || 0,
      cashRemaining: summary?.cashRemaining || 0,
      savingsRate: summary?.savingsRate || 0,
      totalDebt: summary?.totalDebt || 0,
      healthGrade: summary?.grade || "—",
      topOverspendCategories: graph.finances
        .filter(f => f.subtype === "expense" && f.trendRiskLevel === "high")
        .map(f => f.category || ""),
      upcomingObligations: upcomingObligations.slice(0, 3),
    },
    calendarSummary: {
      loadLevel: calLoad?.loadLevel || "normal",
      busyWeeksAhead: calLoad?.busyWeeksAhead || 0,
      upcomingEvents: tripNodes.slice(0, 2).map(t => t.title || ""),
      highLoadDays: calLoad?.highLoadDays || [],
      appointmentsThisWeek: graph.calendar
        .filter(c => (c.subtype === "appointment" || c.subtype === "school_event") && c.date && c.date >= new Date().toISOString().split("T")[0])
        .map(c => `${c.title} (${c.date})`),
    },
    activeGoals: graph.goals.map(g => ({
      title: g.title,
      category: g.category,
      riskStatus: g.riskStatus,
      daysToDeadline: g.targetDate ? Math.ceil((new Date(g.targetDate).getTime() - Date.now()) / 86400000) : undefined,
      linkedEvents: g.linkedEventIds.map(id => graph.nodeIndex[id]?.id || id),
    })),
    stressContext: {
      level: graph.stress.level,
      isCapacityProblem: graph.stress.isCapacityProblem,
      capacityInsight: graph.stress.capacityInsight,
      activeSignals: graph.stress.stressSources.map(s => s.signal),
      schedulePressure: graph.stress.schedulePressure,
      financialPressure: graph.stress.financialPressure,
      taskBacklog: graph.stress.taskBacklog,
    },
    routineHealth: { missedRoutines, activeBottlenecks },
    recentDecisions: graph.decisions.slice(0, 3).map(d => ({
      question: d.question,
      recommendation: d.recommendation,
      outcome: d.outcome,
    })),
    relevantMemories: graph.memories
      // Step 5 consent: private memories surface only to the household owner.
      .filter(m => m.visibility !== "private" || viewerUid === graph.householdId)
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, 8)
      .map(m => m.content),
    activeInsights: graph.insights
      .filter(i => !i.dismissed)
      .slice(0, 3)
      .map(i => ({ observation: i.observation, recommendation: i.recommendation, severity: i.severity })),
    crossModulePatterns,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 6. generateContextPackForCFO()
// ═══════════════════════════════════════════════════════════════════

export function generateContextPackForCFO(graph: HouseholdContextGraph): CFOContextPack {
  const summary = graph.finances.find(f => f.id === "fin_monthly_summary");
  const calLoad = graph.calendar.find(c => c.id === "cal_load_current");
  const debtNodes = graph.finances.filter(f => f.subtype === "debt");
  const tripNodes = graph.calendar.filter(c => c.subtype === "travel_block" && c.estimatedCost);

  const upcomingObligations = [
    ...tripNodes.map(t => ({
      description: t.title || "Trip",
      estimatedCost: t.estimatedCost || 0,
      date: t.date || "",
      category: "travel",
      linkedNodeId: t.id,
    })),
    ...(summary?.upcomingObligations || []).map(o => ({
      description: o.description,
      estimatedCost: o.estimatedCost,
      date: o.date,
      category: o.category || "other",
      linkedNodeId: o.linkedNodeId,
    })),
  ];

  const spendingPatterns = graph.finances
    .filter(f => f.subtype === "expense" && f.percentageChange !== undefined)
    .map(f => ({
      category: f.category || "",
      pattern: f.spendingPatterns?.[0]?.pattern || "",
      currentAmount: f.amount || 0,
      previousAmount: f.previousMonthAmount || 0,
      percentageChange: f.percentageChange || 0,
      riskLevel: f.trendRiskLevel || "low",
      triggerContext: graph.relationships
        .find(r => r.toNodeId === f.id && r.isInferred)?.description,
    }));

  return {
    financialSnapshot: {
      monthlyIncome: summary?.monthlyIncome || 0,
      fixedExpenses: summary?.fixedExpenses || 0,
      variableExpenses: summary?.variableExpenses || 0,
      totalBudget: summary?.totalBudget || 0,
      totalSpent: summary?.totalSpent || 0,
      cashRemaining: summary?.cashRemaining || 0,
      savingsRate: summary?.savingsRate || 0,
      totalDebt: summary?.totalDebt || 0,
      debtToIncomeRatio: summary?.debtToIncomeRatio || 0,
      projectedMonthEnd: summary?.projectedMonthEnd || 0,
      healthScore: summary?.score || 0,
      healthGrade: summary?.grade || "—",
    },
    spendingPatterns,
    subscriptions: (summary?.subscriptions || []),
    goals: graph.goals.map(g => ({
      title: g.title,
      category: g.category,
      targetAmount: g.targetAmount,
      currentAmount: g.currentAmount,
      monthlyContribution: g.monthlyContribution,
      requiredMonthlyContribution: g.requiredMonthlyContribution,
      riskStatus: g.riskStatus,
      daysToDeadline: g.targetDate ? Math.ceil((new Date(g.targetDate).getTime() - Date.now()) / 86400000) : undefined,
      linkedEvents: g.linkedEventIds,
    })),
    debts: debtNodes.map(d => ({
      label: d.label || "Debt",
      balance: d.balance || 0,
      apr: d.apr || 0,
      minimumPayment: d.minimumPayment || 0,
      payoffDate: d.payoffDate,
    })),
    upcomingObligations: upcomingObligations.slice(0, 5),
    calendarPressure: {
      loadLevel: calLoad?.loadLevel || "normal",
      financialRisk: calLoad?.loadLevel === "heavy" || calLoad?.loadLevel === "critical"
        ? `${calLoad.loadLevel} load historically increases discretionary spending`
        : "Calendar load is manageable",
      highLoadDays: calLoad?.highLoadDays || [],
    },
    stressPressure: {
      level: graph.stress.level,
      isCapacityProblem: graph.stress.isCapacityProblem,
      financialPressure: graph.stress.financialPressure,
    },
    recentDecisions: graph.decisions.slice(0, 5).map(d => ({ question: d.question, outcome: d.outcome })),
    crossModuleRisks: graph.relationships
      .filter(r => r.relationshipType === "conflicts_with" || (r.relationshipType === "impacts" && r.strength > 0.7))
      .map(r => r.description),
    complianceNote: COMPLIANCE_NOTE,
  };
}

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
  } catch {}

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

// ═══════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════

// Debounced cloud save — coalesces rapid event updates into one write
// (the in-memory graph in the hook stays current; only persistence is deferred).
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingSave: { userId: string; graph: HouseholdContextGraph } | null = null;

function scheduleGraphSave(userId: string, graph: HouseholdContextGraph, delayMs = 4000): void {
  _pendingSave = { userId, graph };
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const p = _pendingSave;
    _saveTimer = null;
    _pendingSave = null;
    if (p) saveGraphToFirestore(p.userId, p.graph).catch(() => {});
  }, delayMs);
}

// nodeIndex duplicates every node in the doc; rebuild it on load instead of storing it.
function rebuildNodeIndex(graph: HouseholdContextGraph): Record<string, GraphNode> {
  const idx: Record<string, GraphNode> = {};
  const all: GraphNode[] = [
    ...graph.people, ...graph.finances, ...graph.calendar, ...graph.tasks,
    ...graph.goals, ...graph.decisions, ...graph.memories, ...graph.insights,
  ];
  all.forEach(n => { if (n?.id) idx[n.id] = n; });
  if (graph.stress?.id) idx[graph.stress.id] = graph.stress;
  return idx;
}

export async function saveGraphToFirestore(userId: string, graph: HouseholdContextGraph): Promise<void> {
  try {
    // Strip nodeIndex before persisting — it's rebuilt on load.
    const persisted: Partial<HouseholdContextGraph> = { ...graph };
    delete persisted.nodeIndex;
    await saveData(userId, GRAPH_KEY, JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>);
  } catch (e) {
    console.error("[Graph] save failed:", e);
  }
}

export async function loadGraphFromFirestore(userId: string): Promise<HouseholdContextGraph | null> {
  try {
    const data = await loadData(userId, GRAPH_KEY);
    if (!data) return null;
    const graph = data as unknown as HouseholdContextGraph;
    const isStale = (Date.now() - new Date(graph.lastUpdated).getTime()) > CACHE_TTL_MS;
    if (isStale) return null;
    graph.nodeIndex = rebuildNodeIndex(graph);
    return graph;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT FORMATTERS
// ═══════════════════════════════════════════════════════════════════

export function formatCleoContextPackForPrompt(pack: CleoContextPack): string {
  const lines = [
    `HOUSEHOLD: ${pack.householdProfile.primaryUser}${pack.householdProfile.familyMembers.length ? `, ${pack.householdProfile.familyMembers.map(m => `${m.name} (${m.role})`).join(", ")}` : ""}`,
    pack.householdProfile.stressTriggers.length ? `STRESS TRIGGERS: ${pack.householdProfile.stressTriggers.join(", ")}` : null,
    `FINANCES: $${Math.round(pack.financialSummary.cashRemaining).toLocaleString()} remaining · ${pack.financialSummary.savingsRate.toFixed(0)}% savings · Grade ${pack.financialSummary.healthGrade}`,
    pack.financialSummary.topOverspendCategories.length ? `OVERSPEND: ${pack.financialSummary.topOverspendCategories.join(", ")}` : null,
    pack.financialSummary.upcomingObligations.length ? `UPCOMING COSTS: ${pack.financialSummary.upcomingObligations.map(o => `${o.description} $${o.estimatedCost}`).join(", ")}` : null,
    `CALENDAR: ${pack.calendarSummary.loadLevel} load · ${pack.calendarSummary.busyWeeksAhead} busy week(s) ahead`,
    pack.calendarSummary.appointmentsThisWeek.length ? `APPOINTMENTS: ${pack.calendarSummary.appointmentsThisWeek.join(", ")}` : null,
    `STRESS: ${pack.stressContext.level}${pack.stressContext.isCapacityProblem ? " (CAPACITY PROBLEM — not a willpower issue)" : ""}`,
    pack.stressContext.activeSignals.length ? `STRESS SIGNALS: ${pack.stressContext.activeSignals.join("; ")}` : null,
    pack.stressContext.taskBacklog > 0 ? `TASK BACKLOG: ${pack.stressContext.taskBacklog} overdue` : null,
    pack.routineHealth.missedRoutines.length ? `MISSED ROUTINES: ${pack.routineHealth.missedRoutines.join(", ")}` : null,
    pack.activeGoals.length ? `GOALS: ${pack.activeGoals.map(g => `${g.title} (${g.riskStatus})`).join(", ")}` : null,
    pack.recentDecisions.length ? `RECENT DECISIONS: ${pack.recentDecisions.map(d => d.question).join("; ")}` : null,
    pack.crossModulePatterns.length ? `PATTERNS: ${pack.crossModulePatterns.join(" | ")}` : null,
    pack.relevantMemories.length ? `MEMORY: ${pack.relevantMemories.join(". ")}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

export function formatCFOContextPackForPrompt(pack: CFOContextPack): string {
  const f = pack.financialSnapshot;
  const lines = [
    `FINANCIAL SNAPSHOT:`,
    `- Income: $${Math.round(f.monthlyIncome).toLocaleString()}/mo · Fixed: $${f.fixedExpenses.toLocaleString()} · Variable: $${f.variableExpenses.toLocaleString()}`,
    `- Spent: $${f.totalSpent.toLocaleString()} / $${f.totalBudget.toLocaleString()} · Remaining: $${Math.round(f.cashRemaining).toLocaleString()}`,
    `- Savings: ${f.savingsRate.toFixed(1)}% · Debt: $${f.totalDebt.toLocaleString()} · DTI: ${f.debtToIncomeRatio.toFixed(1)}% · Health: ${f.healthGrade}`,
    `- Projection: $${f.projectedMonthEnd.toLocaleString()} month-end`,
    pack.spendingPatterns.filter(p => Math.abs(p.percentageChange) > 15).length ? `SPENDING TRENDS: ${pack.spendingPatterns.filter(p => Math.abs(p.percentageChange) > 15).map(p => `${p.category} ${p.percentageChange > 0 ? "+" : ""}${p.percentageChange}%${p.triggerContext ? ` (${p.triggerContext})` : ""}`).join(", ")}` : null,
    pack.goals.length ? `GOALS: ${pack.goals.map(g => `${g.title} ${g.riskStatus} ($${g.currentAmount?.toLocaleString() || 0}/$${g.targetAmount?.toLocaleString() || 0})`).join(", ")}` : null,
    pack.debts.length ? `DEBTS: ${pack.debts.map(d => `${d.label} $${d.balance.toLocaleString()} @ ${d.apr}%`).join(", ")}` : null,
    pack.upcomingObligations.length ? `UPCOMING: ${pack.upcomingObligations.map(o => `${o.description} $${o.estimatedCost} on ${o.date}`).join(", ")}` : null,
    `CALENDAR: ${pack.calendarPressure.loadLevel} — ${pack.calendarPressure.financialRisk}`,
    pack.stressPressure.isCapacityProblem ? `STRESS: This is a CAPACITY PROBLEM — financial recommendations should account for household load` : `STRESS: ${pack.stressPressure.level}`,
    pack.crossModuleRisks.length ? `RISKS: ${pack.crossModuleRisks.slice(0, 3).join(" | ")}` : null,
    `NOTE: ${pack.complianceNote}`,
  ].filter(Boolean);
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// PRIVATE UTILITIES
// ═══════════════════════════════════════════════════════════════════

function buildStressNode(thriveData: any, tasksData: any, calendarData: any): HouseholdStressContext {
  const t = now();
  const moodLogs = (thriveData?.moodLog as any[]) || [];
  const recentMoods = moodLogs.slice(-3).map((l: any) => l.value || 3);
  const avgMood = recentMoods.length ? recentMoods.reduce((a: number, b: number) => a + b, 0) / recentMoods.length : 3;

  const allTasks = (tasksData?.tasks as any[]) || [];
  const taskBacklog = allTasks.filter((task: any) => !task.done && task.dueDate && task.dueDate < new Date().toISOString().split("T")[0]).length;

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

function recalculateStress(stress: HouseholdStressContext): void {
  const total = stress.stressSources.reduce((a, s) => a + s.weight, 0);
  stress.level = total >= 0.8 ? "critical" : total >= 0.5 ? "high" : total >= 0.25 ? "moderate" : "low";
  stress.isCapacityProblem = stress.schedulePressure === "high" && stress.taskBacklog > 2;
}

function getAgeGroup(age?: number): Person["ageGroup"] {
  if (!age) return "adult";
  if (age < 2) return "infant";
  if (age < 5) return "toddler";
  if (age < 13) return "child";
  if (age < 18) return "teen";
  if (age < 65) return "adult";
  return "senior";
}

function mapRiskToStatus(riskStatus: string): GoalStatus {
  const map: Record<string, GoalStatus> = {
    on_track: "on_track", at_risk: "at_risk", off_track: "off_track", achieved: "achieved",
  };
  return map[riskStatus] || "in_progress";
}

function insightToMemoryType(insightType: string): Memory["memoryType"] {
  const map: Record<string, Memory["memoryType"]> = {
    financial: "financial_pattern", schedule: "seasonal_pattern",
    wellness: "stress_pattern", planning: "fact",
    opportunity: "financial_pattern", risk: "warning",
  };
  return map[insightType] || "fact";
}

// HouseholdInsight.category (store) → graph Insight.insightType
function mapCategoryToInsightType(category?: string): Insight["insightType"] {
  const map: Record<string, Insight["insightType"]> = {
    spending: "financial", savings: "financial", debt: "financial", cashflow: "financial",
    scheduling: "schedule", stress: "wellness", health: "wellness",
    family: "planning", decision: "planning", opportunity: "opportunity",
  };
  return map[category || ""] || "financial";
}
