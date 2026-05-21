// ─── HerNest Recommendation Actions Layer ────────────────────────
// Converts AI recommendations into concrete app actions.
// Moves HerNest from advice → execution.
//
// Core rules:
//   1. AI proposes actions — never silently executes important ones
//   2. Destructive/sensitive actions require confirmation
//   3. Financial actions never move money
//   4. All actions are explainable and trackable
//   5. Failed actions fail gracefully — never crash UI
//   6. Completed actions emit events + update memory

import { saveData, loadData } from "./firebase";
import { bus } from "./events";
import { proposeMemory } from "./memoryServiceV2";
import { invalidateCache } from "./contextRetrieval";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type ActionType =
  | "create_task"
  | "create_goal"
  | "adjust_budget"
  | "create_budget_category"
  | "schedule_review"
  | "create_calendar_event"
  | "move_task"
  | "snooze_insight"
  | "dismiss_insight"
  | "open_module"
  | "start_decision"
  | "update_decision"
  | "create_trip_checklist"
  | "create_memory_confirmation"
  | "ask_cleo_followup";

export type ActionSource =
  | "cleo_chat"
  | "household_cfo"
  | "insight_engine"
  | "decision_engine"
  | "morning_briefing"
  | "wellness_coach"
  | "state_engine";

export type ActionStatus =
  | "pending"
  | "confirmed"
  | "executing"
  | "completed"
  | "dismissed"
  | "snoozed"
  | "failed"
  | "expired";

export type ActionRiskLevel = "low" | "medium" | "high";

export interface RecommendedAction {
  id:                  string;
  label:               string;
  description:         string;
  actionType:          ActionType;
  source:              ActionSource;
  sourceId?:           string;       // insight id, decision id, etc.
  targetModule?:       string;
  payload:             Record<string, unknown>;
  priority:            "low" | "medium" | "high";
  riskLevel:           ActionRiskLevel;
  requiresConfirmation: boolean;
  status:              ActionStatus;
  createdAt:           string;
  expiresAt?:          string;
  completedAt?:        string;
  dismissedAt?:        string;
  failureReason?:      string;
  explanation:         string;       // "Why Cleo suggested this"
}

export interface ActionExecutionResult {
  success:     boolean;
  actionId:    string;
  message:     string;
  sideEffects?: string[];  // what changed
  error?:      string;
}

// ═══════════════════════════════════════════════════════════════════
// ACTION BUILDERS
// Convert AI outputs into typed action objects
// ═══════════════════════════════════════════════════════════════════

// ── From Insight ─────────────────────────────────────────────────
export function createActionsFromInsight(insight: {
  id: string;
  observation: string;
  recommendation: string;
  category: string;
  sourceModules?: string[];
}): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Primary: ask Cleo to expand
  actions.push({
    id:                  crypto.randomUUID(),
    label:               "Ask Cleo about this",
    description:         `Get Cleo's detailed take on: ${insight.observation}`,
    actionType:          "ask_cleo_followup",
    source:              "insight_engine",
    sourceId:            insight.id,
    targetModule:        "cleo",
    payload:             { prefillMessage: `Tell me more about this insight: ${insight.recommendation}` },
    priority:            "medium",
    riskLevel:           "low",
    requiresConfirmation: false,
    status:              "pending",
    createdAt:           now,
    expiresAt:           expires,
    explanation:         `Based on: ${insight.observation}`,
  });

  // Category-specific actions
  if (insight.category === "spending" || insight.category === "cashflow") {
    actions.push({
      id:                  crypto.randomUUID(),
      label:               "Review Budget",
      description:         "Open the Financial Hub to review spending",
      actionType:          "open_module",
      source:              "insight_engine",
      sourceId:            insight.id,
      targetModule:        "budget",
      payload:             { tab: "overview" },
      priority:            "medium",
      riskLevel:           "low",
      requiresConfirmation: false,
      status:              "pending",
      createdAt:           now,
      expiresAt:           expires,
      explanation:         insight.recommendation,
    });
  }

  if (insight.category === "savings" || insight.category === "debt") {
    actions.push({
      id:                  crypto.randomUUID(),
      label:               "Open CFO",
      description:         "Analyze this with the Household CFO",
      actionType:          "open_module",
      source:              "insight_engine",
      sourceId:            insight.id,
      targetModule:        "budget",
      payload:             { tab: "cfo" },
      priority:            "medium",
      riskLevel:           "low",
      requiresConfirmation: false,
      status:              "pending",
      createdAt:           now,
      expiresAt:           expires,
      explanation:         insight.recommendation,
    });
  }

  if (insight.category === "stress" || insight.category === "scheduling") {
    actions.push({
      id:                  crypto.randomUUID(),
      label:               "Simplify today",
      description:         "Create a focused task list for today only",
      actionType:          "create_task",
      source:              "insight_engine",
      sourceId:            insight.id,
      targetModule:        "plan",
      payload:             { title: "Today's focus list", priority: "high", note: "Simplified from Cleo's insight" },
      priority:            "high",
      riskLevel:           "low",
      requiresConfirmation: false,
      status:              "pending",
      createdAt:           now,
      expiresAt:           expires,
      explanation:         insight.recommendation,
    });
  }

  return actions;
}

