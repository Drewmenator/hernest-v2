// ─── HerNest Household State Engine ──────────────────────────────
// Determines the current operational state of a household.
// NOT a mental health or emotion system.
// Operational household awareness only.
//
// Uses signals from bills, calendar, tasks, wellness, trips and
// memory to compute weighted state scores.
// Multiple states can coexist (e.g. busy + financial_pressure).

import type { AppContext } from "../contextBuilder";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type HouseholdState =
  | "calm"
  | "busy"
  | "overloaded"
  | "financial_pressure"
  | "travel_prep"
  | "school_transition"
  | "recovery"
  | "decision_heavy";

export interface HouseholdStateScore {
  calm:               number; // 0–100
  busy:               number;
  overloaded:         number;
  financial_pressure: number;
  travel_prep:        number;
  school_transition:  number;
  recovery:           number;
  decision_heavy:     number;
}

export interface ActiveState {
  state: HouseholdState;
  confidence: number;       // 0–100
  topSignals: string[];     // human-readable reasons
}

export interface HouseholdStateResult {
  // Primary state (highest confidence)
  primary: ActiveState;

  // All states above threshold (multiple can coexist)
  active: ActiveState[];

  // Raw scores for debugging / explainability
  scores: HouseholdStateScore;

  // How Cleo should adjust tone
  cleoTone: "warm_proactive" | "supportive_simple" | "validating_brief" | "calm_analytical";

  // Dashboard content priority
  dashboardMode: "full" | "essentials" | "relief" | "planning";

  // Whether to suppress non-essential notifications
  suppressNotifications: boolean;

  // Plain-language summary for "Why is Cleo saying this?"
  explanation: string;

  computedAt: string;
}

// Threshold above which a state is considered "active"
const ACTIVE_THRESHOLD = 35;

// ═══════════════════════════════════════════════════════════════════
// SIGNAL EXTRACTORS
// Each returns a 0–100 score for its domain
// ═══════════════════════════════════════════════════════════════════

function scoreCalendarPressure(ctx: AppContext): number {
  const density = ctx.calendar.density;
  const base = { light: 10, moderate: 35, heavy: 65, extreme: 90 }[density] ?? 10;
  const conflictBonus = ctx.calendar.conflicts.length * 5;
  return Math.min(100, base + conflictBonus);
}

function scoreTaskPressure(ctx: AppContext): number {
  const overdue = ctx.tasks.overdue.length;
  const total   = ctx.tasks.total;
  const completionRate = ctx.tasks.completionRate;

  let score = 0;
  if (overdue >= 5) score += 40;
  else if (overdue >= 3) score += 25;
  else if (overdue >= 1) score += 15;

  if (completionRate < 0.3 && total > 5) score += 20;
  else if (completionRate < 0.5 && total > 3) score += 10;

  return Math.min(100, score);
}

// Money pressure now comes from bills only (the old Budget totals it used to
// read are no longer kept): overdue bills weigh most, then bills due this week.
function scoreFinancialPressure(ctx: AppContext): number {
  const overdue = ctx.bills.overdue.length;
  const dueSoon = ctx.bills.dueSoon.filter(b => !b.autopay).length;
  return Math.min(100, overdue * 35 + Math.max(0, dueSoon - 1) * 8);
}

function scoreTravelPrep(ctx: AppContext): number {
  const trip = ctx.trips.next;
  if (!trip) return 0;

  const daysUntil = trip.daysUntil;
  let score = 0;

  if (daysUntil <= 7)  score += 80;
  else if (daysUntil <= 14) score += 60;
  else if (daysUntil <= 21) score += 40;
  else if (daysUntil <= 60) score += 20;

  // Incomplete packing list adds pressure
  if (trip.packingPct < 50 && daysUntil <= 14) score += 15;

  return Math.min(100, score);
}

function scoreSchoolTransition(ctx: AppContext): number {
  const urgentToday = ctx.school.urgentToday.length;
  const thisWeek    = ctx.school.thisWeek.length;

  let score = 0;
  if (urgentToday >= 2) score += 50;
  else if (urgentToday >= 1) score += 30;
  if (thisWeek >= 4) score += 30;
  else if (thisWeek >= 2) score += 15;

  return Math.min(100, score);
}

