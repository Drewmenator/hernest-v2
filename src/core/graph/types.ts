// ─── HerNest Household Context Graph — Types ─────────────────────
// src/core/graph/types.ts
//
// Every node and edge in the household intelligence graph.
// Matches the HerNest Context Graph design brief exactly.
// The graph answers: "What is happening in this household,
// how is it connected, and what should Nora understand
// before giving advice?"

// ═══════════════════════════════════════════════════════════════════
// ENUMS AND UNION TYPES
// ═══════════════════════════════════════════════════════════════════

export type RelationshipType =
  | "causes"           // A causes B (busy week causes food delivery spike)
  | "contributes_to"   // A contributes to B (stress contributes to overspending)
  | "depends_on"       // A depends on B (trip goal depends on monthly savings)
  | "conflicts_with"   // A conflicts with B (debt payment conflicts with vacation goal)
  | "supports"         // A supports B (routine supports wellness goal)
  | "belongs_to"       // A belongs to B (therapy appointment belongs to child)
  | "recurs_with"      // A recurs with B (school fees recur with school term)
  | "impacts";         // A impacts B (calendar load impacts budget adherence)

export type NodeType =
  | "person"
  | "financial"
  | "calendar"
  | "routine"
  | "goal"
  | "stress"
  | "decision"
  | "memory"
  | "insight"
  | "event"
  | "trip";

export type HouseholdModule =
  | "budget" | "calendar" | "nora" | "trips"
  | "thrive" | "family" | "circle" | "plan" | "home";

export type GoalCategory =
  | "finance" | "wellness" | "family" | "trip"
  | "school" | "home" | "debt_payoff" | "other";

export type GoalStatus = "not_started" | "in_progress" | "on_track" | "at_risk" | "off_track" | "achieved";

export type MemoryType =
  | "preference"        // stated or inferred user preference
  | "pattern"           // detected behavioral pattern
  | "fact"              // verified household fact
  | "decision"          // past decision recorded
  | "warning"           // risk flag to watch
  | "routine"           // established routine
  | "financial_pattern" // spending or saving pattern
  | "stress_pattern"    // stress trigger pattern
  | "seasonal_pattern"; // time-of-year pattern

export type InsightType =
  | "financial" | "schedule" | "wellness" | "planning" | "opportunity" | "risk";

export type InsightSeverity = "info" | "watch" | "alert" | "critical";

// ═══════════════════════════════════════════════════════════════════
// BASE NODE
// ═══════════════════════════════════════════════════════════════════

export interface BaseNode {
  id: string;
  type: NodeType;
  createdAt: string;
  updatedAt: string;
  sourceModule: HouseholdModule;
  confidence: number;      // 0–1: reliability of this node's data
  tags: string[];
  expiresAt?: string;      // optional TTL for temporary context
}

// ═══════════════════════════════════════════════════════════════════
// 1. PERSON
// From brief: id, name, role, ageGroup, preferences,
//             responsibilities, routines, relatedGoals, stressTriggers
// ═══════════════════════════════════════════════════════════════════

export interface Person extends BaseNode {
  type: "person";
  name: string;
  role: "primary" | "partner" | "child" | "caregiver" | "parent" | "other";
  ageGroup: "infant" | "toddler" | "child" | "teen" | "adult" | "senior";
  isUser: boolean;

  preferences: {
    planningDay?: string;           // "Sunday" — prefers Sunday planning
    energyPattern?: "morning" | "evening" | "variable";
    communicationStyle?: "direct" | "gentle" | "detailed";
    diet?: string;
    other?: string[];
  };

  responsibilities: string[];       // ["manages finances", "school pickups", "meal planning"]
  routines: string[];               // ["gym Mon/Wed/Fri", "therapy Tuesdays"]
  relatedGoalIds: string[];         // goal node ids this person owns or is linked to
  stressTriggers: string[];         // ["financial pressure", "school deadlines", "social overload"]

