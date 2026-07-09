// ─── HerNest Household Intelligence — Scores (Phase 4) ───────────
// Pure, deterministic functions over the already-assembled AppContext.
// No I/O, no AI calls — cheap, explainable, and unit-testable.
//
// These extend the existing intelligence layer:
//   • financialHealthScore  → HouseholdIntelligence.ts (already exists)
//   • operational state      → householdStateEngine.ts (already exists)
// with the two scores the 6-phase plan calls for but that don't exist yet —
// RESILIENCE (capacity to absorb shocks) and PRODUCTIVITY (follow-through) —
// plus an ATTENTION RANKER (the "Risk Radar" priority engine).
//
// NOT YET WIRED. To surface: call computeHouseholdScores(appCtx) from the Home
// "Household Pulse" card or a Command Center widget, or fold the numbers into
// buildHouseholdSnapshot. All weights/thresholds are named constants — tune freely.
//
// Open questions for review are at the bottom of this file.

import type { AppContext } from "../contextBuilder";

// ═══════════════════════════════════════════════════════════════════
// SHARED TYPES + HELPERS
// ═══════════════════════════════════════════════════════════════════

export type ScoreBand = "fragile" | "stretched" | "steady" | "resilient";

export interface ScoreComponent {
  key: string;
  label: string;
  score: number;   // 0–100 for this dimension
  weight: number;  // contribution weight (weights per score sum to ~1)
  detail: string;  // human-readable explanation ("why this number")
}