function scoreWellnessPressure(ctx: AppContext): number {
  let score = 0;

  const avgSleep = ctx.thrive.sleepTrend.length
    ? ctx.thrive.sleepTrend.reduce((a, b) => a + b, 0) / ctx.thrive.sleepTrend.length
    : 0;
  const avgMood = ctx.thrive.moodTrend.length
    ? ctx.thrive.moodTrend.reduce((a, b) => a + b, 0) / ctx.thrive.moodTrend.length
    : 3;

  if (avgSleep > 0 && avgSleep < 5.5) score += 30;
  else if (avgSleep > 0 && avgSleep < 6.5) score += 15;

  if (avgMood < 2.5) score += 30;
  else if (avgMood < 3.5) score += 10;

  const habitRate = ctx.thrive.totalHabits > 0
    ? ctx.thrive.habitsToday / ctx.thrive.totalHabits
    : 1;
  if (habitRate < 0.3 && ctx.thrive.totalHabits > 2) score += 15;

  return Math.min(100, score);
}

function scoreDecisionHeavy(ctx: AppContext): number {
  // Proxy: an upcoming major event. (Savings goals went with the old Budget.)
  return ctx.trips.next ? 10 : 0;
}

// ═══════════════════════════════════════════════════════════════════
// STATE SCORER
// Combines domain signals into state scores
// ═══════════════════════════════════════════════════════════════════

function computeScores(ctx: AppContext): HouseholdStateScore {
  const calendarPressure  = scoreCalendarPressure(ctx);
  const taskPressure      = scoreTaskPressure(ctx);
  const financialPressure = scoreFinancialPressure(ctx);
  const travelPrep        = scoreTravelPrep(ctx);
  const schoolTransition  = scoreSchoolTransition(ctx);
  const wellnessPressure  = scoreWellnessPressure(ctx);
  const decisionHeavy     = scoreDecisionHeavy(ctx);

  // Composite scores per state
  const busy = Math.round(
    calendarPressure * 0.5 +
    taskPressure     * 0.3 +
    wellnessPressure * 0.2
  );

  const overloaded = Math.round(
    calendarPressure  * 0.35 +
    taskPressure      * 0.35 +
    wellnessPressure  * 0.20 +
    financialPressure * 0.10
  );

  const financial_pressure = Math.round(
    financialPressure * 0.75 +
    taskPressure      * 0.15 +
    calendarPressure  * 0.10
  );

  const travel_prep = travelPrep;

  const school_transition = Math.round(
    schoolTransition * 0.70 +
    calendarPressure * 0.30
  );

  const decision_heavy = decisionHeavy;

  // Recovery: recent overload decreasing
  // Proxy: low current pressure but recent stress indicators
  const currentPressure = Math.max(calendarPressure, taskPressure, financialPressure);
  const recovery = currentPressure < 30 && (
    ctx.thrive.sleepTrend.length >= 3 &&
    ctx.thrive.sleepTrend[ctx.thrive.sleepTrend.length - 1] >
    ctx.thrive.sleepTrend[0]
  ) ? 40 : 0;

  // Calm: low pressure across all signals
  const maxPressure = Math.max(busy, overloaded, financial_pressure, travel_prep, school_transition);
  const calm = Math.max(0, 100 - maxPressure);

  return {
    calm:               Math.round(calm),
    busy:               Math.round(busy),
    overloaded:         Math.round(overloaded),
    financial_pressure: Math.round(financial_pressure),
    travel_prep:        Math.round(travel_prep),
    school_transition:  Math.round(school_transition),
    recovery:           Math.round(recovery),
    decision_heavy:     Math.round(decision_heavy),
  };
}

// ═══════════════════════════════════════════════════════════════════
// SIGNAL EXPLAINERS
// Human-readable reasons for each state
// ═══════════════════════════════════════════════════════════════════

function buildSignals(ctx: AppContext, state: HouseholdState): string[] {
  const signals: string[] = [];

  switch (state) {
    case "overloaded":
    case "busy":
      if (ctx.calendar.density === "extreme") signals.push("Extremely full calendar");
      else if (ctx.calendar.density === "heavy") signals.push("Heavy calendar load");
      if (ctx.tasks.overdue.length > 0) signals.push(`${ctx.tasks.overdue.length} overdue tasks`);
      if (ctx.tasks.completionRate < 0.4) signals.push("Low task completion rate");
      break;

    case "financial_pressure":
      if (ctx.bills.overdue.length) signals.push(`${ctx.bills.overdue.length} bill${ctx.bills.overdue.length === 1 ? "" : "s"} overdue`);
      if (ctx.bills.dueSoon.length) signals.push(`${ctx.bills.dueSoon.length} bill${ctx.bills.dueSoon.length === 1 ? "" : "s"} due this week`);
      break;

    case "travel_prep":
      if (ctx.trips.next) {
        signals.push(`${ctx.trips.next.dest} trip in ${ctx.trips.next.daysUntil} days`);
        if (ctx.trips.next.packingPct < 50) signals.push("Packing list incomplete");
      }
      break;

    case "school_transition":
      if (ctx.school.urgentToday.length) signals.push(`${ctx.school.urgentToday.length} urgent school items today`);
      if (ctx.school.thisWeek.length) signals.push(`${ctx.school.thisWeek.length} school events this week`);
      break;

    case "recovery":
      signals.push("Pressure easing after a busy period");
      break;

    case "decision_heavy":
      signals.push("Multiple unresolved priorities");
      break;

    case "calm":
      signals.push("Balanced schedule");
      break;
  }

  return signals.slice(0, 3);
}

