// ─── HerNest Household Context Graph — Context Packs ──────────────
// src/core/graph/contextPacks.ts
//
// Context pack generation for Cleo and the CFO, plus prompt formatters.

import { COMPLIANCE_NOTE } from "./internals";
import type { HouseholdContextGraph, CleoContextPack, CFOContextPack, TodoItem } from "./types";

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

  // ── Task summary: the actual to-do list, so Cleo can act as a PA ──
  const todayISO = new Date().toISOString().split("T")[0];
  const soonISO = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
  const openTodos = graph.todos.filter(t => t.status !== "completed");
  const isUrgent = (t: TodoItem) => ["critical", "must", "high"].includes(t.priority);
  const ownerTag = (t: TodoItem) => (t.owner ? `, ${t.owner}` : "");
  const overdueTodos = openTodos
    .filter(t => t.dueDate && t.dueDate < todayISO)
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))
    .map(t => `${t.title} (was due ${t.dueDate}${ownerTag(t)})`);
  const dueSoonTodos = openTodos
    .filter(t => t.dueDate && t.dueDate >= todayISO && t.dueDate <= soonISO)
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))
    .map(t => `${t.title} (due ${t.dueDate}${ownerTag(t)})`);
  // Important tasks with no near deadline — so nothing critical stays invisible.
  const priorityOpenTodos = openTodos
    .filter(t => isUrgent(t) && (!t.dueDate || t.dueDate > soonISO))
    .map(t => `${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""}${ownerTag(t)}`);

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
      upcomingEvents: graph.calendar
        .filter(c => (c.subtype === "event" || c.subtype === "travel_block") && c.date && c.date >= new Date().toISOString().split("T")[0])
        .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
        .slice(0, 6)
        .map(c => `${c.title}${c.date ? ` (${c.date})` : ""}`),
      highLoadDays: calLoad?.highLoadDays || [],
      appointmentsThisWeek: graph.calendar
        .filter(c => (c.subtype === "appointment" || c.subtype === "school_event") && c.date && c.date >= new Date().toISOString().split("T")[0])
        .map(c => `${c.title} (${c.date})`),
    },
    taskSummary: {
      totalOpen: openTodos.length,
      overdue: overdueTodos.slice(0, 8),
      dueSoon: dueSoonTodos.slice(0, 8),
      priorityOpen: priorityOpenTodos.slice(0, 5),
    },
    alerts: [...graph.alerts]
      .sort((a, b) => {
        const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
        return (rank[a.severity || "info"] ?? 2) - (rank[b.severity || "info"] ?? 2);
      })
      .slice(0, 6)
      .map(a => a.message),
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
    pack.calendarSummary.upcomingEvents.length ? `EVENTS: ${pack.calendarSummary.upcomingEvents.join(" · ")}` : null,
    pack.calendarSummary.appointmentsThisWeek.length ? `APPOINTMENTS: ${pack.calendarSummary.appointmentsThisWeek.join(", ")}` : null,
    `STRESS: ${pack.stressContext.level}${pack.stressContext.isCapacityProblem ? " (CAPACITY PROBLEM — not a willpower issue)" : ""}`,
    pack.stressContext.activeSignals.length ? `STRESS SIGNALS: ${pack.stressContext.activeSignals.join("; ")}` : null,
    pack.taskSummary.totalOpen > 0 ? `TASKS: ${pack.taskSummary.totalOpen} open` : null,
    pack.taskSummary.overdue.length ? `OVERDUE: ${pack.taskSummary.overdue.join(" · ")}` : null,
    pack.taskSummary.dueSoon.length ? `DUE SOON: ${pack.taskSummary.dueSoon.join(" · ")}` : null,
    pack.taskSummary.priorityOpen.length ? `KEY TASKS: ${pack.taskSummary.priorityOpen.join(" · ")}` : null,
    pack.routineHealth.missedRoutines.length ? `MISSED ROUTINES: ${pack.routineHealth.missedRoutines.join(", ")}` : null,
    // Proactive reminders (budget/trip/circle alerts) — what a PA flags first.
    pack.alerts.length ? `REMINDERS: ${pack.alerts.join(" · ")}` : null,
    // Analytical observations Cleo has generated — previously computed into the
    // pack but never rendered, so she could never surface what she "noticed".
    pack.activeInsights.length ? `INSIGHTS: ${pack.activeInsights.map(i => i.recommendation ? `${i.observation} → ${i.recommendation}` : i.observation).join(" | ")}` : null,
    pack.activeGoals.length ? `GOALS: ${pack.activeGoals.map(g => `${g.title} (${g.riskStatus})`).join(", ")}` : null,
    pack.recentDecisions.length ? `RECENT DECISIONS: ${pack.recentDecisions.map(d => d.recommendation ? `${d.question} → ${d.recommendation}` : d.question).join("; ")}` : null,
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
