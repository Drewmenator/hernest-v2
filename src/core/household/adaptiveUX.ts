// ─── HerNest Adaptive UX Layer ───────────────────────────────────
// Makes the app feel alive by adapting content, density, and
// behavior based on household state.
//
// The state engine computes the mode. This layer acts on it.
//
// Modes:
//   relief    → overloaded: fewer items, no optimization nags, relief focus
//   essentials → busy: prioritized items, reduced secondary content
//   full      → normal: everything shown
//   planning  → calm/recovery: goals, optimizations, forward-looking
//
// Used by: HomeScreen, BriefingScreen, InsightEngine display
// Reads from: HouseholdStateResult (already computed in orchestrator)

import { useMemo } from "react";
import type { HouseholdStateResult, HouseholdState } from "./householdStateEngine";
import { computeStateFromSnapshot } from "./householdStateEngine";
import type { HouseholdSnapshot } from "../store";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type DashboardMode = "relief" | "essentials" | "full" | "planning";

export interface AdaptiveConfig {
  // Dashboard content
  dashboardMode:          DashboardMode;
  showGoalsSection:       boolean;
  showInsightsFeed:       boolean;
  showOptimizationNudges: boolean;
  showDecisionPrompts:    boolean;
  showCalendarDetail:     boolean;
  showFinancialDetail:    boolean;
  maxInsightsShown:       number;
  maxTasksShown:          number;
  maxEventsShown:         number;

  // Nora behavior
  noraTone:               HouseholdStateResult["noraTone"];
  noraGreetingStyle:      "warm_brief" | "warm_full" | "validating" | "energizing";
  showNoraSuggestions:    boolean;
  noraResponseMaxLength:  "short" | "medium" | "full";

  // Notifications
  suppressNotifications:  boolean;
  notificationFilter:     "critical_only" | "important" | "all";

  // Visual density
  cardDensity:            "compact" | "normal" | "expanded";
  showSecondaryStats:     boolean;

  // Feature emphasis
  primaryCTA:             { label: string; module: string };
  secondaryCTA?:          { label: string; module: string };

  // State explanation (shown to user)
  stateLabel:             string;
  stateDescription:       string;
  stateColor:             string;
}

// ═══════════════════════════════════════════════════════════════════
// CONFIG MAP
// Maps household state → full UX configuration
// ═══════════════════════════════════════════════════════════════════