// ── From CFO Response ─────────────────────────────────────────────
export function createActionsFromCFOResponse(cfoResponse: {
  recommendation: string;
  nextSteps?: Array<{ label: string; actionType: string; priority: string }>;
  riskLevel?: string;
  sourceId?: string;
}): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  // Map CFO next steps to actions
  for (const step of cfoResponse.nextSteps ?? []) {
    const actionType = ({
      create_goal:      "create_goal",
      adjust_budget:    "adjust_budget",
      review_spending:  "open_module",
      delay_decision:   "start_decision",
      create_task:      "create_task",
      schedule_review:  "schedule_review",
    } as Record<string, ActionType>)[step.actionType] ?? "open_module";

    const requiresConfirmation = ["adjust_budget", "create_goal"].includes(actionType);

    actions.push({
      id:                  crypto.randomUUID(),
      label:               step.label,
      description:         cfoResponse.recommendation,
      actionType,
      source:              "household_cfo",
      sourceId:            cfoResponse.sourceId,
      targetModule:        actionType === "open_module" ? "budget" : undefined,
      payload:             { fromCFO: true, recommendation: cfoResponse.recommendation },
      priority:            (step.priority as RecommendedAction["priority"]) ?? "medium",
      riskLevel:           (cfoResponse.riskLevel as ActionRiskLevel) ?? "medium",
      requiresConfirmation,
      status:              "pending",
      createdAt:           now,
      expiresAt:           expires,
      explanation:         `CFO recommendation: ${cfoResponse.recommendation}`,
    });
  }

  // Always add Ask Cleo followup
  actions.push({
    id:                  crypto.randomUUID(),
    label:               "Ask Cleo a follow-up",
    description:         "Dig deeper into this financial analysis",
    actionType:          "ask_cleo_followup",
    source:              "household_cfo",
    sourceId:            cfoResponse.sourceId,
    targetModule:        "cleo",
    payload:             { prefillMessage: `Can you explain more about: ${cfoResponse.recommendation}` },
    priority:            "low",
    riskLevel:           "low",
    requiresConfirmation: false,
    status:              "pending",
    createdAt:           now,
    expiresAt:           expires,
    explanation:         "Continue the CFO conversation with Cleo",
  });

  return actions;
}

// ── From Decision ─────────────────────────────────────────────────
export function createActionsFromDecision(decision: {
  id: string;
  question: string;
  nextActions?: Array<{ label: string; actionType: string; priority: string; targetModule?: string }>;
  recommendation?: { summary: string };
}): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  for (const next of decision.nextActions ?? []) {
    actions.push({
      id:                  crypto.randomUUID(),
      label:               next.label,
      description:         `From decision: "${decision.question}"`,
      actionType:          (next.actionType as ActionType) ?? "ask_cleo_followup",
      source:              "decision_engine",
      sourceId:            decision.id,
      targetModule:        next.targetModule,
      payload:             { decisionId: decision.id, question: decision.question },
      priority:            (next.priority as RecommendedAction["priority"]) ?? "medium",
      riskLevel:           "low",
      requiresConfirmation: ["create_goal", "adjust_budget"].includes(next.actionType),
      status:              "pending",
      createdAt:           now,
      expiresAt:           expires,
      explanation:         decision.recommendation?.summary ?? `Next step for: ${decision.question}`,
    });
  }

  return actions;
}

