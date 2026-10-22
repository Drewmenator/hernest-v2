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
import { currencySymbol } from "../shared/utils/money";
import type { OrchestratorFeature, AIIntent } from "./aiOrchestrator";
import { todayLocal } from "./dateAwareness";
import { summariseBills } from "./contextBuilder";
import type { Bill } from "./bills";
import { isUsableInContext } from "./memoryRules";
import { taskIsFor } from "./taskOwnership";

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
const CACHE_TTL_MS = 60 * 1000; // 1 minute: a partner's changes reach Cleo quickly

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
    let data = await loadData(userId, collection);
    // The calendar Cleo sees includes connected calendars and email dates.
    if (collection === "calendar") {
      const synced = await loadData(userId, "calendar_synced").catch(() => null);
      const extra = (synced?.events as unknown[]) || [];
      if (extra.length) data = { ...(data || {}), events: [...(((data?.events as unknown[]) || [])), ...extra] };
    }
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

// Cleo's memories live in cleo_memory_v2. Only active, unexpired, not-highly-
// sensitive ones are turned into facts for ranking: suggestions waiting for
// the user's OK, rejected and forgotten memories never reach the prompt.
// V2 types are mapped onto the older type names the intent table uses.
const V2_TO_LEGACY_TYPE: Record<string, string> = {
  preference: "preference", decision: "preference", pattern: "preference",
  goal_context: "goal", financial_context: "goal",
  routine: "schedule", obligation: "schedule",
  fact: "family",
};

export function usableMemoryFacts(doc: Record<string, unknown> | null, now: number = Date.now()): MemoryFact[] {
  const memories = (doc?.memories as any[]) || [];
  const confidence: Record<string, number> = { low: 0.4, medium: 0.7, high: 0.9 };
  return memories
    .filter(m => m && typeof m === "object" && typeof m.content === "string")
    .filter(m => isUsableInContext(m, now))
    .filter(m => m.sensitivity !== "high")
    .map(m => ({
      statement: m.content,
      type: V2_TO_LEGACY_TYPE[m.type] ?? "other",
      confidence: confidence[m.confidence] ?? 0.5,
      createdAt: new Date(m.createdAt).getTime() || now,
    }));
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
  assumptions: string[],
  userId = "",
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

  // Bills (standard + full). The "budget" module now means the household's
  // bills: the old Budget record (replaced Oct 2026) never reset, so its
  // spending, income and debt figures are no longer given to Cleo.
  if (raw.budget) {
    const bills = summariseBills(((raw.budget as any).bills as Bill[]) || []);
    const amt = (n: number | null) => (n ? ` ${currencySymbol()}${Math.round(n).toLocaleString()}` : "");
    lines.push(`\nBILLS:`);
    if (!bills.total) {
      lines.push(`No bills set up yet. If money comes up, suggest adding bills on the Bills tab so HerNest can remind them.`);
    } else {
      lines.push(`${bills.total} regular bills tracked.`);
      if (bills.overdue.length) lines.push(`OVERDUE: ${bills.overdue.map(x => `${x.name}${amt(x.amount)} (${-x.days}d late)`).join(", ")}`);
      if (bills.dueSoon.length) lines.push(`Due in the next 7 days: ${bills.dueSoon.map(x => `${x.name}${amt(x.amount)} in ${x.days}d${x.autopay ? " (autopay)" : ""}`).join(", ")}`);
      if (budget === "full" && bills.noDate) lines.push(`${bills.noDate} bill(s) still need a due date.`);
    }
  }

  // Calendar (standard + full)
  if (raw.calendar) {
    const c = raw.calendar as any;
    const events = (c.events as any[]) || [];
    const today = todayLocal();
    const todayEvents = events.filter((e: any) => e.date === today);
    // Local calendar days (a "YYYY-MM-DD" parsed as UTC is already "past"
    // in a US evening, which dropped tomorrow from Cleo's week).
    const in7 = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return todayLocal(d); })();
    const weekEvents = events.filter((e: any) => typeof e.date === "string" && e.date.slice(0, 10) >= today && e.date.slice(0, 10) <= in7);

    // Real titles and dates, so "what's on Thursday?" isn't answered from a count.
    const when = (e: { title?: string; time?: string }) => `${e.title}${e.time ? ` at ${e.time}` : ""}`;
    lines.push(`\nCALENDAR:`);
    lines.push(`Today: ${todayEvents.length ? todayEvents.map(when).join(", ") : "nothing on the calendar"}`);
    const later = weekEvents.filter((e) => e.date !== today)
      .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 12);
    if (later.length) lines.push(`Next 7 days: ${later.map((e) => `${e.date} ${when(e)}`).join("; ")}`);
  }

  // Tasks
  if (raw.tasks) {
    const t = raw.tasks as any;
    const allTasks = (t.tasks as any[]) || [];
    const today = todayLocal();
    // Only her open tasks: Plan marks done with status "completed", and a task
    // asked of someone else is theirs once they accept (taskOwnership.ts).
    const open = allTasks.filter((t) => t.status !== "completed" && !t.done && (!userId || taskIsFor(t, userId)));
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
    const dueToday = open.filter((t) => t.dueDate === today);

    if (open.length > 0) {
      lines.push(`\nTASKS: ${open.length} open${overdue.length ? `, ${overdue.length} overdue` : ""}`);
      if (dueToday.length) lines.push(`Due today: ${dueToday.slice(0, 5).map((t) => t.title).join(", ")}`);
      if (overdue.length) lines.push(`Overdue: ${overdue.slice(0, 5).map((t) => t.title).join(", ")}`);
      const rest = open.filter((t) => !t.dueDate || t.dueDate > today).slice(0, 8);
      if (rest.length) lines.push(`Other open tasks: ${rest.map((t) => `${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""}`).join(", ")}`);
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
    // Only logs from the last few days; older manual logs are stale.
    const since = new Date(); since.setDate(since.getDate() - 3);
    const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
    const recentSleep = sleepLogs.filter((l) => typeof l?.date === "string" && l.date >= sinceStr).slice(-3).map((l) => l.hours);
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
    const today = todayLocal();
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
      // "budget" means bills since the Oct 2026 Bills redesign. Read fresh
      // (not from the 5-minute cache) so a bill just marked paid is seen.
      // "memory" means Cleo's memory store (cleo_memory_v2).
      const data = module === "budget"
        ? await loadData(userId, "bills")
        : module === "memory"
        ? await loadWithCache(userId, "cleo_memory_v2")
        : await loadWithCache(userId, module);
      raw[module] = data;

      if (data) modulesLoaded.push(module);
    });

  await Promise.all(loadPromises);

  // ── Rank memories ────────────────────────────────────────────────
  let relevantMemories: string[] = [];
  let totalMemoriesAvailable = 0;

  if (reqs.modules.includes("memory") && raw.memory) {
    const now = Date.now();
    const activeFacts = usableMemoryFacts(raw.memory, now);
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
    assumptions.push("No bills set up yet");
  }


  // ── Build context string ─────────────────────────────────────────
  const contextString = buildContextString(
    raw,
    relevantMemories,
    reqs.contextBudget,
    assumptions,
    userId,
  );

  // (The "cross-module patterns" from the context graph were removed in
  // simplify phase 3: the graph was rebuilt from scratch on every message.)
  const finalContextStr = contextString;

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