function buildConfig(
  mode: DashboardMode,
  primaryState: HouseholdState,
  stateResult: Partial<HouseholdStateResult>
): AdaptiveConfig {
  const noraTone = stateResult.noraTone ?? "warm_proactive";

  const base: AdaptiveConfig = {
    dashboardMode:          mode,
    showGoalsSection:       true,
    showInsightsFeed:       true,
    showOptimizationNudges: true,
    showDecisionPrompts:    true,
    showCalendarDetail:     true,
    showFinancialDetail:    true,
    maxInsightsShown:       3,
    maxTasksShown:          5,
    maxEventsShown:         5,
    noraTone,
    noraGreetingStyle:      "warm_full",
    showNoraSuggestions:    true,
    noraResponseMaxLength:  "full",
    suppressNotifications:  false,
    notificationFilter:     "all",
    cardDensity:            "normal",
    showSecondaryStats:     true,
    primaryCTA:             { label: "Ask Nora", module: "nora" },
    stateLabel:             "Steady",
    stateDescription:       "Your household is in a steady rhythm.",
    stateColor:             "#6B9E7A",
  };

  switch (primaryState) {
    case "overloaded":
      return {
        ...base,
        dashboardMode:          "relief",
        showGoalsSection:       false,  // don't show goal progress when stretched
        showInsightsFeed:       true,
        showOptimizationNudges: false,  // no "you could save more" when overwhelmed
        showDecisionPrompts:    false,  // no new decisions when overloaded
        showCalendarDetail:     false,  // keep calendar minimal
        showFinancialDetail:    false,
        maxInsightsShown:       1,      // one insight max
        maxTasksShown:          3,      // only top 3 tasks
        maxEventsShown:         3,
        noraGreetingStyle:      "validating",
        showNoraSuggestions:    true,
        noraResponseMaxLength:  "short",
        suppressNotifications:  true,
        notificationFilter:     "critical_only",
        cardDensity:            "compact",
        showSecondaryStats:     false,
        primaryCTA:             { label: "Talk to Nora", module: "nora" },
        stateLabel:             "Heavy week",
        stateDescription:       "You have a lot on. Nora's keeping it simple.",
        stateColor:             "#D4826A",
      };

    case "busy":
      return {
        ...base,
        dashboardMode:          "essentials",
        showGoalsSection:       false,
        showOptimizationNudges: false,
        showDecisionPrompts:    false,
        maxInsightsShown:       2,
        maxTasksShown:          4,
        maxEventsShown:         4,
        noraGreetingStyle:      "warm_brief",
        noraResponseMaxLength:  "medium",
        notificationFilter:     "important",
        cardDensity:            "compact",
        showSecondaryStats:     false,
        primaryCTA:             { label: "Today's Tasks", module: "plan" },
        secondaryCTA:           { label: "Ask Nora", module: "nora" },
        stateLabel:             "Busy",
        stateDescription:       "Focused on what matters most today.",
        stateColor:             "#C49A3C",
      };

    case "financial_pressure":
      return {
        ...base,
        dashboardMode:          "full",
        showGoalsSection:       true,
        showOptimizationNudges: true,
        showDecisionPrompts:    true,
        maxInsightsShown:       3,
        noraGreetingStyle:      "warm_full",
        noraResponseMaxLength:  "full",
        primaryCTA:             { label: "Open CFO", module: "budget" },
        secondaryCTA:           { label: "Ask Nora", module: "nora" },
        stateLabel:             "Budget focus",
        stateDescription:       "Nora's keeping an eye on cash flow.",
        stateColor:             "#5E9AB8",
      };

    case "travel_prep":
      return {
        ...base,
        dashboardMode:          "full",
        showGoalsSection:       true,
        showDecisionPrompts:    false,
        maxInsightsShown:       2,
        noraGreetingStyle:      "energizing",
        primaryCTA:             { label: "Trip Planner", module: "trips" },
        secondaryCTA:           { label: "Check Budget", module: "budget" },
        stateLabel:             "Trip mode",
        stateDescription:       "Getting ready for your upcoming trip.",
        stateColor:             "#4A9E9E",
      };

    case "school_transition":
      return {
        ...base,
        dashboardMode:          "full",
        showGoalsSection:       false,
        maxInsightsShown:       2,
        noraGreetingStyle:      "warm_full",
        primaryCTA:             { label: "School Calendar", module: "calendar" },
        secondaryCTA:           { label: "Budget Check", module: "budget" },
        stateLabel:             "School season",
        stateDescription:       "School events and costs are on Nora's radar.",
        stateColor:             "#8B7EC8",
      };

    case "calm":
      return {
        ...base,
        dashboardMode:          "planning",
        showGoalsSection:       true,
        showInsightsFeed:       true,
        showOptimizationNudges: true,
        showDecisionPrompts:    true,
        maxInsightsShown:       4,
        maxTasksShown:          6,
        noraGreetingStyle:      "energizing",
        noraResponseMaxLength:  "full",
        cardDensity:            "expanded",
        primaryCTA:             { label: "Review Goals", module: "budget" },
        secondaryCTA:           { label: "Plan Ahead", module: "plan" },
        stateLabel:             "Good rhythm",
        stateDescription:       "A great time to plan ahead and optimize.",
        stateColor:             "#6B9E7A",
      };

    case "recovery":
      return {
        ...base,
        dashboardMode:          "planning",
        showGoalsSection:       true,
        showOptimizationNudges: false,  // not yet — still recovering
        showDecisionPrompts:    false,
        maxInsightsShown:       2,
        noraGreetingStyle:      "warm_full",
        noraResponseMaxLength:  "medium",
        primaryCTA:             { label: "Talk to Nora", module: "nora" },
        stateLabel:             "Settling in",
        stateDescription:       "Things are easing up. Good time to reset.",
        stateColor:             "#6B9E7A",
      };

    case "decision_heavy":
      return {
        ...base,
        dashboardMode:          "full",
        showGoalsSection:       true,
        showDecisionPrompts:    true,
        showOptimizationNudges: false,
        maxInsightsShown:       2,
        noraGreetingStyle:      "warm_full",
        noraResponseMaxLength:  "full",
        primaryCTA:             { label: "Ask Nora to help decide", module: "nora" },
        stateLabel:             "Decision mode",
        stateDescription:       "Nora can help you think through priorities.",
        stateColor:             "#8B7EC8",
      };

    default:
      return base;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HOOK
// Use in any screen to get adaptive config
// ═══════════════════════════════════════════════════════════════════

export function useAdaptiveUX(
  snapshot: HouseholdSnapshot | null,
  stateResult?: Partial<HouseholdStateResult> | null
): AdaptiveConfig {
  return useMemo(() => {
    // Use full state result if available
    if (stateResult?.primary) {
      const mode = stateResult.dashboardMode ?? "full";
      return buildConfig(mode, stateResult.primary.state, stateResult);
    }

    // Fall back to snapshot-based state
    if (snapshot) {
      const partialState = computeStateFromSnapshot(snapshot);
      const mode = partialState.dashboardMode ?? "full";
      return buildConfig(mode, partialState.primary?.state ?? "calm", partialState);
    }

    // Default — no data yet
    return buildConfig("full", "calm", {});
  }, [snapshot?.lastRefreshed, stateResult?.primary?.state]);
}

// ═══════════════════════════════════════════════════════════════════
// STATE BANNER PROPS
// Returns props for the state indicator shown at top of dashboard
// ═══════════════════════════════════════════════════════════════════

export interface StateBannerProps {
  show:        boolean;
  label:       string;
  description: string;
  color:       string;
  signals:     string[];
}

export function getStateBannerProps(
  config: AdaptiveConfig,
  stateResult?: Partial<HouseholdStateResult> | null
): StateBannerProps {
  // Only show banner for non-default states
  const showBanner = ["overloaded", "financial_pressure", "travel_prep", "decision_heavy"]
    .includes(stateResult?.primary?.state ?? "");

  return {
    show:        showBanner,
    label:       config.stateLabel,
    description: config.stateDescription,
    color:       config.stateColor,
    signals:     stateResult?.primary?.topSignals ?? [],
  };
}

// ═══════════════════════════════════════════════════════════════════
// INSIGHT FILTER
// Filters insight list based on adaptive config
// ═══════════════════════════════════════════════════════════════════

export function filterInsightsForDisplay<T extends { severity?: string; type?: string; dismissed?: boolean }>(
  insights: T[],
  config: AdaptiveConfig
): T[] {
  return insights
    .filter(i => !i.dismissed)
    .filter(i => {
      if (config.dashboardMode === "relief") {
        // Only high severity in relief mode
        return i.severity === "high" || i.type === "recommendation";
      }
      if (config.dashboardMode === "essentials") {
        return i.severity !== "low";
      }
      return true;
    })
    .slice(0, config.maxInsightsShown);
}

// ═══════════════════════════════════════════════════════════════════
// TASK FILTER
// Filters task list based on adaptive config
// ═══════════════════════════════════════════════════════════════════

export function filterTasksForDisplay<T extends { priority?: string; dueDate?: string; done?: boolean }>(
  tasks: T[],
  config: AdaptiveConfig
): T[] {
  const today = new Date().toISOString().split("T")[0];

  return tasks
    .filter(t => !t.done)
    .filter(t => {
      if (config.dashboardMode === "relief" || config.dashboardMode === "essentials") {
        // Only urgent/overdue tasks
        const isOverdue = t.dueDate && t.dueDate < today;
        const isDueToday = t.dueDate === today;
        const isHighPriority = t.priority === "high";
        return isOverdue || isDueToday || isHighPriority;
      }
      return true;
    })
    .slice(0, config.maxTasksShown);
}

// ═══════════════════════════════════════════════════════════════════
// GREETING GENERATOR
// Returns contextually appropriate greeting based on config
// ═══════════════════════════════════════════════════════════════════

export function getAdaptiveGreeting(
  name: string,
  config: AdaptiveConfig,
  timeOfDay: "morning" | "afternoon" | "evening"
): { headline: string; subline: string } {
  const firstName = name?.split(" ")[0] || "there";

  const timeGreeting = {
    morning:   "Good morning",
    afternoon: "Good afternoon",
    evening:   "Good evening",
  }[timeOfDay];

  switch (config.noraGreetingStyle) {
    case "validating":
      return {
        headline: `${timeGreeting}, ${firstName}.`,
        subline:  config.stateDescription,
      };

    case "warm_brief":
      return {
        headline: `${timeGreeting}, ${firstName}.`,
        subline:  "Here's what matters most today.",
      };

    case "energizing":
      return {
        headline: `${timeGreeting}, ${firstName}! ✦`,
        subline:  config.stateDescription,
      };

    case "warm_full":
    default:
      return {
        headline: `${timeGreeting}, ${firstName}.`,
        subline:  config.stateDescription,
      };
  }
}

// ═══════════════════════════════════════════════════════════════════
// CTA VISIBILITY
// Returns which action buttons to show based on mode
// ═══════════════════════════════════════════════════════════════════

export function getVisibleCTAs(config: AdaptiveConfig): {
  primary:   { label: string; module: string };
  secondary?: { label: string; module: string };
} {
  return {
    primary:   config.primaryCTA,
    secondary: config.secondaryCTA,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ADAPTIVE UX ADDITIONS
// Appended to adaptiveUX.ts
// Fills gaps vs brief:
//   - AdaptiveUXProfile (typed object with cognitiveLoadLevel)
//   - NotificationPolicy (full typed object)
//   - NoraToneProfile (validationLevel + recommendationStyle)
//   - getDashboardLayout (card ordering per state)
//   - Adaptive empty states
//   - explainUXAdaptation
//   - User settings support
// ═══════════════════════════════════════════════════════════════════

// (types already imported above)

// ─── AdaptiveUXProfile ────────────────────────────────────────────

export interface AdaptiveUXProfile {
  householdId:       string;
  activeStates:      HouseholdState[];
  primaryState:      HouseholdState;
  cognitiveLoadLevel: "low" | "medium" | "high";
  dashboardMode:     "standard" | "simplified" | "planning" | "recovery" | "financial_focus" | "travel_focus" | "school_focus";
  insightDensity:    "low" | "medium" | "high";
  notificationMode:  "normal" | "essential_only" | "quiet" | "planning_reminders";
  noraTone:          "calm" | "focused" | "brief" | "supportive" | "analytical" | "encouraging";
  responseLength:    "short" | "medium" | "detailed";
  preferredActions:  AdaptiveAction[];
  suppressedContentTypes: string[];
  updatedAt:         string;
}

export interface AdaptiveAction {
  id:           string;
  label:        string;
  actionType:   "open_module" | "create_task" | "ask_nora" | "review_budget" | "review_calendar" | "start_planning" | "simplify_day" | "schedule_review" | "create_goal";
  targetModule?: string;
  priority:     "low" | "medium" | "high";
  reason:       string;
}

// ─── NotificationPolicy ───────────────────────────────────────────

export interface NotificationPolicy {
  mode:                    "normal" | "essential_only" | "quiet" | "planning_reminders";
  allowedCategories:       string[];
  suppressedCategories:    string[];
  maxNotificationsPerDay:  number;
  quietHours?: { start: string; end: string };
}

const NOTIFICATION_POLICIES: Record<HouseholdState, NotificationPolicy> = {
  overloaded: {
    mode:                   "essential_only",
    allowedCategories:      ["bill_due", "urgent_task", "critical_alert"],
    suppressedCategories:   ["insight", "optimization", "suggestion", "goal_nudge"],
    maxNotificationsPerDay: 2,
  },
  busy: {
    mode:                   "essential_only",
    allowedCategories:      ["bill_due", "urgent_task", "calendar_reminder"],
    suppressedCategories:   ["optimization", "suggestion"],
    maxNotificationsPerDay: 4,
  },
  financial_pressure: {
    mode:                   "normal",
    allowedCategories:      ["bill_due", "budget_alert", "goal_risk", "cashflow"],
    suppressedCategories:   ["non_financial_nudge"],
    maxNotificationsPerDay: 4,
  },
  travel_prep: {
    mode:                   "normal",
    allowedCategories:      ["trip_reminder", "packing", "calendar", "budget"],
    suppressedCategories:   [],
    maxNotificationsPerDay: 5,
  },
  school_transition: {
    mode:                   "normal",
    allowedCategories:      ["school_event", "supply_reminder", "calendar", "bill_due"],
    suppressedCategories:   [],
    maxNotificationsPerDay: 5,
  },
  calm: {
    mode:                   "normal",
    allowedCategories:      ["all"],
    suppressedCategories:   [],
    maxNotificationsPerDay: 8,
  },
  recovery: {
    mode:                   "planning_reminders",
    allowedCategories:      ["goal_nudge", "planning", "reflection"],
    suppressedCategories:   ["urgent_push"],
    maxNotificationsPerDay: 3,
  },
  decision_heavy: {
    mode:                   "normal",
    allowedCategories:      ["decision_prompt", "goal_nudge", "planning"],
    suppressedCategories:   ["non_decision_nudge"],
    maxNotificationsPerDay: 4,
  },
};

export function getNotificationPolicy(state: HouseholdState): NotificationPolicy {
  return NOTIFICATION_POLICIES[state] ?? NOTIFICATION_POLICIES.calm;
}

// ─── NoraToneProfile ──────────────────────────────────────────────

export interface NoraToneProfile {
  tone:                "calm" | "focused" | "brief" | "supportive" | "analytical" | "encouraging";
  maxResponseLength:   "short" | "medium" | "detailed";
  validationLevel:     "none" | "light" | "strong";
  recommendationStyle: "single_next_step" | "options" | "tradeoff_analysis" | "checklist" | "reflection";
}

const TONE_PROFILES: Record<HouseholdState, NoraToneProfile> = {
  overloaded:         { tone: "supportive",   maxResponseLength: "short",    validationLevel: "strong", recommendationStyle: "single_next_step" },
  busy:               { tone: "focused",      maxResponseLength: "medium",   validationLevel: "light",  recommendationStyle: "single_next_step" },
  financial_pressure: { tone: "calm",         maxResponseLength: "medium",   validationLevel: "light",  recommendationStyle: "options" },
  travel_prep:        { tone: "focused",      maxResponseLength: "medium",   validationLevel: "none",   recommendationStyle: "checklist" },
  school_transition:  { tone: "encouraging",  maxResponseLength: "medium",   validationLevel: "light",  recommendationStyle: "checklist" },
  calm:               { tone: "encouraging",  maxResponseLength: "detailed", validationLevel: "none",   recommendationStyle: "options" },
  recovery:           { tone: "encouraging",  maxResponseLength: "medium",   validationLevel: "light",  recommendationStyle: "reflection" },
  decision_heavy:     { tone: "analytical",   maxResponseLength: "detailed", validationLevel: "light",  recommendationStyle: "tradeoff_analysis" },
};

export function getNoraToneProfile(state: HouseholdState): NoraToneProfile {
  return TONE_PROFILES[state] ?? TONE_PROFILES.calm;
}

// ─── Dashboard Layout ─────────────────────────────────────────────

export interface DashboardSection {
  id:       string;
  label:    string;
  priority: number;   // lower = higher up
  visible:  boolean;
  module?:  string;
}

const DASHBOARD_LAYOUTS: Record<HouseholdState, DashboardSection[]> = {
  overloaded: [
    { id: "state_banner",    label: "How you're doing",    priority: 1,  visible: true  },
    { id: "todays_tasks",    label: "Today's Essentials",  priority: 2,  visible: true  },
    { id: "household_pulse", label: "Household Pulse",     priority: 3,  visible: true  },
    { id: "top_insight",     label: "One thing from Nora", priority: 4,  visible: true  },
    { id: "goals",           label: "Goals",               priority: 5,  visible: false },
    { id: "financial_snap",  label: "Finances",            priority: 6,  visible: false },
    { id: "insights_feed",   label: "Insights",            priority: 7,  visible: false },
  ],
  busy: [
    { id: "household_pulse", label: "Household Pulse",     priority: 1,  visible: true  },
    { id: "todays_tasks",    label: "Today",               priority: 2,  visible: true  },
    { id: "top_insight",     label: "Key Insight",         priority: 3,  visible: true  },
    { id: "financial_snap",  label: "Budget",              priority: 4,  visible: true  },
    { id: "goals",           label: "Goals",               priority: 5,  visible: false },
    { id: "insights_feed",   label: "Insights",            priority: 6,  visible: false },
  ],
  financial_pressure: [
    { id: "financial_snap",  label: "Cash Flow",           priority: 1,  visible: true  },
    { id: "household_pulse", label: "Household Pulse",     priority: 2,  visible: true  },
    { id: "goals",           label: "Goals at Risk",       priority: 3,  visible: true  },
    { id: "top_insight",     label: "CFO Insight",         priority: 4,  visible: true  },
    { id: "todays_tasks",    label: "Tasks",               priority: 5,  visible: true  },
    { id: "insights_feed",   label: "Insights",            priority: 6,  visible: true  },
  ],
  travel_prep: [
    { id: "trip_countdown",  label: "Trip Countdown",      priority: 1,  visible: true  },
    { id: "todays_tasks",    label: "Packing & Prep",      priority: 2,  visible: true  },
    { id: "financial_snap",  label: "Travel Budget",       priority: 3,  visible: true  },
    { id: "household_pulse", label: "Household Pulse",     priority: 4,  visible: true  },
    { id: "top_insight",     label: "Travel Insight",      priority: 5,  visible: true  },
    { id: "goals",           label: "Goals",               priority: 6,  visible: false },
  ],
  school_transition: [
    { id: "school_events",   label: "School This Week",    priority: 1,  visible: true  },
    { id: "todays_tasks",    label: "Tasks",               priority: 2,  visible: true  },
    { id: "financial_snap",  label: "School Budget",       priority: 3,  visible: true  },
    { id: "household_pulse", label: "Household Pulse",     priority: 4,  visible: true  },
    { id: "top_insight",     label: "Insight",             priority: 5,  visible: true  },
    { id: "goals",           label: "Goals",               priority: 6,  visible: false },
  ],
  calm: [
    { id: "household_pulse", label: "Household Pulse",     priority: 1,  visible: true  },
    { id: "goals",           label: "Goals",               priority: 2,  visible: true  },
    { id: "financial_snap",  label: "Finances",            priority: 3,  visible: true  },
    { id: "insights_feed",   label: "Insights",            priority: 4,  visible: true  },
    { id: "todays_tasks",    label: "This Week",           priority: 5,  visible: true  },
    { id: "top_insight",     label: "Nora's Pick",         priority: 6,  visible: true  },
  ],
  recovery: [
    { id: "household_pulse", label: "Household Pulse",     priority: 1,  visible: true  },
    { id: "top_insight",     label: "Nora's Suggestion",   priority: 2,  visible: true  },
    { id: "todays_tasks",    label: "Light Tasks",         priority: 3,  visible: true  },
    { id: "goals",           label: "Goals",               priority: 4,  visible: true  },
    { id: "financial_snap",  label: "Finances",            priority: 5,  visible: true  },
    { id: "insights_feed",   label: "Insights",            priority: 6,  visible: false },
  ],
  decision_heavy: [
    { id: "household_pulse", label: "Household Pulse",     priority: 1,  visible: true  },
    { id: "decisions",       label: "Open Decisions",      priority: 2,  visible: true  },
    { id: "top_insight",     label: "Key Insight",         priority: 3,  visible: true  },
    { id: "financial_snap",  label: "Finances",            priority: 4,  visible: true  },
    { id: "goals",           label: "Goals",               priority: 5,  visible: true  },
    { id: "todays_tasks",    label: "Tasks",               priority: 6,  visible: true  },
  ],
};

export function getDashboardLayout(state: HouseholdState): DashboardSection[] {
  return DASHBOARD_LAYOUTS[state] ?? DASHBOARD_LAYOUTS.calm;
}

export function isSectionVisible(sectionId: string, state: HouseholdState): boolean {
  const layout = getDashboardLayout(state);
  const section = layout.find(s => s.id === sectionId);
  return section?.visible ?? true;
}

// ─── Adaptive Empty States ────────────────────────────────────────

export interface AdaptiveEmptyState {
  headline:    string;
  subline:     string;
  ctaLabel?:   string;
  ctaModule?:  string;
}

type EmptyStateContext = "tasks" | "insights" | "goals" | "decisions" | "calendar";

const EMPTY_STATES: Record<HouseholdState, Partial<Record<EmptyStateContext, AdaptiveEmptyState>>> = {
  overloaded: {
    tasks:    { headline: "Nothing urgent right now.",    subline: "Come back later — you have enough on your plate." },
    insights: { headline: "Keeping it simple today.",     subline: "Nora's holding back suggestions while you have a full week." },
    goals:    { headline: "Goals can wait.",              subline: "Focus on getting through this week first." },
  },
  busy: {
    tasks:    { headline: "You're on top of it.",         subline: "No urgent tasks right now.", ctaLabel: "Add a task", ctaModule: "plan" },
    insights: { headline: "All clear.",                   subline: "No new insights at the moment." },
  },
  financial_pressure: {
    tasks:    { headline: "No tasks due.",                subline: "A good time to review your budget.", ctaLabel: "Open CFO", ctaModule: "budget" },
    goals:    { headline: "No goals set yet.",            subline: "Setting a goal can help focus cash flow.", ctaLabel: "Create a goal", ctaModule: "budget" },
    insights: { headline: "No insights yet.",             subline: "Add income and expenses to get CFO insights.", ctaLabel: "Open Budget", ctaModule: "budget" },
  },
  travel_prep: {
    tasks:    { headline: "Packing list is clear.",       subline: "Everything's checked off — great work!", ctaLabel: "View trip", ctaModule: "trips" },
    insights: { headline: "Trip is on track.",            subline: "Nora's watching your travel budget." },
  },
  calm: {
    tasks:    { headline: "You're in a great place.",     subline: "A good time to plan ahead.", ctaLabel: "Set a goal", ctaModule: "budget" },
    insights: { headline: "Nothing to flag right now.",   subline: "Nora will surface patterns as they emerge.", ctaLabel: "Generate insights", ctaModule: "home" },
    goals:    { headline: "No goals yet.",                subline: "This is a great time to set one.", ctaLabel: "Create a goal", ctaModule: "budget" },
    decisions: { headline: "No open decisions.",         subline: "Ask Nora to help think through anything on your mind.", ctaLabel: "Ask Nora", ctaModule: "nora" },
  },
  recovery: {
    tasks:    { headline: "Taking it easy.",              subline: "No tasks due — a good time to rest and reset." },
    insights: { headline: "Keeping things light.",        subline: "Nora will start surfacing insights as things settle." },
  },
  school_transition: {
    tasks:    { headline: "School prep is on track.",     subline: "No urgent school tasks right now." },
    insights: { headline: "School season is underway.",   subline: "Nora's watching school expenses and calendar." },
  },
  decision_heavy: {
    decisions: { headline: "No open decisions.",         subline: "Ask Nora to help you think through anything.", ctaLabel: "Ask Nora", ctaModule: "nora" },
    tasks:     { headline: "Tasks are clear.",            subline: "Good time to focus on a decision.", ctaLabel: "Talk to Nora", ctaModule: "nora" },
  },
};

export function getEmptyState(
  context: EmptyStateContext,
  state: HouseholdState
): AdaptiveEmptyState {
  return EMPTY_STATES[state]?.[context] ?? {
    headline: "Nothing here yet.",
    subline:  "Check back soon.",
  };
}

// ─── Full AdaptiveUXProfile builder ──────────────────────────────

export function generateAdaptiveUXProfile(
  householdId: string,
  stateResult: Partial<HouseholdStateResult>
): AdaptiveUXProfile {
  const primaryState = stateResult.primary?.state ?? "calm";
  const activeStates = (stateResult.active ?? [stateResult.primary]).filter(Boolean).map(s => s!.state);

  const cognitiveLoad: AdaptiveUXProfile["cognitiveLoadLevel"] =
    primaryState === "overloaded" ? "high" :
    ["busy", "financial_pressure", "decision_heavy"].includes(primaryState) ? "medium" : "low";

  const dashboardModeMap: Record<HouseholdState, AdaptiveUXProfile["dashboardMode"]> = {
    overloaded:         "simplified",
    busy:               "simplified",
    financial_pressure: "financial_focus",
    travel_prep:        "travel_focus",
    school_transition:  "school_focus",
    calm:               "planning",
    recovery:           "recovery",
    decision_heavy:     "planning",
  };

  const insightDensityMap: Record<HouseholdState, AdaptiveUXProfile["insightDensity"]> = {
    overloaded: "low", busy: "low", financial_pressure: "medium",
    travel_prep: "medium", school_transition: "medium",
    calm: "high", recovery: "medium", decision_heavy: "medium",
  };

  const toneProfile = getNoraToneProfile(primaryState);
  const notifPolicy = getNotificationPolicy(primaryState);

  const suppressedContent: string[] = [];
  if (primaryState === "overloaded") suppressedContent.push("optimization_tip", "non_urgent_insight", "long_form_analysis", "goal_nudge");
  if (primaryState === "busy")       suppressedContent.push("optimization_tip", "long_form_analysis");

  const preferredActions: AdaptiveAction[] = getDashboardLayout(primaryState)
    .filter(s => s.visible && s.module)
    .slice(0, 3)
    .map((s, i) => ({
      id:          `action_${i}`,
      label:       s.label,
      actionType:  "open_module" as const,
      targetModule: s.module,
      priority:    i === 0 ? "high" : "medium" as const,
      reason:      `${primaryState} state prioritizes ${s.label.toLowerCase()}`,
    }));

  return {
    householdId,
    activeStates,
    primaryState,
    cognitiveLoadLevel:     cognitiveLoad,
    dashboardMode:          dashboardModeMap[primaryState] ?? "standard",
    insightDensity:         insightDensityMap[primaryState] ?? "medium",
    notificationMode:       notifPolicy.mode,
    noraTone:               toneProfile.tone,
    responseLength:         toneProfile.maxResponseLength,
    preferredActions,
    suppressedContentTypes: suppressedContent,
    updatedAt:              new Date().toISOString(),
  };
}

// ─── Content suppression helper ───────────────────────────────────

export function suppressContent(
  contentType: string,
  profile: AdaptiveUXProfile
): boolean {
  return profile.suppressedContentTypes.includes(contentType);
}

// ─── Explainability ───────────────────────────────────────────────

export function explainUXAdaptation(
  profile: AdaptiveUXProfile,
  stateResult?: Partial<HouseholdStateResult>
): string {
  const signals = stateResult?.primary?.topSignals ?? [];
  const state = profile.primaryState.replace("_", " ");

  const explanations: Record<string, string> = {
    overloaded:         "HerNest simplified your dashboard because your schedule and tasks are both elevated right now.",
    busy:               "HerNest is showing only the essentials because you have a full week ahead.",
    financial_pressure: "HerNest is highlighting cash flow and bills because budget pressure is elevated.",
    travel_prep:        "HerNest is focused on your upcoming trip — packing, budget, and logistics.",
    school_transition:  "HerNest is surfacing school events and expenses this week.",
    calm:               "Your household is in a steady rhythm — a good time for planning and goals.",
    recovery:           "Things are settling down. HerNest is keeping it light while you reset.",
    decision_heavy:     "You have several priorities competing right now. Nora can help you think through them.",
  };

  const base = explanations[profile.primaryState] ?? `HerNest is in ${state} mode.`;
  const signalNote = signals.length ? ` Key signals: ${signals.slice(0, 2).join(", ")}.` : "";
  return base + signalNote;
}

// ─── User settings support ────────────────────────────────────────

export interface AdaptiveUXUserSettings {
  adaptiveExperienceEnabled: boolean;
  insightDensity:            "low" | "medium" | "high" | "auto";
  noraResponseLength:        "short" | "medium" | "detailed" | "auto";
  notificationMode:          "normal" | "quiet" | "essential_only" | "auto";
}

export const DEFAULT_ADAPTIVE_SETTINGS: AdaptiveUXUserSettings = {
  adaptiveExperienceEnabled: true,
  insightDensity:            "auto",
  noraResponseLength:        "auto",
  notificationMode:          "auto",
};

export function applyUserSettings(
  profile: AdaptiveUXProfile,
  settings: AdaptiveUXUserSettings
): AdaptiveUXProfile {
  if (!settings.adaptiveExperienceEnabled) {
    // User opted out — return neutral defaults
    return {
      ...profile,
      dashboardMode:          "standard",
      insightDensity:         "medium",
      notificationMode:       "normal",
      noraTone:               "calm",
      responseLength:         "medium",
      suppressedContentTypes: [],
    };
  }

  return {
    ...profile,
    insightDensity:   settings.insightDensity   !== "auto" ? settings.insightDensity   : profile.insightDensity,
    responseLength:   settings.noraResponseLength !== "auto" ? settings.noraResponseLength : profile.responseLength,
    notificationMode: settings.notificationMode !== "auto" ? settings.notificationMode : profile.notificationMode,
  };
}
