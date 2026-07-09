// ─── HerNest Context Retrieval Layer ─────────────────────────────
// The brain's retrieval system.
//
// Problem it solves:
//   Every AI call was loading 8-20 Firestore collections,
//   building full context dumps, and passing everything to Claude.
//   This is slow, expensive, and produces noisy responses.
//
// Solution:
//   1. SESSION CACHE    — load Firestore once per session, reuse
//   2. INTENT ROUTING   — pull only what the intent needs
//   3. MEMORY RANKING   — surface relevant facts, not all facts
//   4. CONTEXT BUDGET   — enforce token limits per intent type
//
// Result:
//   Faster responses, cheaper calls, smarter context,
//   and a foundation that scales to thousands of memories.

import { loadData } from "./firebase";
import { createContextGraph, getRelevantContextForAI } from "./graph/GraphService";
import type { OrchestratorFeature, AIIntent } from "./aiOrchestrator";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface RetrievedContext {
  // What was actually retrieved (for explainability)
  modulesLoaded: string[];
  memoriesIncluded: number;
  totalMemoriesAvailable: number;
  retrievalStrategy: "full" | "targeted" | "minimal" | "standard";

  // The assembled context string for the AI prompt
  contextString: string;

  // Structured data for downstream engines
  raw: {
    profile:   Record<string, unknown> | null;
    budget:    Record<string, unknown> | null;
    tasks:     Record<string, unknown> | null;
    calendar:  Record<string, unknown> | null;
    thrive:    Record<string, unknown> | null;
    trips:     Record<string, unknown> | null;
    school:    Record<string, unknown> | null;
    circle:    Record<string, unknown> | null;
    memory:    Record<string, unknown> | null;
  };

  // Ranked memory facts (top N most relevant)
  relevantMemories: string[];

  // Assumptions noted when data was missing
  assumptions: string[];

  // Cache metadata
  cachedAt: number;
  fromCache: boolean;
}

// What each intent needs — drives selective loading
interface IntentDataRequirements {
  modules: Array<keyof RetrievedContext["raw"]>;
  memoryTypes: string[];
  maxMemories: number;
  contextBudget: "minimal" | "standard" | "full";
}

// ═══════════════════════════════════════════════════════════════════
// SESSION CACHE
// Single load per session, invalidated on data-changing events
// ═══════════════════════════════════════════════════════════════════

interface CacheEntry {
  data: Record<string, unknown> | null;
  loadedAt: number;
}

const SESSION_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(userId: string, collection: string): string {
  return `${userId}:${collection}`;
}

function getCached(userId: string, collection: string): Record<string, unknown> | null | undefined {
  const key = cacheKey(userId, collection);
  const entry = SESSION_CACHE.get(key);
  if (!entry) return undefined; // not cached
  if (Date.now() - entry.loadedAt > CACHE_TTL_MS) {
    SESSION_CACHE.delete(key);
    return undefined; // expired
  }
  return entry.data;
}

function setCache(userId: string, collection: string, data: Record<string, unknown> | null): void {
  SESSION_CACHE.set(cacheKey(userId, collection), { data, loadedAt: Date.now() });
}

// Invalidate specific collections (call after writes)
export function invalidateCache(userId: string, collections: string[]): void {
  for (const col of collections) {
    SESSION_CACHE.delete(cacheKey(userId, col));
  }
}

// Invalidate all cache for user (call on logout)
export function clearUserCache(userId: string): void {
  for (const key of SESSION_CACHE.keys()) {
    if (key.startsWith(`${userId}:`)) SESSION_CACHE.delete(key);
  }
}