// ── From AI text response ─────────────────────────────────────────
// Extracts action signals from free-form Cleo responses
export function createActionsFromAIResponse(params: {
  responseText: string;
  source: ActionSource;
  sourceId?: string;
}): RecommendedAction[] {
  const { responseText, source, sourceId } = params;
  const actions: RecommendedAction[] = [];
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const text = responseText.toLowerCase();

  // Task creation signal
  if (/create a task|add a task|remind you to|set a reminder/i.test(text)) {
    actions.push({
      id:                  crypto.randomUUID(),
      label:               "Create a task",
      description:         "Add this as a task in your plan",
      actionType:          "create_task",
      source,
      sourceId,
      targetModule:        "plan",
      payload:             { fromCleo: true },
      priority:            "medium",
      riskLevel:           "low",
      requiresConfirmation: false,
      status:              "pending",
      createdAt:           now,
      expiresAt:           expires,
      explanation:         "Cleo suggested creating a task",
    });
  }

  // Goal creation signal
  if (/create a goal|set a goal|start saving for|build a fund/i.test(text)) {
    actions.push({
      id:                  crypto.randomUUID(),
      label:               "Create a goal",
      description:         "Set up a new financial goal",
      actionType:          "create_goal",
      source,
      sourceId,
      targetModule:        "budget",
      payload:             { tab: "goals", fromCleo: true },
      priority:            "medium",
      riskLevel:           "low",
      requiresConfirmation: true,
      status:              "pending",
      createdAt:           now,
      expiresAt:           expires,
      explanation:         "Cleo suggested creating a savings goal",
    });
  }

  // Budget review signal
  if (/review.*budget|check.*spending|open.*budget|look at.*finances/i.test(text)) {
    actions.push({
      id:                  crypto.randomUUID(),
      label:               "Open Budget",
      description:         "Review your spending in the Financial Hub",
      actionType:          "open_module",
      source,
      sourceId,
      targetModule:        "budget",
      payload:             { tab: "overview" },
      priority:            "medium",
      riskLevel:           "low",
      requiresConfirmation: false,
      status:              "pending",
      createdAt:           now,
      expiresAt:           expires,
      explanation:         "Cleo suggested reviewing your budget",
    });
  }

  return actions;
}

// ═══════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════

