// ─── HerNest Household Context Graph — Builder ────────────────────
// src/core/graph/graphBuilder.ts
//
// createContextGraph(): builds a fresh graph from all Firestore module data.

import { loadData } from "../firebase";
import {
  now, addRelationship, indexNode, baseNode,
  buildStressNode, getAgeGroup, mapRiskToStatus, mapCategoryToInsightType,
} from "./internals";
import { saveGraphToFirestore } from "./persistence";
import type {
  HouseholdContextGraph,
  Person, FinancialContext, CalendarContext,
  Goal, HouseholdDecision, Memory, Insight,
  HouseholdModule, TodoItem, AlertItem,
} from "./types";

// ═══════════════════════════════════════════════════════════════════
// 1. createContextGraph()
// Builds a fresh graph from all Firestore module data.
// ═══════════════════════════════════════════════════════════════════

export async function createContextGraph(userId: string): Promise<HouseholdContextGraph> {
  const [profileData, budgetData, calendarData, calendarSyncedData, tasksData, thriveData, tripsData,
         schoolData, circleData, memoryV2Data, insightsData, alertsData, decisionsData, familyData] =
    await Promise.all([
      loadData(userId, "profile"),
      loadData(userId, "budget_v2"),
      loadData(userId, "calendar"),
      loadData(userId, "calendar_synced"),
      loadData(userId, "tasks"),
      loadData(userId, "thrive"),
      loadData(userId, "trips"),
      loadData(userId, "school"),
      loadData(userId, "circle"),
      loadData(userId, "cleo_memory_v2"),
      loadData(userId, "household_insights"),
      loadData(userId, "alerts"),
      loadData(userId, "decisions_v2"),
      loadData(userId, "family"),
    ]);

  // Manual events live in `calendar`; events from connected providers (Google/
  // Apple/Outlook) live in `calendar_synced`. Merge both, deduped by id, so the
  // graph (and Cleo) see the full picture — not just manually-typed events.
  const mergedCalEvents = (() => {
    const byId = new Map<string, any>();
    [...((calendarData?.events as any[]) || []), ...((calendarSyncedData?.events as any[]) || [])]
      .forEach((e: any) => { if (e && (e.id || e.title)) byId.set(e.id || `${e.date}_${e.title}`, e); });
    return [...byId.values()];
  })();
  const mergedCalendarData = { ...(calendarData || {}), events: mergedCalEvents };

  const graph: HouseholdContextGraph = {
    householdId: userId,
    version: 1,
    lastUpdated: now(),
    people: [],
    finances: [],
    calendar: [],
    tasks: [],
    todos: [],
    alerts: [],
    goals: [],
    stress: buildStressNode(thriveData, tasksData, mergedCalendarData),
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

  // ── Family Hub members ────────────────────────────────────────
  // The Family screen stores a fuller roster (partner, parents, in-laws) than
  // profile.kids. Ingest anyone not already represented so Cleo knows the whole
  // household — deduped by name to avoid double-counting kids.
  const knownNames = new Set(graph.people.map(p => (p.name || "").trim().toLowerCase()));
  const familyMembers = (familyData?.members as any[]) || [];
  familyMembers.forEach((m: any) => {
    const nm = (m?.name || "").trim();
    if (!nm || knownNames.has(nm.toLowerCase())) return;
    knownNames.add(nm.toLowerCase());
    const isChild = m.role === "child";
    const role: Person["role"] =
      m.role === "partner" ? "partner" : m.role === "child" ? "child" : m.role === "parent" ? "parent" : "other";
    const member: Person = {
      ...baseNode(`person_family_${m.id || nm}`, "person", "family", 0.9, [m.role || "member"]) as any,
      name: nm,
      role,
      ageGroup: isChild ? getAgeGroup(m.age) : "adult",
      isUser: false,
      preferences: {},
      responsibilities: [],
      routines: [],
      relatedGoalIds: [],
      stressTriggers: [],
    };
    graph.people.push(member);
    indexNode(graph, member);
  });

  // ── To-do items (discrete tasks from the Plan module) ─────────
  // These are operational, not routines — they give Cleo the actual
  // to-do list (titles, due dates, priority) instead of just a count.
  const rawTodos = (tasksData?.tasks as any[]) || [];
  graph.todos = rawTodos
    .filter((t: any) => t && t.title)
    .map((t: any): TodoItem => ({
      id: t.id || `todo_${t.title}`,
      title: String(t.title),
      category: t.category || "personal",
      priority: t.priority || "medium",
      // Tolerate both the current `status` field and a legacy `done` boolean.
      status: t.status || (t.done ? "completed" : "pending"),
      dueDate: t.dueDate || undefined,
      owner: t.owner || t.assignee || undefined,
    }));

  // ── Alerts (proactive reminders already generated by connectivity.ts) ──
  const rawAlerts = (alertsData?.alerts as any[]) || [];
  graph.alerts = rawAlerts
    .filter((a: any) => a && a.message)
    .slice(0, 10)
    .map((a: any): AlertItem => ({
      type: a.type || "general",
      message: String(a.message),
      severity: a.severity || "info",
      createdAt: a.createdAt || a.date || undefined,
    }));

  // ── Decisions (from DecisionEngineV2) ─────────────────────────
  // Previously graph.decisions was never populated, so RECENT DECISIONS was
  // always empty. Coerce the rich V2 objects down to what the pack needs.
  const rawDecisions = (decisionsData?.decisions as any[]) || [];
  rawDecisions.slice(0, 8).forEach((d: any) => {
    if (!d?.question) return;
    const recText = typeof d.recommendation === "string"
      ? d.recommendation
      : (d.recommendation?.summary || "");
    const outText = typeof d.outcome === "string"
      ? d.outcome
      : (d.outcome?.resultNotes || (d.outcome?.selectedOptionId ? "decided" : undefined));
    const decisionNode: HouseholdDecision = {
      ...baseNode(`decision_${d.id || d.question.slice(0, 24)}`, "decision", "home", 0.85, [d.status || "open"]) as any,
      question: String(d.question),
      context: d.purpose || "",
      options: [],
      criteria: [],
      tradeoffs: [],
      assumptions: Array.isArray(d.assumptions) ? d.assumptions : [],
      uncertainty: "medium",
      recommendation: recText,
      confidence: d.confidence === "high" ? 0.85 : d.confidence === "low" ? 0.4 : 0.6,
      riskLevel: "medium",
      suggestedFollowUpQuestions: [],
      outcome: outText,
    };
    graph.decisions.push(decisionNode);
    indexNode(graph, decisionNode);
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
  const calEvents = mergedCalEvents;
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

  // Individual event nodes — previously calendar events were only counted for
  // the load level and never turned into nodes, so Cleo's context pack (which
  // surfaces `event` nodes) had nothing to show. Create one node per upcoming
  // event so she can actually name what's on the calendar.
  calEvents
    .filter((e: any) => e && e.title && e.date && e.date >= todayStr)
    .sort((a: any, b: any) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 20)
    .forEach((e: any) => {
      const evNode: CalendarContext = {
        ...baseNode(`cal_event_${e.id || e.date + e.title}`, "calendar", "calendar", 0.85, ["event", e.source || "manual"]) as any,
        subtype: "event",
        title: e.time ? `${e.title} @ ${e.time}` : e.title,
        date: e.date,
        endDate: e.endDate || undefined,
      };
      graph.calendar.push(evNode);
      indexNode(graph, evNode);
    });

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