async function loadWithCache(
  userId: string,
  collection: string
): Promise<Record<string, unknown> | null> {
  const cached = getCached(userId, collection);
  if (cached !== undefined) return cached;

  try {
    const data = await loadData(userId, collection);
    setCache(userId, collection, data);
    return data;
  } catch {
    setCache(userId, collection, null);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// INTENT → DATA REQUIREMENTS MAP
// Defines exactly what each intent needs — nothing more
// ═══════════════════════════════════════════════════════════════════

const INTENT_REQUIREMENTS: Record<AIIntent, IntentDataRequirements> = {
  financial_analysis: {
    modules: ["budget", "trips", "calendar", "memory"],
    memoryTypes: ["preference", "goal", "schedule"],
    maxMemories: 5,
    contextBudget: "full",
  },
  decision_support: {
    modules: ["budget", "calendar", "trips", "tasks", "memory"],
    memoryTypes: ["preference", "goal", "schedule", "family"],
    maxMemories: 6,
    contextBudget: "full",
  },
  emotional_support: {
    modules: ["calendar", "tasks", "thrive", "memory"],
    memoryTypes: ["family", "health", "preference"],
    maxMemories: 4,
    contextBudget: "standard",
  },
  planning: {
    modules: ["tasks", "calendar", "budget", "memory"],
    memoryTypes: ["schedule", "preference"],
    maxMemories: 4,
    contextBudget: "standard",
  },
  wellness_check: {
    modules: ["thrive", "calendar", "tasks"],
    memoryTypes: ["health", "preference"],
    maxMemories: 3,
    contextBudget: "standard",
  },
  task_creation: {
    modules: ["tasks"],
    memoryTypes: [],
    maxMemories: 0,
    contextBudget: "minimal",
  },
  calendar_help: {
    modules: ["calendar", "school"],
    memoryTypes: ["schedule"],
    maxMemories: 2,
    contextBudget: "standard",
  },
  spending_review: {
    modules: ["budget", "memory"],
    memoryTypes: ["preference", "goal"],
    maxMemories: 3,
    contextBudget: "standard",
  },
  debt_strategy: {
    modules: ["budget", "memory"],
    memoryTypes: ["goal", "preference"],
    maxMemories: 3,
    contextBudget: "full",
  },
  goal_planning: {
    modules: ["budget", "calendar", "trips", "memory"],
    memoryTypes: ["goal", "preference"],
    maxMemories: 4,
    contextBudget: "full",
  },
  household_summary: {
    modules: ["budget", "tasks", "calendar", "thrive", "trips", "memory"],
    memoryTypes: ["family", "preference", "schedule", "health"],
    maxMemories: 6,
    contextBudget: "full",
  },
  unknown: {
    modules: ["memory"],
    memoryTypes: ["preference", "family"],
    maxMemories: 3,
    contextBudget: "minimal",
  },
};

// Feature overrides — some features always need full context
const FEATURE_OVERRIDES: Partial<Record<OrchestratorFeature, Partial<IntentDataRequirements>>> = {
  household_cfo: {
    modules: ["budget", "trips", "calendar", "tasks", "memory"],
    maxMemories: 6,
    contextBudget: "full",
  },
  morning_briefing: {
    modules: ["budget", "tasks", "calendar", "thrive", "trips", "school", "circle", "memory"],
    maxMemories: 8,
    contextBudget: "full",
  },
  wellness_coach: {
    modules: ["thrive", "calendar", "tasks"],
    maxMemories: 3,
    contextBudget: "standard",
  },
};

// ═══════════════════════════════════════════════════════════════════
// MEMORY RANKER
// Scores memories by relevance to the current query
// Returns top N most relevant
// ═══════════════════════════════════════════════════════════════════

interface MemoryFact {
  statement: string;
  type: string;
  confidence: number;
  createdAt: number;
  expiresAt?: number;
}

function rankMemories(
  facts: MemoryFact[],
  query: string,
  allowedTypes: string[],
  maxCount: number
): string[] {
  if (!facts.length || maxCount === 0) return [];

  const now = Date.now();
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  // Filter expired and wrong types
  const eligible = facts.filter(f => {
    if (f.expiresAt && f.expiresAt < now) return false;
    if (allowedTypes.length && !allowedTypes.includes(f.type)) return false;
    return true;
  });

  // Score each fact
  const scored = eligible.map(fact => {
    let score = 0;

    // Relevance: keyword overlap with query
    const factWords = fact.statement.toLowerCase().split(/\s+/);
    const overlap = queryWords.filter(w => factWords.some(fw => fw.includes(w))).length;
    score += overlap * 20;

    // Confidence boost
    score += (fact.confidence ?? 0.5) * 30;

    // Recency boost (last 7 days)
    const daysSince = (now - fact.createdAt) / (1000 * 60 * 60 * 24);
    if (daysSince < 7)  score += 20;
    else if (daysSince < 30) score += 10;

    // Type priority
    const typePriority: Record<string, number> = {
      preference: 15, goal: 12, family: 10,
      health: 8, schedule: 8, temporary: 5,
    };
    score += typePriority[fact.type] ?? 0;

    return { fact, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount)
    .map(s => s.fact.statement);
}

// ═══════════════════════════════════════════════════════════════════
// CONTEXT STRING BUILDER
// Assembles retrieved data into a compact prompt-ready string
// Respects context budget — minimal/standard/full
// ═══════════════════════════════════════════════════════════════════

function buildContextString(
  raw: RetrievedContext["raw"],
  relevantMemories: string[],
  budget: "minimal" | "standard" | "full",
  assumptions: string[]
): string {
  const lines: string[] = [];

  // Profile (always included if available)
  if (raw.profile) {
    const p = raw.profile as any;
    lines.push(`USER: ${p.name || "HerNest user"}${p.role ? ` (${p.role})` : ""}`);
    if (p.kids?.length) lines.push(`KIDS: ${p.kids.map((k: any) => k.name).join(", ")}`);
    if (budget !== "minimal" && p.challenge) lines.push(`FOCUS: ${p.challenge}`);
  }

  // Memory (always included)
  if (relevantMemories.length) {
    lines.push(`\nCLEO REMEMBERS:`);
    relevantMemories.forEach(m => lines.push(`• ${m}`));
  }

  if (budget === "minimal") {
    if (assumptions.length) lines.push(`\nNOTE: ${assumptions.join("; ")}`);
    return lines.join("\n");
  }

  // Budget (standard + full)
  if (raw.budget) {
    const b = raw.budget as any;
    const cats = (b.categories as any[]) || [];
    const spent = cats.reduce((a: number, c: any) => a + (c.spent || 0), 0);
    const limit = cats.reduce((a: number, c: any) => a + (c.budget || 0), 0);
    const incomes = (b.incomes as any[]) || [];
    const income = incomes.reduce((a: number, inc: any) => {
      const m: Record<string, number> = { monthly: 1, biweekly: 26/12, weekly: 52/12, annual: 1/12 };
      return a + (inc.amount || 0) * (m[inc.frequency] || 1);
    }, 0);

    lines.push(`\nFINANCES:`);
    if (income > 0) lines.push(`Income: $${Math.round(income).toLocaleString()}/mo`);
    lines.push(`Spent: $${spent.toLocaleString()} / $${limit.toLocaleString()} budget`);
    lines.push(`Remaining: $${Math.max(0, limit - spent).toLocaleString()}`);

    if (budget === "full") {
      const debts = (b.debts as any[]) || [];
      const totalDebt = debts.reduce((a: number, d: any) => a + (d.balance || 0), 0);
      if (totalDebt > 0) lines.push(`Total debt: $${totalDebt.toLocaleString()}`);

      const goals = (b.goals as any[]) || [];
      if (goals.length) {
        const goalSummary = goals.map((g: any) => {
          const pct = g.targetAmount > 0 ? Math.round(g.currentAmount / g.targetAmount * 100) : 0;
          return `${g.name} (${pct}%)`;
        }).join(", ");
        lines.push(`Goals: ${goalSummary}`);
      }

      const overBudget = cats.filter((c: any) => c.spent > c.budget).map((c: any) => c.label);
      if (overBudget.length) lines.push(`Over budget: ${overBudget.join(", ")}`);
    }
  }

  // Calendar (standard + full)
  if (raw.calendar) {
    const c = raw.calendar as any;
    const events = (c.events as any[]) || [];
    const today = new Date().toISOString().split("T")[0];
    const todayEvents = events.filter((e: any) => e.date === today);
    const weekEvents = events.filter((e: any) => {
      const diff = (new Date(e.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 7;
    });

    lines.push(`\nCALENDAR:`);
    if (todayEvents.length) lines.push(`Today: ${todayEvents.map((e: any) => e.title).join(", ")}`);
    lines.push(`This week: ${weekEvents.length} events`);
  }

  // Tasks
  if (raw.tasks) {
    const t = raw.tasks as any;
    const allTasks = (t.tasks as any[]) || [];
    const today = new Date().toISOString().split("T")[0];
    const overdue = allTasks.filter((t: any) => !t.done && t.dueDate && t.dueDate < today);
    const pending = allTasks.filter((t: any) => !t.done).length;

    if (pending > 0 || overdue.length > 0) {
      lines.push(`\nTASKS: ${pending} pending${overdue.length ? `, ${overdue.length} overdue` : ""}`);
      if (budget === "full" && overdue.length) {
        lines.push(`Overdue: ${overdue.slice(0, 3).map((t: any) => t.title).join(", ")}`);
      }
    }
  }

  // Trips (full only)
  if (budget === "full" && raw.trips) {
    const t = raw.trips as any;
    const trips = (t.trips as any[]) || [];
    const future = trips
      .filter((tr: any) => new Date(tr.date) > new Date())
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (future.length) {
      const next = future[0];
      const daysUntil = Math.ceil((new Date(next.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      lines.push(`\nNEXT TRIP: ${next.dest} in ${daysUntil} days`);
    }
  }

  // Wellness (when relevant)
  if (raw.thrive && (budget === "standard" || budget === "full")) {
    const th = raw.thrive as any;
    const sleepLogs = (th.sleepLog as any[]) || [];
    const recentSleep = sleepLogs.slice(-3).map((l: any) => l.hours);
    const avgSleep = recentSleep.length
      ? recentSleep.reduce((a: number, b: number) => a + b, 0) / recentSleep.length
      : 0;
    if (avgSleep > 0 && avgSleep < 6.5) {
      lines.push(`\nWELLNESS: Sleep averaging ${avgSleep.toFixed(1)}h (below optimal)`);
    }
  }

  // School (when present and full)
  if (budget === "full" && raw.school) {
    const s = raw.school as any;
    const today = new Date().toISOString().split("T")[0];
    const urgent = ((s.events as any[]) || []).filter((e: any) => e.date === today && e.requiresAction);
    if (urgent.length) {
      lines.push(`\nSCHOOL: ${urgent.length} urgent items today`);
    }
  }

  if (assumptions.length) {
    lines.push(`\nASSUMPTIONS: ${assumptions.join("; ")}`);
  }

  return lines.join("\n");
}

// ── Relationship retrieval ────────────────────────────────────────
// Pulls cross-module patterns from Context Graph
// Called separately and appended to context string
async function retrieveRelationships(
  userId: string,
  userMessage: string,
  budget: "minimal" | "standard" | "full"
): Promise<string> {
  if (budget === "minimal") return "";
  try {
    const graph = await createContextGraph(userId);
    const hasData = graph.relationships.length > 0 || graph.finances.length > 0;
    if (!hasData) return "";
    const items = getRelevantContextForAI(userMessage, "cleo", graph, budget === "full" ? 8 : 4);
    if (!items.length) return "";
    return "\nCROSS-MODULE PATTERNS:\n" + items.join("\n");
  } catch {
    return ""; // non-fatal
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN RETRIEVAL FUNCTION
// The single entry point — replaces scattered loadData calls
// ═══════════════════════════════════════════════════════════════════

export async function retrieve(params: {
  userId: string;
  userMessage: string;
  intent: AIIntent;
  feature: OrchestratorFeature;
  profile: Record<string, unknown>;
}): Promise<RetrievedContext> {
  const { userId, userMessage, intent, feature, profile } = params;
  const startTime = Date.now();

  // Get requirements — feature overrides take priority
  const baseReqs = INTENT_REQUIREMENTS[intent] ?? INTENT_REQUIREMENTS.unknown;
  const featureOverride = FEATURE_OVERRIDES[feature] ?? {};
  const reqs: IntentDataRequirements = {
    ...baseReqs,
    ...featureOverride,
    modules: featureOverride.modules ?? baseReqs.modules,
  };

  const assumptions: string[] = [];
  const modulesLoaded: string[] = [];

  // ── Load only required modules (with cache) ─────────────────────
  const raw: RetrievedContext["raw"] = {
    profile:  profile as any,
    budget:   null,
    tasks:    null,
    calendar: null,
    thrive:   null,
    trips:    null,
    school:   null,
    circle:   null,
    memory:   null,
  };

  // Always load profile from passed-in data
  modulesLoaded.push("profile");

  // Load required modules in parallel
  const loadPromises = reqs.modules
    .filter(m => m !== "profile") // profile already set
    .map(async (module) => {
      const collection = module === "budget" ? "budget_v2" : module;
      const data = await loadWithCache(userId, collection);

      // Fallback for budget
      if (module === "budget" && !data) {
        const fallback = await loadWithCache(userId, "budget");
        raw.budget = fallback;
      } else {
        raw[module] = data;
      }

      if (data) modulesLoaded.push(module);
    });

  await Promise.all(loadPromises);

  // ── Rank memories ────────────────────────────────────────────────
  let relevantMemories: string[] = [];
  let totalMemoriesAvailable = 0;

  if (reqs.modules.includes("memory") && raw.memory) {
    const now = Date.now();
    const allFacts = ((raw.memory as any)?.facts as MemoryFact[]) || [];
    const activeFacts = allFacts.filter(f => !f.expiresAt || f.expiresAt > now);
    totalMemoriesAvailable = activeFacts.length;

    relevantMemories = rankMemories(
      activeFacts,
      userMessage,
      reqs.memoryTypes,
      reqs.maxMemories
    );
  }

  // ── Note missing critical data ───────────────────────────────────
  if (reqs.modules.includes("budget") && !raw.budget) {
    assumptions.push("Budget data unavailable — financial estimates may be incomplete");
  }
  if (!raw.profile || !(profile as any).name) {
    assumptions.push("Profile incomplete");
  }

  // ── Build context string ─────────────────────────────────────────
  const contextString = buildContextString(
    raw,
    relevantMemories,
    reqs.contextBudget,
    assumptions
  );

  // ── Append relationship context ─────────────────────────────────
  const relationshipContext = await retrieveRelationships(userId, userMessage, reqs.contextBudget);
  const finalContextStr = contextString + relationshipContext;

  const elapsed = Date.now() - startTime;
  console.log(`[Retrieval] ${intent}/${feature}: ${modulesLoaded.join(",")} — ${relevantMemories.length}/${totalMemoriesAvailable} memories — ${elapsed}ms`);

  return {
    modulesLoaded,
    memoriesIncluded: relevantMemories.length,
    totalMemoriesAvailable,
    retrievalStrategy: reqs.contextBudget,
    contextString: finalContextStr,
    raw,
    relevantMemories,
    assumptions,
    cachedAt: Date.now(),
    fromCache: elapsed < 50, // fast = likely came from cache
  };
}

// ═══════════════════════════════════════════════════════════════════
// CONVENIENCE: LOAD SINGLE MODULE WITH CACHE
// For use by other engines that need one collection
// ═══════════════════════════════════════════════════════════════════

export async function loadModule(
  userId: string,
  module: string
): Promise<Record<string, unknown> | null> {
  return loadWithCache(userId, module);
}

// ═══════════════════════════════════════════════════════════════════
// CACHE STATS (for debugging)
// ═══════════════════════════════════════════════════════════════════

export function getCacheStats(userId: string): { entries: number; keys: string[] } {
  const keys = [...SESSION_CACHE.keys()]
    .filter(k => k.startsWith(`${userId}:`))
    .map(k => k.split(":")[1]);
  return { entries: keys.length, keys };
}