// ═══════════════════════════════════════════════════════════════════
// TONE + DASHBOARD ADAPTERS
// ═══════════════════════════════════════════════════════════════════

function selectCleoTone(primary: HouseholdState): HouseholdStateResult["cleoTone"] {
  switch (primary) {
    case "overloaded":        return "validating_brief";
    case "financial_pressure": return "calm_analytical";
    case "busy":              return "supportive_simple";
    case "calm":
    case "recovery":          return "warm_proactive";
    default:                  return "supportive_simple";
  }
}

function selectDashboardMode(primary: HouseholdState): HouseholdStateResult["dashboardMode"] {
  switch (primary) {
    case "overloaded":        return "relief";
    case "busy":              return "essentials";
    case "calm":
    case "recovery":          return "planning";
    default:                  return "full";
  }
}

function shouldSuppressNotifications(active: ActiveState[]): boolean {
  return active.some(s => s.state === "overloaded" && s.confidence > 50);
}

function buildExplanation(primary: ActiveState, active: ActiveState[]): string {
  const others = active.filter(s => s.state !== primary.state).map(s => s.state.replace("_", " "));
  const base = `Household is in ${primary.state.replace("_", " ")} mode`;
  const signals = primary.topSignals.slice(0, 2).join(", ");
  const coStates = others.length ? ` (also: ${others.join(", ")})` : "";
  return `${base}${coStates}. Key signals: ${signals || "general household load"}.`;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ENGINE
// ═══════════════════════════════════════════════════════════════════

export function computeHouseholdState(ctx: AppContext): HouseholdStateResult {
  const scores = computeScores(ctx);

  // Build active states list (all above threshold)
  const allStates = Object.entries(scores) as [HouseholdState, number][];
  const activeStates: ActiveState[] = allStates
    .filter(([, score]) => score >= ACTIVE_THRESHOLD)
    .sort(([, a], [, b]) => b - a)
    .map(([state, score]) => ({
      state,
      confidence: score,
      topSignals: buildSignals(ctx, state),
    }));

  // Primary = highest confidence
  // Default to calm if nothing crosses threshold
  const primary: ActiveState = activeStates[0] ?? {
    state: "calm",
    confidence: scores.calm,
    topSignals: ["No significant pressure signals detected"],
  };

  const cleoTone      = selectCleoTone(primary.state);
  const dashboardMode = selectDashboardMode(primary.state);
  const suppress      = shouldSuppressNotifications(activeStates);
  const explanation   = buildExplanation(primary, activeStates);

  return {
    primary,
    active: activeStates,
    scores,
    cleoTone,
    dashboardMode,
    suppressNotifications: suppress,
    explanation,
    computedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// ORCHESTRATOR INTEGRATION
// Injects state context into Cleo's system prompt
// ═══════════════════════════════════════════════════════════════════

export function buildStatePromptAddendum(state: HouseholdStateResult): string {
  const { primary, active, cleoTone, suppressNotifications } = state;

  const toneInstructions: Record<HouseholdStateResult["cleoTone"], string> = {
    warm_proactive:    "Be warm and proactive. Offer forward-looking suggestions. This household has capacity right now.",
    supportive_simple: "Keep responses focused and practical. Avoid overwhelming with too many suggestions.",
    validating_brief:  "Validate first, always. Keep recommendations short — one or two actions maximum. This household is stretched.",
    calm_analytical:   "Be calm and analytical. Focus on practical tradeoffs. Avoid alarming language.",
  };

  const activeList = active.map(s => `${s.state.replace("_", " ")} (${s.confidence}%)`).join(", ");

  return `
=== HOUSEHOLD STATE ===
Current mode: ${primary.state.replace("_", " ")} (${primary.confidence}% confidence)
${active.length > 1 ? `Also active: ${activeList}` : ""}
Key signals: ${primary.topSignals.join(", ")}
${suppressNotifications ? "Note: Suppress non-essential suggestions — household is stretched." : ""}

Tone instruction: ${toneInstructions[cleoTone]}
`.trim();
}
