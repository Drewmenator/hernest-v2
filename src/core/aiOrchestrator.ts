// ─── HerNest AI Orchestrator ─────────────────────────────────────
// Single intelligence entry point for all modules.
// Modules do not own AI logic — they call the orchestrator.
//
// Flow:
//   userMessage + sourceModule
//     → classifyIntent
//     → buildContextPack
//     → selectPrompt
//     → callAI (correct model)
//     → structuredResponse
//     → memoryWriteback (async, non-blocking)
//     → publish event

import { ai, aiJSON, type Feature } from "./ai";
import { runCleoAgent, runCleoAgentStreaming } from "./cleoAgent";
import { AI } from "../config";
import { buildAppContext }           from "./contextBuilder";
import { buildHouseholdSnapshot }    from "./household/HouseholdIntelligence";
import { extractFactsFromConversation } from "./memory";
import { bus }                       from "./events";
import { computeHouseholdState, buildStatePromptAddendum } from "./household/householdStateEngine";
import { validateResponse } from "./household/responseValidator";
import { retrieve, invalidateCache } from "./contextRetrieval";
import { createContextGraph, loadGraphFromFirestore, generateContextPackForCleo, generateContextPackForCFO, formatCleoContextPackForPrompt, formatCFOContextPackForPrompt } from "./graph/GraphService";
import { useStore }                  from "./store";
import { getHouseholdId }            from "./identity";
import { FLAGS }                     from "../config";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type AIIntent =
  | "emotional_support"
  | "financial_analysis"
  | "decision_support"
  | "planning"
  | "task_creation"
  | "calendar_help"
  | "spending_review"
  | "debt_strategy"
  | "goal_planning"
  | "household_summary"
  | "wellness_check"
  | "unknown";

export type OrchestratorFeature =
  | "cleo_chat"
  | "household_cfo"
  | "morning_briefing"
  | "cross_module_insight"
  | "wellness_coach"
  | "task_extraction"
  | "calendar_extraction";

export type SourceModule =
  | "home" | "cleo" | "finances" | "calendar"
  | "tasks" | "trips" | "goals" | "wellness" | "briefing" | "settings";

export interface OrchestratorRequest {
  userId: string;
  profile: Record<string, unknown>;
  sourceModule: SourceModule;
  userMessage: string;
  conversationHistory?: { role: "user" | "assistant"; content: string }[];
  options?: {
    requireJson?: boolean;
    allowMemoryWriteback?: boolean;
    contextDepth?: "light" | "full";  // light = fast, full = cross-module
    onToken?: (t: string) => void;    // when set, Cleo's reply streams token-by-token
  };
}

export interface OrchestratorResponse {
  success: boolean;
  feature: OrchestratorFeature;
  intent: AIIntent;
  modelUsed: string;
  text: string;
  parsed?: unknown;           // populated when requireJson = true
  contextModules: string[];   // which modules were included
  assumptions: string[];      // stated when data was missing
  fallbackUsed: boolean;
  error?: string;
}