export function validateActionPayload(action: RecommendedAction): { valid: boolean; reason?: string } {
  // Financial actions must never move money
  if (action.actionType === "adjust_budget" && action.payload.amount) {
    const amount = Number(action.payload.amount);
    if (amount > 10000) {
      return { valid: false, reason: "Budget adjustment exceeds safe threshold" };
    }
  }

  // Actions targeting unknown modules
  const validModules = ["budget", "plan", "calendar", "trips", "cleo", "thrive", "circle", "settings", "home"];
  if (action.targetModule && !validModules.includes(action.targetModule)) {
    return { valid: false, reason: `Unknown target module: ${action.targetModule}` };
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════════════

export async function executeRecommendedAction(
  userId: string,
  action: RecommendedAction
): Promise<ActionExecutionResult> {
  // Validate first
  const validation = validateActionPayload(action);
  if (!validation.valid) {
    return { success: false, actionId: action.id, message: validation.reason ?? "Invalid action", error: validation.reason };
  }

  try {
    switch (action.actionType) {

      case "create_task": {
        const tasksData = await loadData(userId, "tasks");
        const tasks = (tasksData?.tasks as any[]) || [];
        const newTask = {
          id:        crypto.randomUUID(),
          title:     (action.payload.title as string) || action.label,
          priority:  action.payload.priority || "medium",
          done:      false,
          dueDate:   action.payload.dueDate,
          note:      action.payload.note || action.explanation,
          createdAt: new Date().toISOString(),
          source:    "cleo_recommendation",
        };
        await saveData(userId, "tasks", { tasks: [newTask, ...tasks] });
        invalidateCache(userId, ["tasks"]);
        await bus.publish("plan.task.created", newTask, { userId, source: "actions" });
        return { success: true, actionId: action.id, message: "Task created", sideEffects: ["tasks updated"] };
      }

      case "open_module": {
        // UI-only action — emit event for screen to handle
        window.dispatchEvent(new CustomEvent("hernest:navigate", {
          detail: { module: action.targetModule, tab: action.payload.tab }
        }));
        return { success: true, actionId: action.id, message: `Opening ${action.targetModule}` };
      }

      case "ask_cleo_followup": {
        // Prefill Cleo input — emit event for CleoScreen to handle
        window.dispatchEvent(new CustomEvent("hernest:cleo_prefill", {
          detail: { message: action.payload.prefillMessage }
        }));
        window.dispatchEvent(new CustomEvent("hernest:navigate", {
          detail: { module: "cleo" }
        }));
        return { success: true, actionId: action.id, message: "Opening Cleo with context" };
      }

      case "snooze_insight":
      case "dismiss_insight": {
        // Emit event for insight store to handle
        window.dispatchEvent(new CustomEvent("hernest:insight_action", {
          detail: { insightId: action.sourceId, action: action.actionType }
        }));
        return { success: true, actionId: action.id, message: `Insight ${action.actionType.replace("_insight", "d")}` };
      }

      case "schedule_review": {
        const calData = await loadData(userId, "calendar");
        const events  = (calData?.events as any[]) || [];
        const reviewEvent = {
          id:     crypto.randomUUID(),
          title:  action.label,
          date:   action.payload.date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          source: "cleo_recommendation",
          note:   action.explanation,
        };
        await saveData(userId, "calendar", { events: [...events, reviewEvent] });
        invalidateCache(userId, ["calendar"]);
        return { success: true, actionId: action.id, message: "Review scheduled", sideEffects: ["calendar updated"] };
      }

      case "create_goal":
      case "adjust_budget":
      case "start_decision":
      case "update_decision": {
        // These require UI interaction — navigate to the right screen
        window.dispatchEvent(new CustomEvent("hernest:navigate", {
          detail: { module: action.targetModule || "budget", action: action.actionType, payload: action.payload }
        }));
        return { success: true, actionId: action.id, message: `Opening ${action.targetModule} for ${action.actionType}` };
      }

      default:
        return { success: false, actionId: action.id, message: `Action type ${action.actionType} not yet implemented`, error: "not_implemented" };
    }
  } catch (e: any) {
    console.error("[Actions] execution failed:", action.actionType, e);
    return { success: false, actionId: action.id, message: "Action failed", error: e?.message ?? "unknown" };
  }
}

// ═══════════════════════════════════════════════════════════════════
// LIFECYCLE
// ═══════════════════════════════════════════════════════════════════

export async function markActionCompleted(
  userId: string,
  action: RecommendedAction
): Promise<void> {
  // Emit completion event
  await bus.publish("plan.task.completed", { actionId: action.id, label: action.label }, { userId, source: "actions" });

  // Propose memory if significant action
  if (["create_goal", "adjust_budget", "start_decision"].includes(action.actionType)) {
    proposeMemory(userId, {
      type:                "decision",
      title:               `Acted on: ${action.label}`,
      content:             `User completed action "${action.label}" from ${action.source}. ${action.explanation}`,
      sourceModule:        "cleo",
      confidence:          "medium",
      sensitivity:         "low",
      evidenceDescription: `Action completed: ${action.actionType}`,
    }).catch(() => {});
  }
}

export function dismissAction(action: RecommendedAction): RecommendedAction {
  return { ...action, status: "dismissed", dismissedAt: new Date().toISOString() };
}

export function snoozeAction(action: RecommendedAction, days = 3): RecommendedAction {
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  return { ...action, status: "snoozed", expiresAt: until };
}

export function explainAction(action: RecommendedAction): string {
  return `${action.explanation} — suggested by ${action.source.replace(/_/g, " ")} because: ${action.description}`;
}

// ═══════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════

export async function saveActions(userId: string, actions: RecommendedAction[]): Promise<void> {
  try {
    const existing = await loadActions(userId);
    // Merge, deduplicate by id, keep last 50
    const merged = [...actions, ...existing.filter(e => !actions.find(a => a.id === e.id))].slice(0, 50);
    await saveData(userId, "recommended_actions", { actions: merged, updatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("[Actions] save failed:", e);
  }
}

export async function loadActions(userId: string): Promise<RecommendedAction[]> {
  try {
    const data = await loadData(userId, "recommended_actions");
    const now = Date.now();
    // Filter expired and deleted
    return ((data?.actions as RecommendedAction[]) || []).filter(a => {
      if (a.status === "dismissed" || a.status === "completed") return false;
      if (a.expiresAt && new Date(a.expiresAt).getTime() < now) return false;
      return true;
    });
  } catch {
    return [];
  }
}

export function getPendingActions(actions: RecommendedAction[]): RecommendedAction[] {
  return actions
    .filter(a => a.status === "pending" || a.status === "confirmed")
    .sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return p[a.priority] - p[b.priority];
    });
}