export interface HouseholdScore {
  score: number;            // 0–100 weighted composite
  band: ScoreBand;
  headline: string;         // one-line plain-language summary
  components: ScoreComponent[];
  computedAt: string;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function bandFor(score: number): ScoreBand {
  if (score >= 75) return "resilient";
  if (score >= 55) return "steady";
  if (score >= 35) return "stretched";
  return "fragile";
}

function weighted(components: ScoreComponent[]): number {
  const total = components.reduce((a, c) => a + c.weight, 0) || 1;
  return clamp(components.reduce((a, c) => a + c.score * c.weight, 0) / total);
}

// ═══════════════════════════════════════════════════════════════════
// RESILIENCE SCORE
// Capacity to absorb a shock (sick kid, big bill, a trip) and stay steady.
// Deliberately rewards SLACK and buffers, NOT optimization — a household that
// is "maxed but efficient" should read as fragile, not high-performing.
// ═══════════════════════════════════════════════════════════════════

export function computeResilienceScore(ctx: AppContext): HouseholdScore {
  // 1. Financial buffer — savings rate up, debt + spending pressure down.
  const savingsRate = ctx.budget.savingsRate || 0;
  const dti = ctx.budget.monthlyIncome > 0
    ? (ctx.budget.totalDebt / (ctx.budget.monthlyIncome * 12)) * 100
    : 0;
  let buffer = 50;
  buffer += savingsRate >= 20 ? 40 : savingsRate >= 10 ? 25 : savingsRate >= 5 ? 10 : -10;
  buffer -= dti > 40 ? 30 : dti > 20 ? 15 : 0;
  buffer -= ctx.budget.status === "critical" ? 25 : ctx.budget.status === "warning" ? 12 : 0;
  const financialBuffer = clamp(buffer);

  // 2. Schedule slack — inverse of calendar pressure, conflicts, and backlog.
  const densityScore = { light: 90, moderate: 65, heavy: 35, extreme: 10 }[ctx.calendar.density] ?? 60;
  const slack = clamp(
    densityScore
    - ctx.calendar.conflicts.length * 8
    - (ctx.tasks.overdue.length >= 5 ? 20 : ctx.tasks.overdue.length >= 3 ? 10 : 0)
  );

  // 3. Wellbeing reserve — sleep + mood trend (recovery capacity).
  const avgSleep = avg(ctx.thrive.sleepTrend);
  const avgMood = ctx.thrive.moodTrend.length ? avg(ctx.thrive.moodTrend) : 3;
  let reserve = 55;
  reserve += avgSleep >= 7 ? 25 : avgSleep >= 6 ? 10 : (avgSleep > 0 && avgSleep < 5.5) ? -25 : 0;
  reserve += avgMood >= 4 ? 20 : avgMood >= 3 ? 5 : avgMood < 2.5 ? -25 : 0;
  const wellbeingReserve = clamp(reserve);

  // 4. Goal safety — savings goals progressing, few off-track.
  const goals = ctx.budget.savingsGoals;
  const goalAvg = goals.length ? avg(goals.map(g => Math.min(100, g.pct))) : 60;
  const atRisk = (ctx.householdSnapshot?.activeGoals || []).filter(g => g.riskStatus !== "on_track").length;
  const goalSafety = clamp(goalAvg - atRisk * 12);

  const components: ScoreComponent[] = [
    { key: "buffer", label: "Financial buffer", score: financialBuffer, weight: 0.35,
      detail: `${savingsRate.toFixed(0)}% savings rate${dti > 20 ? `, ${dti.toFixed(0)}% debt-to-income` : ""}; spending ${ctx.budget.status}.` },
    { key: "slack", label: "Schedule slack", score: slack, weight: 0.25,
      detail: `${ctx.calendar.density} calendar${ctx.calendar.conflicts.length ? `, ${ctx.calendar.conflicts.length} conflict(s)` : ""}${ctx.tasks.overdue.length ? `, ${ctx.tasks.overdue.length} overdue` : ""}.` },
    { key: "reserve", label: "Wellbeing reserve", score: wellbeingReserve, weight: 0.20,
      detail: avgSleep > 0 ? `~${avgSleep.toFixed(1)}h sleep, mood ${avgMood.toFixed(1)}/5.` : "Not enough wellbeing data logged." },
    { key: "goals", label: "Goal safety", score: goalSafety, weight: 0.20,
      detail: goals.length ? `${goals.length} goal(s), ${atRisk} at risk.` : "No savings goals set." },
  ];

  const score = weighted(components);
  const band = bandFor(score);
  const headline: Record<ScoreBand, string> = {
    resilient: "Room to absorb a shock without strain.",
    steady:    "Holding steady with a manageable cushion.",
    stretched: "Stretched — a surprise this week would hurt.",
    fragile:   "Fragile — almost no slack to absorb anything extra.",
  };
  return { score, band, headline: headline[band], components, computedAt: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCTIVITY SCORE
// Follow-through, not busyness: are the things that matter getting closed out?
// ═══════════════════════════════════════════════════════════════════

export function computeProductivityScore(ctx: AppContext): HouseholdScore {
  // 1. Follow-through — task completion rate.
  const completion = clamp((ctx.tasks.completionRate || 0) * 100);

  // 2. Backlog control — inverse of overdue + urgent-school pile-up.
  const overdue = ctx.tasks.overdue.length;
  const backlog = clamp(100 - overdue * 12 - ctx.school.urgentToday.length * 8);

  // 3. Routine adherence — habits done today.
  const habitRate = ctx.thrive.totalHabits > 0 ? ctx.thrive.habitsToday / ctx.thrive.totalHabits : 0.6;
  const habits = clamp(habitRate * 100);

  const components: ScoreComponent[] = [
    { key: "followThrough", label: "Follow-through", score: completion, weight: 0.45,
      detail: `${Math.round((ctx.tasks.completionRate || 0) * 100)}% of tasks completed.` },
    { key: "backlog", label: "Backlog control", score: backlog, weight: 0.30,
      detail: overdue ? `${overdue} overdue${ctx.school.urgentToday.length ? `, ${ctx.school.urgentToday.length} urgent school item(s)` : ""}.` : "No overdue items." },
    { key: "habits", label: "Routine adherence", score: habits, weight: 0.25,
      detail: ctx.thrive.totalHabits ? `${ctx.thrive.habitsToday}/${ctx.thrive.totalHabits} habits today.` : "No habits tracked." },
  ];

  const score = weighted(components);
  const band = bandFor(score);
  const headline: Record<ScoreBand, string> = {
    resilient: "Things are getting done without strain.",
    steady:    "Good follow-through overall.",
    stretched: "Slipping — backlog is starting to build.",
    fragile:   "Overwhelmed — little is getting closed out.",
  };
  return { score, band, headline: headline[band], components, computedAt: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════════════════
// ATTENTION RANKER ("Risk Radar" / priority engine)
// Surfaces the few things that need a human decision NOW, ranked by severity.
// ═══════════════════════════════════════════════════════════════════

export type AttentionSeverity = "info" | "watch" | "alert";

export interface AttentionItem {
  id: string;
  title: string;
  severity: AttentionSeverity;
  source: string;          // originating module
  why: string;             // why it matters
  suggestedAction: string; // one concrete next step
}

const SEV_RANK: Record<AttentionSeverity, number> = { alert: 3, watch: 2, info: 1 };

export function rankAttention(ctx: AppContext): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (ctx.tasks.overdue.length > 0) {
    const severity: AttentionSeverity = ctx.tasks.overdue.length >= 5 ? "alert" : ctx.tasks.overdue.length >= 2 ? "watch" : "info";
    items.push({
      id: "tasks_overdue",
      title: `${ctx.tasks.overdue.length} overdue task${ctx.tasks.overdue.length > 1 ? "s" : ""}`,
      severity, source: "tasks",
      why: "Overdue items snowball into stress and missed commitments.",
      suggestedAction: "Clear the top 1–2, reschedule the rest off your plate.",
    });
  }

  if (ctx.budget.status === "critical" || ctx.budget.status === "warning") {
    items.push({
      id: "budget_pressure",
      title: `Spending is ${ctx.budget.status}`,
      severity: ctx.budget.status === "critical" ? "alert" : "watch", source: "budget",
      why: `At ${Math.round(ctx.budget.pct * 100)}% of budget with ${ctx.budget.daysUntilReset} days left.`,
      suggestedAction: ctx.budget.topOverspend ? `Set a soft cap on ${ctx.budget.topOverspend} for the rest of the month.` : "Set a soft cap on the top category for the rest of the month.",
    });
  }

  if (ctx.school.urgentToday.length > 0) {
    items.push({
      id: "school_urgent",
      title: `${ctx.school.urgentToday.length} urgent school item${ctx.school.urgentToday.length > 1 ? "s" : ""} today`,
      severity: "alert", source: "school",
      why: "School deadlines are time-boxed and easy to miss in a busy week.",
      suggestedAction: "Handle now or delegate — these don't move.",
    });
  }

  if (ctx.trips.next && ctx.trips.next.daysUntil <= 14 && ctx.trips.next.packingPct < 60) {
    items.push({
      id: "trip_prep",
      title: `${ctx.trips.next.dest} in ${ctx.trips.next.daysUntil} days — a 20-min packing session gets you ahead`,
      severity: ctx.trips.next.daysUntil <= 5 ? "alert" : "watch", source: "trips",
      why: "Travel prep compresses fast and disrupts routines if left late.",
      suggestedAction: "Block 20 minutes to finish the packing/prep list.",
    });
  }

  const offTrack = (ctx.householdSnapshot?.activeGoals || []).filter(g => g.riskStatus === "off_track");
  if (offTrack.length > 0) {
    items.push({
      id: "goals_offtrack",
      title: `${offTrack.length} goal${offTrack.length > 1 ? "s" : ""} off track`,
      severity: "watch", source: "goals",
      why: `${offTrack.map(g => g.name).slice(0, 2).join(", ")} ${offTrack.length > 1 ? "are" : "is"} drifting from target.`,
      suggestedAction: "Adjust the monthly contribution or the deadline so it's realistic.",
    });
  }

  const avgSleep = avg(ctx.thrive.sleepTrend);
  if (avgSleep > 0 && avgSleep < 5.5) {
    items.push({
      id: "sleep_low",
      title: "Sleep is running low",
      severity: "watch", source: "thrive",
      why: `~${avgSleep.toFixed(1)}h average — recovery debt raises stress and lowers capacity.`,
      suggestedAction: "Protect one earlier night this week before adding anything new.",
    });
  }

  return items.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
}

// ═══════════════════════════════════════════════════════════════════
// CONVENIENCE: all three at once (easy to wire into a screen/snapshot)
// ═══════════════════════════════════════════════════════════════════

export interface HouseholdScores {
  resilience: HouseholdScore;
  productivity: HouseholdScore;
  attention: AttentionItem[];
}

export function computeHouseholdScores(ctx: AppContext): HouseholdScores {
  return {
    resilience: computeResilienceScore(ctx),
    productivity: computeProductivityScore(ctx),
    attention: rankAttention(ctx),
  };
}

// ─── DESIGN NOTES / OPEN QUESTIONS (for Andrew) ──────────────────
// 1. WEIGHTS are a first pass: resilience = buffer .35 / slack .25 / reserve .20
//    / goals .20; productivity = follow-through .45 / backlog .30 / habits .25.
//    Tune to taste — they're the levers that decide what "resilient" means here.
// 2. BANDS cut at 75 / 55 / 35. Adjust if they feel too generous/harsh.
// 3. RESILIENCE deliberately rewards SLACK over optimization (per the Thrive
//    thesis). Confirm you want that same philosophy applied to the finance/
//    schedule context, not a "maximize output" framing.
// 4. LOAD BALANCE (how evenly work is distributed across adults) is a core
//    resilience dimension in the plan but needs multi-member data — deferred
//    until true multi-login households land. Add as a 5th component then.
// 5. WHERE TO SURFACE: Home "Household Pulse" card, a Command Center widget, or
//    fold the numbers into buildHouseholdSnapshot so Cleo can reference them?
//    (I left it unwired so the UI/placement call is yours.)