interface IntentClassification {
  intent: AIIntent;
  feature: OrchestratorFeature;
  requiredModules: string[];
  emotionalWeight: "low" | "medium" | "high";
  decisionRequired: boolean;
  financialDataRequired: boolean;
  needsFullContext: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE → AI FEATURE MAPPING
// Maps OrchestratorFeature to the Feature type used by ai.ts
// ═══════════════════════════════════════════════════════════════════

const FEATURE_MAP: Record<OrchestratorFeature, Feature> = {
  cleo_chat:            "cleo_chat",
  household_cfo:        "household_cfo",
  morning_briefing:     "morning_briefing",
  cross_module_insight: "household_cfo",   // reuse Sonnet
  wellness_coach:       "wellness_coach",
  task_extraction:      "cleo_chat",       // Haiku via budget_coach fallback
  calendar_extraction:  "cleo_chat",
};

// ═══════════════════════════════════════════════════════════════════
// INTENT CLASSIFIER
// Fast local rules first (80% of cases), AI fallback for ambiguous
// ═══════════════════════════════════════════════════════════════════

const FINANCIAL_KEYWORDS = [
  "afford", "budget", "spend", "spending", "money", "cost", "pay",
  "debt", "loan", "credit", "savings", "save", "income", "salary",
  "expense", "bill", "subscription", "cut", "overspend", "cash",
  "financial", "invest", "goal", "fund", "mortgage", "rent",
];

const EMOTIONAL_KEYWORDS = [
  "overwhelmed", "stressed", "tired", "exhausted", "anxious", "worried",
  "struggling", "hard", "difficult", "can't cope", "too much", "burnout",
  "heavy", "lost", "help me", "don't know", "scared", "feel",
];

const PLANNING_KEYWORDS = [
  "plan", "schedule", "organize", "this week", "today", "tomorrow",
  "prioritize", "focus", "what should", "help me think", "next steps",
];

const TASK_KEYWORDS = [
  "task", "todo", "to-do", "reminder", "don't forget", "need to",
  "add to", "create a task", "make a note", "remind me",
];

const WELLNESS_KEYWORDS = [
  "sleep", "tired", "energy", "exercise", "habit", "water", "mood",
  "wellness", "health", "routine", "self care", "rest", "relax",
];

function classifyIntentLocally(message: string, sourceModule: SourceModule): IntentClassification | null {
  const msg = message.toLowerCase();

  const financialScore  = FINANCIAL_KEYWORDS.filter(k => msg.includes(k)).length;
  const emotionalScore  = EMOTIONAL_KEYWORDS.filter(k => msg.includes(k)).length;
  const planningScore   = PLANNING_KEYWORDS.filter(k => msg.includes(k)).length;
  const taskScore       = TASK_KEYWORDS.filter(k => msg.includes(k)).length;
  const wellnessScore   = WELLNESS_KEYWORDS.filter(k => msg.includes(k)).length;

  // Strong financial signal
  if (financialScore >= 2 || (financialScore >= 1 && sourceModule === "finances")) {
    return {
      intent: "financial_analysis",
      feature: "household_cfo",
      requiredModules: ["finances", "goals", "trips", "calendar"],
      emotionalWeight: "low",
      decisionRequired: true,
      financialDataRequired: true,
      needsFullContext: true,
    };
  }

  // Strong emotional signal
  if (emotionalScore >= 2) {
    return {
      intent: "emotional_support",
      feature: "cleo_chat",
      requiredModules: ["calendar", "tasks", "wellness", "finances"],
      emotionalWeight: "high",
      decisionRequired: false,
      financialDataRequired: false,
      needsFullContext: true,
    };
  }

  // Task extraction
  if (taskScore >= 1) {
    return {
      intent: "task_creation",
      feature: "task_extraction",
      requiredModules: ["tasks"],
      emotionalWeight: "low",
      decisionRequired: false,
      financialDataRequired: false,
      needsFullContext: false,
    };
  }

  // Wellness
  if (wellnessScore >= 2 || sourceModule === "wellness") {
    return {
      intent: "wellness_check",
      feature: "wellness_coach",
      requiredModules: ["wellness", "calendar", "tasks"],
      emotionalWeight: "medium",
      decisionRequired: false,
      financialDataRequired: false,
      needsFullContext: false,
    };
  }

  // Planning
  if (planningScore >= 1) {
    return {
      intent: "planning",
      feature: "cleo_chat",
      requiredModules: ["tasks", "calendar", "finances"],
      emotionalWeight: "low",
      decisionRequired: false,
      financialDataRequired: false,
      needsFullContext: true,
    };
  }

  // Source module hints
  if (sourceModule === "finances") {
    return {
      intent: "financial_analysis",
      feature: "household_cfo",
      requiredModules: ["finances", "goals"],
      emotionalWeight: "low",
      decisionRequired: false,
      financialDataRequired: true,
      needsFullContext: false,
    };
  }

  // Can't classify locally
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════════

const NORA_BASE = `You are Cleo, the AI household intelligence assistant inside HerNest.

You help families reduce mental load, coordinate household life, understand finances, plan ahead, and make better decisions.

Your voice is warm, calm, direct, emotionally aware, and non-judgmental.

You must always:
- Validate emotional state before solving when the user sounds stressed
- Avoid shame, fear, or alarmist language
- Explain recommendations clearly
- State assumptions when data is incomplete
- Use plain language and focus on practical next steps
- Sound consistent whether you're answering from the home screen, finances, or wellness

You are not a bank, lender, tax advisor, therapist, medical professional, or legal advisor.`;

const CFO_SYSTEM = `${NORA_BASE}

You are acting as the HerNest Household CFO.

Your job is to help the household understand cash flow, spending, savings goals, debt, upcoming obligations, and major financial decisions.

Every CFO response must address:
1. What I'm seeing (observation with numbers)
2. Why it matters
3. Options (2-3 concrete options)
4. My recommendation
5. Confidence level and assumptions
6. Suggested next step

Never shame spending. Never guarantee outcomes. Never provide investment, tax, or legal advice.
When data is missing, state the assumption clearly — do not invent numbers.`;

const WELLNESS_SYSTEM = `${NORA_BASE}

You are acting as the HerNest Wellness Coach.

Focus on:
- Validating how the user feels before offering advice
- Connecting household load (calendar, tasks, finances) to how they're feeling
- Offering 1-3 practical, realistic relief actions
- Being gentle — never prescriptive or clinical`;

function buildSystemPrompt(classification: IntentClassification): string {
  switch (classification.feature) {
    case "household_cfo":        return CFO_SYSTEM;
    case "wellness_coach":       return WELLNESS_SYSTEM;
    default:                     return NORA_BASE;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONTEXT PACK BUILDER
// Assembles the right context for each intent
// Uses light pack for simple queries, full pack for cross-module
// ═══════════════════════════════════════════════════════════════════

async function buildContextString(
  userId: string,
  profile: Record<string, unknown>,
  classification: IntentClassification,
  depth: "light" | "full"
): Promise<{ context: string; modules: string[]; assumptions: string[] }> {
  const modules: string[] = [];
  const assumptions: string[] = [];

  // Light context: just what the source module needs
  if (depth === "light" || !classification.needsFullContext) {
    const lines: string[] = [];
    const name = (profile.name as string) || "this household";
    lines.push(`User: ${name}`);
    if (profile.kids) {
      lines.push(`Kids: ${(profile.kids as any[]).map((k: any) => k.name).join(", ")}`);
    }
    modules.push("profile");
    return { context: lines.join("\n"), modules, assumptions };
  }

  // Full context: pull from all required modules via contextBuilder
  try {
    const { buildBriefingPrompt } = await import("./contextBuilder");
    const appCtx = await import("./contextBuilder").then(m => m.buildAppContext(userId, profile));
    modules.push(...classification.requiredModules);

    // Note missing data as assumptions
    if (appCtx.budget.monthlyIncome === 0) {
      assumptions.push("Monthly income not set — financial estimates use budget total only");
    }
    if (!appCtx.tasks.dueToday.length && !appCtx.tasks.overdue.length) {
      assumptions.push("No tasks found for today");
    }

    return {
      context: buildBriefingPrompt(appCtx),
      modules,
      assumptions,
    };
  } catch (e) {
    console.warn("[Orchestrator] Full context build failed, using minimal context", e);
    assumptions.push("Full household context unavailable — answer based on question only");
    return {
      context: `User: ${(profile.name as string) || "HerNest user"}`,
      modules: ["profile"],
      assumptions,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// MEMORY WRITEBACK
// Non-blocking — fires and forgets after response is returned
// ═══════════════════════════════════════════════════════════════════

async function triggerMemoryWriteback(
  userId: string,
  messages: { role: string; content: string }[]
): Promise<void> {
  try {
    const facts = await extractFactsFromConversation(messages, userId);
    if (facts.length > 0) {
      // Route writeback through V2 governance (validate/dedup/decay) — Step 4.
      const { proposeMemory, v1FactToCandidate } = await import("./memoryServiceV2");
      for (const f of facts) {
        await proposeMemory(userId, v1FactToCandidate(f)).catch(() => {});
      }
      bus.publish("cleo.memory.updated", { factsAdded: facts.length }, {
        userId,
        source: "orchestrator",
      });
    }
  } catch (e) {
    // Non-fatal — memory writeback never crashes the main flow
    console.warn("[Orchestrator] Memory writeback failed (non-fatal):", e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// FALLBACK RESPONSES
// Shown when AI fails — never crash a screen
// ═══════════════════════════════════════════════════════════════════

const FALLBACKS: Record<AIIntent, string> = {
  emotional_support:  "I'm here with you. Something went quiet on my end — try again in a moment. 💛",
  financial_analysis: "I couldn't complete that analysis right now. Your saved information is still safe. Please try again.",
  decision_support:   "I wasn't able to run that scenario. Please try again — your data is safe.",
  planning:           "I had trouble loading your plan context. Try again in a moment.",
  task_creation:      "I couldn't extract tasks right now. Try again shortly.",
  calendar_help:      "I couldn't access your calendar context. Please try again.",
  spending_review:    "I wasn't able to analyze spending right now. Your data is safe.",
  debt_strategy:      "I couldn't run the debt analysis. Please try again.",
  goal_planning:      "I had trouble with goal analysis. Please try again.",
  household_summary:  "I couldn't generate a household summary right now.",
  wellness_check:     "I'm here for you. Something went quiet — try again in a moment. 💛",
  unknown:            "I'm here. Something went quiet on my end — try again in a moment.",
};

// ═══════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════

export async function orchestrate(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  const {
    userId,
    profile,
    sourceModule,
    userMessage,
    conversationHistory = [],
    options = {},
  } = req;

  const {
    requireJson = false,
    allowMemoryWriteback = true,
    contextDepth = "full",
    onToken,
  } = options;

  // ── Step 1: Classify intent ──────────────────────────────────────
  let classification = classifyIntentLocally(userMessage, sourceModule);

  // Fallback: if local classifier can't determine intent, default to cleo_chat
  if (!classification) {
    classification = {
      intent: "unknown",
      feature: "cleo_chat",
      requiredModules: ["tasks", "calendar"],
      emotionalWeight: "low",
      decisionRequired: false,
      financialDataRequired: false,
      needsFullContext: contextDepth === "full",
    };
  }

  // ── Step 2: Retrieve context (cached, intent-targeted) ──────────
  let context = "";
  let modules: string[] = [];
  let assumptions: string[] = [];
  let stateAddendum = "";

  try {
    if (FLAGS.CANONICAL_CONTEXT === "graph") {
      // Canonical path (migration Step 3d): context comes SOLELY from the
      // household graph pack — one source of truth, no snapshot/memory-V1/V2 blend.
      const hid = getHouseholdId() ?? userId;
      let graph = await loadGraphFromFirestore(hid);
      if (!graph) graph = await createContextGraph(hid);
      context = formatCleoContextPackForPrompt(generateContextPackForCleo(graph, userId));
      modules = ["graph"];
      assumptions = [];
    } else {
      // Default path: intent-targeted retrieval (snapshot + memory). Unchanged.
      const retrieved = await retrieve({
        userId,
        userMessage,
        intent: classification.intent,
        feature: classification.feature,
        profile,
      });
      context = retrieved.contextString;
      modules = retrieved.modulesLoaded;
      assumptions = retrieved.assumptions;
    }

    // Build state addendum for tone adaptation (uses cached data)
    try {
      const { buildAppContext: getCtx } = await import("./contextBuilder");
      const appCtx = await getCtx(userId, profile);
      const hState = computeHouseholdState(appCtx);
      stateAddendum = buildStatePromptAddendum(hState);
      // Phase 4: fold the household intelligence scores + Risk Radar into context
      // so Cleo can reference resilience/productivity and the ranked priorities.
      try {
        const { computeHouseholdScores } = await import("./intelligence/householdScores");
        const s = computeHouseholdScores(appCtx);
        const topAttention = s.attention.slice(0, 3).map(a => `${a.title} (${a.severity})`).join("; ");
        stateAddendum += `\n\nHOUSEHOLD SCORES: Resilience ${s.resilience.score}/100 (${s.resilience.band}) — ${s.resilience.headline} · Productivity ${s.productivity.score}/100 (${s.productivity.band}).${topAttention ? `\nNEEDS ATTENTION (ranked): ${topAttention}` : ""}`;
      } catch { /* non-fatal */ }
    } catch (e) { /* non-fatal */ }

  } catch (e) {
    console.warn("[Orchestrator] Retrieval failed, using minimal context:", e);
    context = `User: ${(profile.name as string) || "HerNest user"}`;
    assumptions = ["Full household context unavailable"];
  }

  const systemPrompt = `${buildSystemPrompt(classification)}

=== HOUSEHOLD CONTEXT ===
${context}
${assumptions.length ? `\nASSUMPTIONS (state these if relevant):\n${assumptions.map(a => `- ${a}`).join("\n")}` : ""}
${stateAddendum}`;

  // ── Step 4: Select feature (model routing handled by ai.ts) ──────
  const feature = FEATURE_MAP[classification.feature];

  // ── Step 5: Call AI ──────────────────────────────────────────────
  let text = "";
  let parsed: unknown = undefined;
  let fallbackUsed = false;

  // Single-shot chat call, used directly and as the agent's fallback.
  const singleShotChat = async () => {
    const result = await ai(systemPrompt, userMessage, feature, conversationHistory);
    if (result.error) {
      fallbackUsed = true;
      text = FALLBACKS[classification.intent];
    } else {
      text = result.text;
    }
  };

  try {
    if (requireJson) {
      parsed = await aiJSON(systemPrompt, userMessage, feature, null);
      text = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      if (!parsed) {
        fallbackUsed = true;
        text = FALLBACKS[classification.intent];
      }
    } else if (FLAGS.CLEO_AGENT && classification.feature === "cleo_chat") {
      // ── Cleo v2 agent (Phase 2): tool loop so she can ACT, not just answer ──
      const todayStr = new Date().toISOString().split("T")[0];
      const agentSystem = `${systemPrompt}

=== ACTIONS YOU CAN TAKE ===
Today is ${todayStr}. You can act in the app using tools: add_task, complete_task, add_calendar_event. When the user asks you to add/note/remind, schedule/book, or mark something done, CALL THE TOOL — don't just say you will. Resolve relative dates like "tomorrow" to YYYY-MM-DD using today's date. After acting, confirm briefly and warmly. For anything that isn't an action request, just answer normally.`;
      const agentHistory = conversationHistory
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      const agentMessages = [...agentHistory, { role: "user" as const, content: userMessage }];
      // Model routing: heavy reasoning → Sonnet; everyday chat & actions → Haiku (faster).
      const heavy = classification.intent === "financial_analysis" || classification.intent === "emotional_support";
      const cleoModel = heavy ? AI.SONNET : AI.HAIKU;
      try {
        const agentRes = (onToken && FLAGS.CLEO_STREAMING)
          ? await runCleoAgentStreaming({ uid: userId, system: agentSystem, messages: agentMessages, model: cleoModel, onToken })
          : await runCleoAgent({ uid: userId, system: agentSystem, messages: agentMessages, model: cleoModel });
        if (agentRes.text) text = agentRes.text;
        else await singleShotChat();
      } catch (e) {
        console.warn("[Orchestrator] Cleo agent failed, falling back to chat:", e);
        await singleShotChat();
      }
    } else {
      await singleShotChat();
    }
  } catch (e) {
    console.error("[Orchestrator] AI call failed:", e);
    fallbackUsed = true;
    text = FALLBACKS[classification.intent];
  }

  // ── Step 6: Response validation ─────────────────────────────────
  // Skipped when streaming — the text is already on the user's screen, so we
  // can't swap it out post-hoc, and it saves a context rebuild on the hot path.
  if (!fallbackUsed && !onToken) {
    let currentState: import("./household/householdStateEngine").HouseholdStateResult | null = null;
    try {
      const { buildAppContext: getCtx } = await import("./contextBuilder");
      const appCtx = await getCtx(userId, profile);
      currentState = computeHouseholdState(appCtx);
    } catch { /* non-fatal */ }

    const validation = validateResponse({
      rawText: text,
      rawParsed: parsed,
      intent: classification.intent,
      feature: classification.feature,
      requireJson,
      householdState: currentState,
      fallbackText: FALLBACKS[classification.intent],
    });

    text   = validation.text;
    parsed = validation.parsed;
    if (!validation.valid) fallbackUsed = true;

    if (validation.warnings.length > 0) {
      console.warn("[Validator] Warnings:", validation.warnings.map(w => w.code).join(", "));
    }
  }

  // ── Step 7: Memory writeback (async, non-blocking) ───────────────
  if (allowMemoryWriteback && !fallbackUsed && userMessage.length > 30) {
    const messages = [
      ...conversationHistory,
      { role: "user" as const, content: userMessage },
      { role: "assistant" as const, content: text },
    ];
    // Fire and forget — never await this
    triggerMemoryWriteback(userId, messages).catch(() => {});
  }

  // ── Step 8: Return structured response ───────────────────────────
  return {
    success: !fallbackUsed,
    feature: classification.feature,
    intent: classification.intent,
    modelUsed: feature,
    text,
    parsed,
    contextModules: modules,
    assumptions,
    fallbackUsed,
  };
}

// ═══════════════════════════════════════════════════════════════════
// CONVENIENCE WRAPPERS
// Drop-in replacements for direct ai() calls in modules
// ═══════════════════════════════════════════════════════════════════

// For Cleo chat screen
export async function askCleo(
  userId: string,
  profile: Record<string, unknown>,
  message: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<string> {
  const result = await orchestrate({
    userId,
    profile,
    sourceModule: "cleo",
    userMessage: message,
    conversationHistory: history,
    options: { allowMemoryWriteback: true, contextDepth: "full" },
  });
  return result.text;
}

// Streaming variant: tokens arrive via onToken as they generate; the resolved
// promise is the full final text (for task parsing / memory writeback).
export async function askCleoStreaming(
  userId: string,
  profile: Record<string, unknown>,
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  onToken: (t: string) => void
): Promise<string> {
  const result = await orchestrate({
    userId,
    profile,
    sourceModule: "cleo",
    userMessage: message,
    conversationHistory: history,
    options: { allowMemoryWriteback: true, contextDepth: "full", onToken },
  });
  return result.text;
}

// For CFO / finances screen
export async function askCFO(
  userId: string,
  profile: Record<string, unknown>,
  message: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<string> {
  const result = await orchestrate({
    userId,
    profile,
    sourceModule: "finances",
    userMessage: message,
    conversationHistory: history,
    options: { allowMemoryWriteback: true, contextDepth: "full" },
  });
  return result.text;
}

// For wellness / thrive screen
export async function askWellness(
  userId: string,
  profile: Record<string, unknown>,
  message: string
): Promise<string> {
  const result = await orchestrate({
    userId,
    profile,
    sourceModule: "wellness",
    userMessage: message,
    options: { allowMemoryWriteback: false, contextDepth: "light" },
  });
  return result.text;
}