  schoolInfo?: {
    schoolName?: string;
    grade?: string;
    therapySchedule?: string;       // "Tuesdays 4pm"
    termDates?: Array<{ term: string; start: string; end: string }>;
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. FINANCIAL CONTEXT
// From brief: income, fixedExpenses, variableExpenses, debts,
//             goals, subscriptions, upcomingObligations, spendingPatterns
// ═══════════════════════════════════════════════════════════════════

export interface FinancialContext extends BaseNode {
  type: "financial";
  subtype:
    | "monthly_summary"
    | "expense"
    | "income_source"
    | "debt"
    | "subscription"
    | "upcoming_obligation"
    | "spending_pattern"
    | "health_score";

  // ── Monthly summary ───────────────────────────────────────────
  monthlyIncome?: number;
  fixedExpenses?: number;          // rent, loan minimums, subscriptions
  variableExpenses?: number;       // groceries, dining, entertainment
  totalBudget?: number;
  totalSpent?: number;
  cashRemaining?: number;
  savingsRate?: number;
  projectedMonthEnd?: number;
  totalDebt?: number;
  debtToIncomeRatio?: number;

  // ── Per-item fields ───────────────────────────────────────────
  label?: string;                  // "Gym membership", "Car loan"
  amount?: number;
  category?: string;
  merchant?: string;
  frequency?: "weekly" | "biweekly" | "monthly" | "annual" | "one-time" | "irregular";
  isFixed?: boolean;
  isEssential?: boolean;
  dueDate?: string;

  // ── Debt-specific ─────────────────────────────────────────────
  balance?: number;
  apr?: number;
  minimumPayment?: number;
  payoffDate?: string;

  // ── Subscription tracking ─────────────────────────────────────
  subscriptions?: Array<{
    name: string;
    amount: number;
    lastReviewed?: string;
    isActive: boolean;
  }>;

  // ── Upcoming obligations (school fees, trips, events) ─────────
  upcomingObligations?: Array<{
    description: string;
    estimatedCost: number;
    date: string;
    linkedNodeId?: string;         // calendar or goal node id
    category: string;
  }>;

  // ── Spending patterns ─────────────────────────────────────────
  spendingPatterns?: Array<{
    category: string;
    pattern: string;               // "increases during school breaks"
    triggerNodeId?: string;        // what causes this pattern
    averageAmount?: number;
  }>;

  // ── Month-over-month trend ────────────────────────────────────
  previousMonthAmount?: number;
  percentageChange?: number;       // +34 = up 34%
  trendRiskLevel?: "low" | "medium" | "high";

  // ── Health score ──────────────────────────────────────────────
  score?: number;
  grade?: "A" | "B" | "C" | "D" | "F" | "—";
}

// ═══════════════════════════════════════════════════════════════════
// 3. CALENDAR CONTEXT
// From brief: events, recurringEvents, schoolEvents,
//             appointments, travelDates, highLoadDays
// ═══════════════════════════════════════════════════════════════════

export interface CalendarContext extends BaseNode {
  type: "calendar";
  subtype:
    | "load_assessment"
    | "event"
    | "recurring_event"
    | "school_event"
    | "appointment"
    | "travel_block"
    | "high_load_day";

  // ── Load assessment ───────────────────────────────────────────
  loadLevel?: "light" | "normal" | "heavy" | "critical";
  busyWeeksAhead?: number;
  eventsThisWeek?: number;
  highLoadDays?: string[];         // YYYY-MM-DD dates that are extremely busy

  // ── Event fields ──────────────────────────────────────────────
  title?: string;
  date?: string;
  endDate?: string;
  time?: string;
  allDay?: boolean;
  location?: string;
  forPersonId?: string;            // person node id
  isRecurring?: boolean;
  recurrenceRule?: string;         // "weekly", "monthly", "every Tuesday"

  // ── Financial implication ─────────────────────────────────────
  estimatedCost?: number;
  requiresBudgetAdjustment?: boolean;
  linkedGoalId?: string;           // goal this event is working toward

  // ── School-specific ───────────────────────────────────────────
  requiresParentAction?: boolean;
  actionType?: "permission_slip" | "payment" | "rsvp" | "supplies" | "costume" | "volunteer";
  actionDeadline?: string;
}

// ═══════════════════════════════════════════════════════════════════
// 4. ROUTINE CONTEXT
// From brief: recurringTasks, chores, familyResponsibilities,
//             missedTasks, bottlenecks
// ═══════════════════════════════════════════════════════════════════

export interface RoutineContext extends BaseNode {
  type: "routine";
  name: string;
  description?: string;
  category: "wellness" | "household" | "financial" | "family" | "work" | "school";
  ownerPersonId?: string;          // person node id

  frequency: "daily" | "weekly" | "monthly" | "school_term" | "as_needed";
  preferredDay?: string;           // "Sunday", "Monday"
  preferredTime?: string;          // "morning", "evening", "7pm"

  recurringTasks: string[];        // ["plan meals", "prep lunches", "check homework"]
  chores: string[];                // ["laundry", "dishwasher", "vacuum"]
  familyResponsibilities: string[]; // ["school pickup", "therapy drop-off"]

  // ── Completion tracking ───────────────────────────────────────
  lastCompleted?: string;
  streakDays?: number;
  missedCount?: number;            // consecutive misses — feeds stress detection
  completionRate?: number;         // 0–1 over last 30 days

  // ── Bottleneck detection ──────────────────────────────────────
  bottlenecks: string[];           // ["meal planning skipped → grocery spike", "bill reminder missed"]
  missedConsequences: string[];    // ["food delivery spend increases", "late payment risk"]

  // ── Financial cost ────────────────────────────────────────────
  monthlyCost?: number;            // gym, cleaner, subscription linked to routine
}

// ═══════════════════════════════════════════════════════════════════
// 5. GOAL
// From brief: id, title, category, targetDate, targetAmount?,
//             owner, priority, status, linkedEvents, linkedTasks, linkedMoney
// ═══════════════════════════════════════════════════════════════════

export interface Goal extends BaseNode {
  type: "goal";
  title: string;
  category: GoalCategory;
  ownerPersonId?: string;          // null = household goal
  priority: "low" | "medium" | "high" | "critical";
  status: GoalStatus;

  // ── Financial goals ───────────────────────────────────────────
  targetAmount?: number;
  currentAmount?: number;
  monthlyContribution?: number;
  requiredMonthlyContribution?: number; // what's needed to hit deadline

  // ── All goals ─────────────────────────────────────────────────
  targetDate?: string;
  targetDescription?: string;      // non-financial: "Run 5km"
  milestones?: Array<{ label: string; date?: string; achieved: boolean }>;

  // ── Links to other nodes (the graph connections) ──────────────
  linkedEventIds: string[];        // calendar events working toward this goal
  linkedTaskIds: string[];         // tasks required to achieve this goal
  linkedFinancialNodeIds: string[]; // income/expense/debt nodes that affect this goal

  riskStatus: "on_track" | "at_risk" | "off_track" | "achieved";
  riskReason?: string;             // "monthly contribution below required amount"
}

// ═══════════════════════════════════════════════════════════════════
// 6. HOUSEHOLD STRESS CONTEXT
// From brief: stressLevel, stressSources, overloadDays,
//             emotionalSignals, schedulePressure, financialPressure, taskBacklog
// The key differentiator — lets Nora say:
// "This looks less like overspending and more like a capacity problem."
// ═══════════════════════════════════════════════════════════════════

export interface HouseholdStressContext extends BaseNode {
  type: "stress";
  level: "low" | "moderate" | "high" | "critical";

  stressSources: StressSource[];
  overloadDays: string[];           // YYYY-MM-DD dates of peak stress
  emotionalSignals: string[];       // ["irritability reported", "low mood logged 3 days"]

  // ── Component pressures ───────────────────────────────────────
  schedulePressure: "low" | "moderate" | "high";   // from calendar load
  financialPressure: "low" | "moderate" | "high";  // from budget status
  taskBacklog: number;                              // count of overdue tasks
  missedRoutineCount: number;                       // feeds pattern detection

  // ── Combined stress pattern ───────────────────────────────────
  // When calendar overload + high spending + missed routines = stress pattern
  // This is what Nora uses to reframe financial advice as capacity advice
  isCapacityProblem: boolean;        // true = reframe as load problem, not willpower
  capacityInsight?: string;          // "3 heavy weeks + budget pressure + 4 missed routines"

  period: { start: string; end?: string };
  resolvedAt?: string;
}

export interface StressSource {
  source: HouseholdModule;
  signal: string;                   // "7 events this week", "3 overdue tasks"
  weight: number;                   // 0–1: contribution to overall stress
  linkedNodeId?: string;            // the node that generated this signal
  detectedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// 7. HOUSEHOLD DECISION
// From brief: id, question, options, criteria, tradeoffs,
//             assumptions, uncertainty, recommendation, confidence, outcome
// The DQ moat: structured decision records that connect to
// money + calendar + goals + family stress + prior preferences
// ═══════════════════════════════════════════════════════════════════

export interface HouseholdDecision extends BaseNode {
  type: "decision";
  question: string;
  context: string;                  // situation summary at time of decision

  // ── Decision Quality structure ────────────────────────────────
  options: DecisionOption[];
  criteria: string[];               // ["affordability", "timing", "family impact"]
  tradeoffs: string[];              // explicit tradeoffs surfaced
  assumptions: string[];           // what the analysis assumed
  uncertainty: "low" | "medium" | "high";  // how unknown the situation was

  // ── Result ────────────────────────────────────────────────────
  recommendation: string;
  confidence: number;               // 0–1
  riskLevel: "low" | "medium" | "high";
  suggestedFollowUpQuestions: string[];
  nextSteps: string[];

  // ── Tracking ──────────────────────────────────────────────────
  chosenOptionId?: string;          // which option was selected
  outcome?: string;                 // filled in later
  reviewDate?: string;              // when to check outcome

  // ── Links ────────────────────────────────────────────────────
  affectedModules: HouseholdModule[];
  relatedNodeIds: string[];         // money + calendar + goal nodes that informed this
  madeByPersonId?: string;
}

export interface DecisionOption {
  id: string;
  label: string;
  financialImpact?: string;
  tradeoffs: string[];
  recommended: boolean;
  confidenceScore?: number;
}

// ═══════════════════════════════════════════════════════════════════
// 8. MEMORY
// From brief: id, type, content, confidence, sourceModule,
//             lastConfirmedAt, expiresAt, linkedEntities
// Structured memory — not random chat history.
// ═══════════════════════════════════════════════════════════════════

export interface Memory extends BaseNode {
  type: "memory";
  memoryType: MemoryType;
  content: string;                  // plain text — injected into AI prompts

  // ── Quality signals ───────────────────────────────────────────
  confidenceScore: number;          // 0–1, increases with reinforcement
  reinforcedCount: number;          // how many times confirmed
  lastConfirmedAt?: string;

  // ── Scope ────────────────────────────────────────────────────
  forPersonId?: string;             // null = household-level memory
  sourceModule: HouseholdModule;

  // ── Links ────────────────────────────────────────────────────
  linkedEntityIds: string[];        // node ids this memory relates to

  // Examples of typed memories:
  // preference: "User prefers calm, direct recommendations"
  // pattern: "Family overspends during travel prep months"
  // fact: "School expenses rise every August"
  // decision: "Chose to delay vacation by 6 weeks in March 2025"
  // warning: "Dining spend spikes during overloaded calendar weeks"
  // seasonal_pattern: "Back-to-school months are highest spend months"
}

// ═══════════════════════════════════════════════════════════════════
// 9. INSIGHT
// From brief: id, type, severity, observation, whyItMatters,
//             recommendation, confidence, relatedNodes
// Generated from the graph — not from a single module.
// ═══════════════════════════════════════════════════════════════════

export interface Insight extends BaseNode {
  type: "insight";
  insightType: InsightType;
  severity: InsightSeverity;

  // ── Content (per brief format) ────────────────────────────────
  observation: string;              // "Calendar load is high next week"
  whyItMatters: string;             // "Delivery spending usually increases during high-load weeks"
  options: string[];                // choices available to the household
  recommendation: string;           // "Pre-plan meals by Sunday"
  nextSteps: string[];
  followUpQuestions: string[];

  // ── Quality ───────────────────────────────────────────────────
  confidenceLevel: number;          // 0–100
  confidenceLabel: "low" | "medium" | "high";

  // ── Graph provenance ──────────────────────────────────────────
  relatedNodeIds: string[];         // nodes that produced this insight
  sourceModules: HouseholdModule[];
  crossModulePattern: boolean;      // true if this crosses ≥2 modules

  // ── Lifecycle ────────────────────────────────────────────────
  dismissed: boolean;
  actedOn: boolean;
  savedToMemory: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// 10. CONTEXT RELATIONSHIP (EDGE)
// ═══════════════════════════════════════════════════════════════════

export interface ContextRelationship {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: RelationshipType;
  strength: number;                 // 0–1: how strong is this relationship
  evidence: string[];               // data points that support this edge
  description: string;              // human-readable explanation
  detectedAt: string;
  confirmedCount: number;           // how many times observed
  lastConfirmed?: string;
  sourceModule: HouseholdModule;
  isInferred: boolean;              // true = AI-detected, false = rule-based
}

// ═══════════════════════════════════════════════════════════════════
// 11. HOUSEHOLD CONTEXT GRAPH
// The complete structure. Every module reads from and writes to this.
// ═══════════════════════════════════════════════════════════════════

export interface HouseholdContextGraph {
  householdId: string;              // Firebase uid
  version: number;
  lastUpdated: string;

  // ── Core collections (flat arrays per brief) ──────────────────
  people: Person[];
  finances: FinancialContext[];     // all financial nodes
  calendar: CalendarContext[];      // all calendar nodes
  tasks: RoutineContext[];          // all routine/task nodes
  goals: Goal[];
  stress: HouseholdStressContext;   // single current stress context
  decisions: HouseholdDecision[];
  memories: Memory[];
  insights: Insight[];

  // ── Relationships (the power of the graph) ────────────────────
  relationships: ContextRelationship[];

  // ── Fast lookup maps ──────────────────────────────────────────
  // nodeId → node (for O(1) edge traversal)
  nodeIndex: Record<string, GraphNode>;

  // ── Meta ─────────────────────────────────────────────────────
  lastInsightGeneratedAt?: string;
  primaryUserId?: string;
}

// ── Union type for all nodes ──────────────────────────────────────
export type GraphNode =
  | Person
  | FinancialContext
  | CalendarContext
  | RoutineContext
  | Goal
  | HouseholdStressContext
  | HouseholdDecision
  | Memory
  | Insight;

// ═══════════════════════════════════════════════════════════════════
// CONTEXT PACK TYPES (AI input structs)
// ═══════════════════════════════════════════════════════════════════

export interface NoraContextPack {
  householdProfile: {
    primaryUser: string;
    familyMembers: Array<{ name: string; role: string; age?: string; routines?: string[] }>;
    stage: string;
    stressTriggers: string[];
  };
  financialSummary: {
    monthlyIncome: number;
    cashRemaining: number;
    savingsRate: number;
    totalDebt: number;
    healthGrade: string;
    topOverspendCategories: string[];
    subscriptionTotal?: number;
    upcomingObligations: Array<{ description: string; estimatedCost: number; date: string }>;
  };
  calendarSummary: {
    loadLevel: string;
    busyWeeksAhead: number;
    upcomingEvents: string[];
    highLoadDays: string[];
    appointmentsThisWeek: string[];
  };
  activeGoals: Array<{
    title: string;
    category: string;
    riskStatus: string;
    daysToDeadline?: number;
    linkedEvents: string[];
  }>;
  stressContext: {
    level: string;
    isCapacityProblem: boolean;
    capacityInsight?: string;
    activeSignals: string[];
    schedulePressure: string;
    financialPressure: string;
    taskBacklog: number;
  };
  routineHealth: {
    missedRoutines: string[];
    activeBottlenecks: string[];
  };
  recentDecisions: Array<{ question: string; recommendation: string; outcome?: string }>;
  relevantMemories: string[];
  activeInsights: Array<{ observation: string; recommendation: string; severity: string }>;
  crossModulePatterns: string[];
}

export interface CFOContextPack {
  financialSnapshot: {
    monthlyIncome: number;
    fixedExpenses: number;
    variableExpenses: number;
    totalBudget: number;
    totalSpent: number;
    cashRemaining: number;
    savingsRate: number;
    totalDebt: number;
    debtToIncomeRatio: number;
    projectedMonthEnd: number;
    healthScore: number;
    healthGrade: string;
  };
  spendingPatterns: Array<{
    category: string;
    pattern: string;
    currentAmount: number;
    previousAmount: number;
    percentageChange: number;
    riskLevel: string;
    triggerContext?: string;
  }>;
  subscriptions: Array<{ name: string; amount: number; isActive: boolean }>;
  goals: Array<{
    title: string;
    category: string;
    targetAmount?: number;
    currentAmount?: number;
    requiredMonthlyContribution?: number;
    monthlyContribution?: number;
    riskStatus: string;
    daysToDeadline?: number;
    linkedEvents: string[];
  }>;
  debts: Array<{
    label: string;
    balance: number;
    apr: number;
    minimumPayment: number;
    payoffDate?: string;
  }>;
  upcomingObligations: Array<{
    description: string;
    estimatedCost: number;
    date: string;
    category: string;
    linkedNodeId?: string;
  }>;
  calendarPressure: {
    loadLevel: string;
    financialRisk: string;
    highLoadDays: string[];
  };
  stressPressure: {
    level: string;
    isCapacityProblem: boolean;
    financialPressure: string;
  };
  recentDecisions: Array<{ question: string; outcome?: string }>;
  crossModuleRisks: string[];
  complianceNote: string;
}

// ── Module event payload ──────────────────────────────────────────
export interface ModuleEvent {
  type: string;
  source: HouseholdModule;
  userId: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ── Pattern detection result ──────────────────────────────────────
export interface DetectedPattern {
  id: string;
  description: string;
  fromNodeType: NodeType;
  toNodeType: NodeType;
  relationshipType: RelationshipType;
  strength: number;
  evidenceCount: number;
  evidence: string[];
  suggestedRelationship: Omit<ContextRelationship, "id" | "detectedAt" | "confirmedCount" | "lastConfirmed">;
  actionable: boolean;
  suggestedInsight?: Omit<Insight, "id" | "createdAt" | "updatedAt" | "sourceModule" | "confidence" | "tags" | "dismissed" | "actedOn" | "savedToMemory">;
}

// ── Explanation output ────────────────────────────────────────────
export interface RecommendationExplanation {
  recommendation: string;
  reasoning: string[];
  dataPoints: Array<{
    nodeId: string;
    nodeType: NodeType;
    contribution: string;
  }>;
  relationships: Array<{
    from: string;
    to: string;
    type: RelationshipType;
    description: string;
  }>;
  confidence: number;
  assumptions: string[];
  limitations: string[];
}
