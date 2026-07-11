// ─── HerNest Memory Service v2 ───────────────────────────────────
// Structured household intelligence layer.
// Memory is NOT chat history. Memory is durable household knowledge.
//
// Core rules:
//   1. Save only useful, durable, explainable, editable memories
//   2. Ask confirmation for sensitive or low-confidence memories
//   3. AI can only PROPOSE — Memory Service decides what gets saved
//   4. Users can view, edit, delete, and correct all memories
//   5. Memories decay or expire when no longer useful
//   6. Conflicts are detected and handled explicitly
//
// Firestore: users/{userId}/data/cleo_memory_v2
// Backward compatible with cleo_memory (v1 facts still load)

import { saveData, loadData } from "./firebase";
import { invalidateCache } from "./contextRetrieval";
import type { MemoryFact } from "./memory";
import { todayLocal } from "./dateAwareness";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type MemoryType =
  | "preference"
  | "pattern"
  | "fact"
  | "decision"
  | "routine"
  | "obligation"
  | "warning"
  | "goal_context"
  | "stress_pattern"
  | "financial_context";

export type MemorySensitivity = "low" | "medium" | "high";
export type MemoryConfidence  = "low" | "medium" | "high";
export type MemoryStatus      = "active" | "needs_confirmation" | "deprecated" | "contradicted" | "expired" | "deleted";
export type DecayRate         = "slow" | "medium" | "fast";

export type MemorySourceModule =
  | "cleo" | "finances" | "calendar" | "tasks"
  | "trips" | "goals" | "wellness" | "decision_engine"
  | "onboarding" | "system";

export interface LinkedEntity {
  entityId:   string;
  entityType: "person" | "goal" | "transaction_category" | "calendar_event" | "routine" | "decision" | "insight" | "debt" | "trip";
  label:      string;
}

export interface MemoryEvidence {
  description:  string;
  observedAt:   string;
  sourceModule: string;
}

export interface HouseholdMemory {
  id:           string;
  householdId:  string;
  type:         MemoryType;
  title:        string;
  content:      string;
  sourceModule: MemorySourceModule;
  sourceEventId?:    string;
  sourceDecisionId?: string;
  sourceInsightId?:  string;
  confidence:   MemoryConfidence;
  sensitivity:  MemorySensitivity;
  status:       MemoryStatus;
  linkedEntities?: LinkedEntity[];
  evidence:     MemoryEvidence[];
  usage: {
    lastUsedAt?:        string;
    timesUsed:          number;
    lastShownToUserAt?: string;
  };
  decay: {
    shouldDecay: boolean;
    decayRate:   DecayRate;
    lastDecayAt?: string;
  };
  expiresAt?:        string;
  createdAt:         string;
  updatedAt:         string;
  lastConfirmedAt?:  string;
  // Internal: normalized for deduplication
  _normalizedTitle?: string;
}

export interface MemoryCandidate {
  type:                MemoryType;
  title:               string;
  content:             string;
  sourceModule:        MemorySourceModule;
  confidence:          MemoryConfidence;
  sensitivity:         MemorySensitivity;
  evidenceDescription: string;
  linkedEntities?:     LinkedEntity[];
  suggestedStatus?:    "active" | "needs_confirmation";
  expiresAt?:          string;
}

export interface MemoryProposalResult {
  action:   "saved" | "needs_confirmation" | "rejected";
  memory?:  HouseholdMemory;
  reason:   string;
  prompt?:  MemoryConfirmationPrompt;
}

export interface MemoryConfirmationPrompt {
  memoryId:    string;
  question:    string;
  preview:     string;
  options:     Array<{ label: string; action: "confirm" | "reject" | "edit" | "never" }>;
}

export interface MemoryRetrievalRequest {
  householdId:      string;
  userMessage?:     string;
  sourceModule?:    string;
  feature?:         string;
  relatedEntityIds?: string[];
  memoryTypes?:     MemoryType[];
  maxResults?:      number;
  minConfidence?:   MemoryConfidence;
  includeSensitive?: boolean;
}

export interface MemoryRetrievalResult {
  memories: HouseholdMemory[];
  retrievalExplanation: Array<{ memoryId: string; reason: string; relevanceScore: number }>;
}

export interface DeduplicationResult {
  isDuplicate:    boolean;
  existingMemory?: HouseholdMemory;
  action:         "skip" | "merge" | "create";
  mergedContent?: string;
}

export interface ConflictResult {
  hasConflict:        boolean;
  conflictingMemory?: HouseholdMemory;
  conflictDescription?: string;
  suggestedResolution?: "update" | "keep_both" | "ask_user";
}

export interface MemoryExplanation {
  memoryId:      string;
  title:         string;
  whatItMeans:   string;
  whereItCameFrom: string;
  whenLastUsed:  string;
  whyItMatters:  string;
  howToEdit:     string;
}

export interface MemorySettingsView {
  totalMemories:     number;
  byType:            Record<MemoryType, number>;
  pendingConfirmation: HouseholdMemory[];
  recentlyUsed:      HouseholdMemory[];
  sensitive:         HouseholdMemory[];
  all:               HouseholdMemory[];
}

// ═══════════════════════════════════════════════════════════════════
// VALIDATION RULES
// Determines whether a candidate is worth saving
// ═══════════════════════════════════════════════════════════════════

const MIN_CONTENT_LENGTH = 15;

const NEVER_SAVE_PATTERNS = [
  /bad with money/i,
  /irresponsible/i,
  /lazy/i,
  /failed/i,
  /is stressed/i,       // temporary emotion
  /feels (sad|angry|upset)/i,
];

const ALWAYS_CONFIRM_TYPES: MemoryType[] = ["stress_pattern", "warning"];
const ALWAYS_CONFIRM_SENSITIVITY: MemorySensitivity[] = ["high"];

function validateCandidate(candidate: MemoryCandidate): { valid: boolean; reason: string } {
  if (candidate.content.length < MIN_CONTENT_LENGTH) {
    return { valid: false, reason: "Content too short to be useful" };
  }
  for (const pattern of NEVER_SAVE_PATTERNS) {
    if (pattern.test(candidate.content)) {
      return { valid: false, reason: "Contains judgmental or temporary content" };
    }
  }
  if ((candidate.confidence as string) === "low" && candidate.sensitivity === "high") {
    return { valid: false, reason: "Low confidence + high sensitivity — not safe to save automatically" };
  }
  return { valid: true, reason: "Passes validation" };
}

function shouldAutoSave(candidate: MemoryCandidate): boolean {
  if (ALWAYS_CONFIRM_TYPES.includes(candidate.type)) return false;
  if (ALWAYS_CONFIRM_SENSITIVITY.includes(candidate.sensitivity)) return false;
  const isLowConfidence = (candidate.confidence as string) === "low";
  if (isLowConfidence) return false;
  if (candidate.sensitivity === "medium" && isLowConfidence) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// DECAY CONFIG
// Maps memory type to decay rate and default TTL
// ═══════════════════════════════════════════════════════════════════

const DECAY_CONFIG: Record<MemoryType, { rate: DecayRate; ttlDays?: number }> = {
  preference:        { rate: "slow"   },                    // persists until contradicted
  routine:           { rate: "slow"   },
  obligation:        { rate: "slow"   },
  fact:              { rate: "slow"   },
  decision:          { rate: "slow"   },
  goal_context:      { rate: "medium", ttlDays: 180 },
  financial_context: { rate: "medium", ttlDays: 90  },
  pattern:           { rate: "medium", ttlDays: 120 },
  stress_pattern:    { rate: "medium", ttlDays: 60  },
  warning:           { rate: "fast",   ttlDays: 30  },
};

// ═══════════════════════════════════════════════════════════════════
// DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function stringSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

function checkDuplicate(
  candidate: MemoryCandidate,
  existing: HouseholdMemory[]
): DeduplicationResult {
  const normalTitle = normalizeTitle(candidate.title);

  // Exact title match
  const exact = existing.find(m =>
    m.status !== "deleted" &&
    m.type === candidate.type &&
    normalizeTitle(m.title) === normalTitle
  );
  if (exact) {
    return {
      isDuplicate: true,
      existingMemory: exact,
      action: "merge",
      mergedContent: exact.content, // keep existing, add evidence
    };
  }

  // High similarity match (>70%)
  const similar = existing.find(m =>
    m.status !== "deleted" &&
    m.type === candidate.type &&
    stringSimilarity(m.content, candidate.content) > 0.7
  );
  if (similar) {
    return {
      isDuplicate: true,
      existingMemory: similar,
      action: "merge",
    };
  }

  return { isDuplicate: false, action: "create" };
}

// ═══════════════════════════════════════════════════════════════════
// CONFLICT DETECTION
// ═══════════════════════════════════════════════════════════════════

// Pairs of patterns that suggest contradiction
const CONTRADICTION_PAIRS: [RegExp, RegExp][] = [
  [/prefers.*saving/i, /prefers.*spending/i],
  [/prefers.*delay.*trip/i, /prefers.*take.*trip/i],
  [/conservative.*spending/i, /flexible.*spending/i],
  [/prioritize.*emergency fund/i, /willing.*spend.*emergency/i],
];

function detectConflict(
  candidate: MemoryCandidate,
  existing: HouseholdMemory[]
): ConflictResult {
  for (const [patA, patB] of CONTRADICTION_PAIRS) {
    const matchesNew = patA.test(candidate.content) || patB.test(candidate.content);
    if (!matchesNew) continue;

    const conflicting = existing.find(m => {
      if (m.status === "deleted" || m.status === "contradicted") return false;
      if (m.type !== candidate.type) return false;
      return (patA.test(m.content) && patB.test(candidate.content)) ||
             (patB.test(m.content) && patA.test(candidate.content));
    });

    if (conflicting) {
      return {
        hasConflict: true,
        conflictingMemory: conflicting,
        conflictDescription: `New memory may contradict: "${conflicting.title}"`,
        suggestedResolution: "ask_user",
      };
    }
  }

  return { hasConflict: false };
}

// ═══════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════

async function loadAllMemories(userId: string): Promise<HouseholdMemory[]> {
  try {
    const data = await loadData(userId, "cleo_memory_v2");
    return (data?.memories as HouseholdMemory[]) || [];
  } catch {
    return [];
  }
}

async function saveAllMemories(userId: string, memories: HouseholdMemory[]): Promise<void> {
  await saveData(userId, "cleo_memory_v2", {
    memories,
    updatedAt: new Date().toISOString(),
  });
  invalidateCache(userId, ["cleo_memory_v2"]);
}

// ═══════════════════════════════════════════════════════════════════
// CORE SERVICE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

// ── proposeMemory ─────────────────────────────────────────────────
// Main entry point. AI calls this — never writes directly.
export async function proposeMemory(
  userId: string,
  candidate: MemoryCandidate
): Promise<MemoryProposalResult> {
  // Step 1: Validate
  const validation = validateCandidate(candidate);
  if (!validation.valid) {
    return { action: "rejected", reason: validation.reason };
  }

  const existing = await loadAllMemories(userId);

  // Step 2: Check duplicate
  const dedup = checkDuplicate(candidate, existing);
  if (dedup.isDuplicate && dedup.action === "merge") {
    // Merge evidence into existing memory
    const updated = existing.map(m => {
      if (m.id !== dedup.existingMemory?.id) return m;
      const newEvidence: MemoryEvidence = {
        description: candidate.evidenceDescription,
        observedAt: todayLocal(),
        sourceModule: candidate.sourceModule,
      };
      // Boost confidence if repeated
      const confidenceMap = { low: 0, medium: 1, high: 2 };
      const newConfidence = confidenceMap[m.confidence] < confidenceMap[candidate.confidence]
        ? candidate.confidence : m.confidence;

      return {
        ...m,
        confidence: newConfidence,
        evidence: [...m.evidence, newEvidence].slice(-10), // keep last 10
        updatedAt: new Date().toISOString(),
      };
    });
    await saveAllMemories(userId, updated);
    return {
      action: "saved",
      memory: updated.find(m => m.id === dedup.existingMemory?.id),
      reason: "Merged with existing memory — confidence updated",
    };
  }

  // Step 3: Check conflict
  const conflict = detectConflict(candidate, existing);
  if (conflict.hasConflict) {
    // Mark conflicting memory + save new as needs_confirmation
    const memory = buildMemory(userId, candidate, "needs_confirmation");
    const updated = existing.map(m =>
      m.id === conflict.conflictingMemory?.id
        ? { ...m, status: "contradicted" as MemoryStatus, updatedAt: new Date().toISOString() }
        : m
    );
    await saveAllMemories(userId, [...updated, memory]);
    return {
      action: "needs_confirmation",
      memory,
      reason: conflict.conflictDescription ?? "Conflicts with existing memory",
      prompt: buildConfirmationPrompt(memory, "preference_changed"),
    };
  }

  // Step 4: Decide auto-save vs confirmation
  if (shouldAutoSave(candidate)) {
    const memory = buildMemory(userId, candidate, "active");
    await saveAllMemories(userId, [...existing, memory]);
    return { action: "saved", memory, reason: "Auto-saved — low sensitivity, sufficient confidence" };
  } else {
    const memory = buildMemory(userId, candidate, "needs_confirmation");
    await saveAllMemories(userId, [...existing, memory]);
    return {
      action: "needs_confirmation",
      memory,
      reason: "Requires user confirmation before activating",
      prompt: buildConfirmationPrompt(memory, "new_pattern"),
    };
  }
}

// ── buildMemory ───────────────────────────────────────────────────
function buildMemory(
  userId: string,
  candidate: MemoryCandidate,
  status: MemoryStatus
): HouseholdMemory {
  const decayCfg = DECAY_CONFIG[candidate.type];
  const now = new Date().toISOString();
  const expiresAt = candidate.expiresAt ?? (
    decayCfg.ttlDays
      ? new Date(Date.now() + decayCfg.ttlDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined
  );

  return {
    id: crypto.randomUUID(),
    householdId: userId,
    type: candidate.type,
    title: candidate.title,
    content: candidate.content,
    sourceModule: candidate.sourceModule,
    confidence: candidate.confidence,
    sensitivity: candidate.sensitivity,
    status,
    linkedEntities: candidate.linkedEntities ?? [],
    evidence: [{
      description: candidate.evidenceDescription,
      observedAt: now.split("T")[0],
      sourceModule: candidate.sourceModule,
    }],
    usage: { timesUsed: 0 },
    decay: { shouldDecay: decayCfg.rate !== "slow", decayRate: decayCfg.rate },
    expiresAt,
    createdAt: now,
    updatedAt: now,
    _normalizedTitle: normalizeTitle(candidate.title),
  };
}

// ── buildConfirmationPrompt ───────────────────────────────────────
function buildConfirmationPrompt(
  memory: HouseholdMemory,
  context: "new_pattern" | "preference_changed"
): MemoryConfirmationPrompt {
  const question = context === "preference_changed"
    ? "Your preferences may have changed. Should Cleo update what she remembers?"
    : "Should Cleo remember this to make future suggestions more useful?";

  return {
    memoryId: memory.id,
    question,
    preview: memory.content,
    options: [
      { label: "Remember",        action: "confirm" },
      { label: "Not now",         action: "reject"  },
      { label: "Edit first",      action: "edit"    },
      { label: "Never remember",  action: "never"   },
    ],
  };
}

// ── confirmMemory ─────────────────────────────────────────────────
export async function confirmMemory(userId: string, memoryId: string): Promise<HouseholdMemory | null> {
  const memories = await loadAllMemories(userId);
  const updated = memories.map(m =>
    m.id === memoryId
      ? { ...m, status: "active" as MemoryStatus, lastConfirmedAt: new Date().toISOString(), confidence: "high" as MemoryConfidence, updatedAt: new Date().toISOString() }
      : m
  );
  await saveAllMemories(userId, updated);
  return updated.find(m => m.id === memoryId) ?? null;
}

// ── rejectMemory ──────────────────────────────────────────────────
export async function rejectMemory(userId: string, memoryId: string): Promise<void> {
  const memories = await loadAllMemories(userId);
  const updated = memories.map(m =>
    m.id === memoryId
      ? { ...m, status: "deleted" as MemoryStatus, updatedAt: new Date().toISOString() }
      : m
  );
  await saveAllMemories(userId, updated);
}

// ── updateMemory ──────────────────────────────────────────────────
export async function updateMemory(
  userId: string,
  memoryId: string,
  updates: Partial<Pick<HouseholdMemory, "title" | "content" | "confidence" | "status">>
): Promise<HouseholdMemory | null> {
  const memories = await loadAllMemories(userId);
  const updated = memories.map(m =>
    m.id === memoryId
      ? { ...m, ...updates, updatedAt: new Date().toISOString(), _normalizedTitle: updates.title ? normalizeTitle(updates.title) : m._normalizedTitle }
      : m
  );
  await saveAllMemories(userId, updated);
  return updated.find(m => m.id === memoryId) ?? null;
}

// ── deleteMemory ──────────────────────────────────────────────────
export async function deleteMemory(userId: string, memoryId: string): Promise<void> {
  return rejectMemory(userId, memoryId);
}

// ── markMemoryIncorrect ───────────────────────────────────────────
export async function markMemoryIncorrect(userId: string, memoryId: string): Promise<void> {
  const memories = await loadAllMemories(userId);
  const updated = memories.map(m =>
    m.id === memoryId
      ? { ...m, status: "contradicted" as MemoryStatus, confidence: "low" as MemoryConfidence, updatedAt: new Date().toISOString() }
      : m
  );
  await saveAllMemories(userId, updated);
}

// ═══════════════════════════════════════════════════════════════════
// RETRIEVAL
// ═══════════════════════════════════════════════════════════════════

const CONFIDENCE_RANK: Record<MemoryConfidence, number> = { low: 1, medium: 2, high: 3 };

function scoreMemory(
  memory: HouseholdMemory,
  request: MemoryRetrievalRequest
): number {
  let score = 0;

  // Relevance: keyword overlap with user message
  if (request.userMessage) {
    const queryWords = request.userMessage.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const memWords   = (memory.title + " " + memory.content).toLowerCase().split(/\s+/);
    const overlap    = queryWords.filter(w => memWords.some(mw => mw.includes(w))).length;
    score += overlap * 35;
  }

  // Confidence
  score += CONFIDENCE_RANK[memory.confidence] * 25;

  // Recency
  const daysSince = (Date.now() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 7)   score += 15;
  else if (daysSince < 30) score += 8;

  // Entity link match
  if (request.relatedEntityIds?.length && memory.linkedEntities?.length) {
    const linked = memory.linkedEntities.some(e => request.relatedEntityIds!.includes(e.entityId));
    if (linked) score += 15;
  }

  // Module match
  if (request.sourceModule && memory.sourceModule === request.sourceModule) score += 10;

  // Usage boost — frequently used memories are valuable
  score += Math.min(10, memory.usage.timesUsed * 2);

  return score;
}

export async function retrieveMemories(
  userId: string,
  request: MemoryRetrievalRequest
): Promise<MemoryRetrievalResult> {
  const all = await loadAllMemories(userId);
  const minConfidenceRank = CONFIDENCE_RANK[request.minConfidence ?? "low"];

  const eligible = all.filter(m => {
    if (m.status !== "active") return false;
    if (CONFIDENCE_RANK[m.confidence] < minConfidenceRank) return false;
    if (!request.includeSensitive && m.sensitivity === "high") return false;
    if (request.memoryTypes?.length && !request.memoryTypes.includes(m.type)) return false;
    return true;
  });

  const scored = eligible
    .map(m => ({ memory: m, score: scoreMemory(m, request) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, request.maxResults ?? 8);

  // Update usage
  const usedIds = new Set(scored.map(s => s.memory.id));
  const updatedAll = all.map(m =>
    usedIds.has(m.id)
      ? { ...m, usage: { ...m.usage, timesUsed: m.usage.timesUsed + 1, lastUsedAt: new Date().toISOString() } }
      : m
  );
  // Save usage updates async without blocking
  saveAllMemories(userId, updatedAll).catch(() => {});

  return {
    memories: scored.map(s => s.memory),
    retrievalExplanation: scored.map(s => ({
      memoryId: s.memory.id,
      reason: `Score: ${s.score} — type: ${s.memory.type}, confidence: ${s.memory.confidence}`,
      relevanceScore: s.score,
    })),
  };
}

// Build a prompt-ready memory string (replaces buildMemoryContext)
export async function buildMemoryContextV2(
  userId: string,
  request: Omit<MemoryRetrievalRequest, "householdId">
): Promise<string> {
  const result = await retrieveMemories(userId, { ...request, householdId: userId });
  if (!result.memories.length) return "";

  const byType = result.memories.reduce((acc, m) => {
    if (!acc[m.type]) acc[m.type] = [];
    acc[m.type].push(m.content);
    return acc;
  }, {} as Record<string, string[]>);

  const lines: string[] = [];
  if (byType.preference)        lines.push(`Preferences: ${byType.preference.join(". ")}`);
  if (byType.pattern)           lines.push(`Patterns: ${byType.pattern.join(". ")}`);
  if (byType.financial_context) lines.push(`Financial context: ${byType.financial_context.join(". ")}`);
  if (byType.decision)          lines.push(`Past decisions: ${byType.decision.join(". ")}`);
  if (byType.goal_context)      lines.push(`Goal context: ${byType.goal_context.join(". ")}`);
  if (byType.obligation)        lines.push(`Obligations: ${byType.obligation.join(". ")}`);
  if (byType.fact)              lines.push(`Facts: ${byType.fact.join(". ")}`);
  if (byType.routine)           lines.push(`Routines: ${byType.routine.join(". ")}`);
  if (byType.stress_pattern)    lines.push(`Stress patterns: ${byType.stress_pattern.join(". ")}`);
  if (byType.warning)           lines.push(`Warnings: ${byType.warning.join(". ")}`);

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════
// DECAY + EXPIRATION
// Run periodically (e.g. on app open, once per day)
// ═══════════════════════════════════════════════════════════════════

export async function decayAndExpireMemories(userId: string): Promise<{ expired: number; decayed: number }> {
  const memories = await loadAllMemories(userId);
  const now = Date.now();
  let expired = 0;
  let decayed = 0;

  const updated = memories.map(m => {
    // Expire
    if (m.expiresAt && new Date(m.expiresAt).getTime() < now && m.status === "active") {
      expired++;
      return { ...m, status: "expired" as MemoryStatus, updatedAt: new Date().toISOString() };
    }

    // Decay confidence for unused memories
    if (m.decay.shouldDecay && m.status === "active") {
      const daysSinceUsed = m.usage.lastUsedAt
        ? (now - new Date(m.usage.lastUsedAt).getTime()) / (1000 * 60 * 60 * 24)
        : (now - new Date(m.createdAt).getTime()) / (1000 * 60 * 60 * 24);

      const decayThresholds: Record<DecayRate, number> = { slow: 180, medium: 90, fast: 30 };
      const threshold = decayThresholds[m.decay.decayRate];

      if (daysSinceUsed > threshold && m.confidence === "high") {
        decayed++;
        return { ...m, confidence: "medium" as MemoryConfidence, decay: { ...m.decay, lastDecayAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
      }
      if (daysSinceUsed > threshold * 2 && m.confidence === "medium") {
        decayed++;
        return { ...m, confidence: "low" as MemoryConfidence, decay: { ...m.decay, lastDecayAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
      }
    }

    return m;
  });

  if (expired + decayed > 0) {
    await saveAllMemories(userId, updated);
  }

  return { expired, decayed };
}

// ═══════════════════════════════════════════════════════════════════
// EXPLAINABILITY
// ═══════════════════════════════════════════════════════════════════

export async function explainMemory(userId: string, memoryId: string): Promise<MemoryExplanation | null> {
  const memories = await loadAllMemories(userId);
  const m = memories.find(mem => mem.id === memoryId);
  if (!m) return null;

  const lastUsed = m.usage.lastUsedAt
    ? `Last used ${Math.round((Date.now() - new Date(m.usage.lastUsedAt).getTime()) / (1000 * 60 * 60 * 24))} days ago`
    : "Not yet used in a recommendation";

  return {
    memoryId: m.id,
    title: m.title,
    whatItMeans: m.content,
    whereItCameFrom: `Learned from ${m.sourceModule} on ${m.createdAt.split("T")[0]}. ${m.evidence.length} supporting observations.`,
    whenLastUsed: lastUsed,
    whyItMatters: `This ${m.type} helps Cleo give more relevant ${m.sourceModule} recommendations.`,
    howToEdit: "Go to Settings → Cleo Memory to edit, delete, or mark this incorrect.",
  };
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS VIEW
// Powers the Settings → Cleo Memory screen
// ═══════════════════════════════════════════════════════════════════

export async function getMemorySettingsView(userId: string): Promise<MemorySettingsView> {
  const all = await loadAllMemories(userId);
  const active = all.filter(m => m.status !== "deleted");

  const byType = active.reduce((acc, m) => {
    acc[m.type] = (acc[m.type] ?? 0) + 1;
    return acc;
  }, {} as Record<MemoryType, number>);

  return {
    totalMemories: active.length,
    byType,
    pendingConfirmation: active.filter(m => m.status === "needs_confirmation"),
    recentlyUsed: active
      .filter(m => m.usage.lastUsedAt)
      .sort((a, b) => new Date(b.usage.lastUsedAt!).getTime() - new Date(a.usage.lastUsedAt!).getTime())
      .slice(0, 5),
    sensitive: active.filter(m => m.sensitivity === "high"),
    all: active.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  };
}

// ═══════════════════════════════════════════════════════════════════
// LOAD ALL (for Settings screen)
// ═══════════════════════════════════════════════════════════════════

export async function loadMemoriesV2(userId: string): Promise<HouseholdMemory[]> {
  return loadAllMemories(userId);
}

// ═══════════════════════════════════════════════════════════════════
// V1 → V2 MIGRATION (migration Step 4)
// Maps a legacy cleo_memory fact into a V2 candidate, and runs a one-time
// migration so V2 becomes the single memory store of record.
// ═══════════════════════════════════════════════════════════════════

export function v1FactToCandidate(f: MemoryFact): MemoryCandidate {
  const typeMap: Record<string, MemoryType> = {
    family: "fact", health: "fact", preference: "preference",
    goal: "goal_context", schedule: "routine", temporary: "fact",
  };
  return {
    type: typeMap[f.type] || "fact",
    title: f.statement.slice(0, 60),
    content: f.statement,
    sourceModule: "cleo",
    // Already accepted in V1 → migrate at medium confidence so it auto-saves.
    confidence: f.confidence >= 0.8 ? "high" : "medium",
    sensitivity: "low",
    evidenceDescription: `Migrated from V1 memory (${f.source})`,
    expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : undefined,
  };
}

// One-time, idempotent (guarded by a marker). Safe to call on every bootstrap.
export async function migrateV1MemoriesToV2(userId: string): Promise<{ migrated: number }> {
  try {
    const v1 = await loadData(userId, "cleo_memory");
    if (!v1 || (v1 as any)._migratedToV2) return { migrated: 0 };
    const facts = ((v1.facts as MemoryFact[]) || []);
    let migrated = 0;
    for (const f of facts) {
      const res = await proposeMemory(userId, v1FactToCandidate(f));
      if (res.action === "saved") migrated++;
    }
    await saveData(userId, "cleo_memory", { _migratedToV2: true }); // merge — keeps facts
    return { migrated };
  } catch (e) {
    console.warn("[Memory] V1→V2 migration failed (non-fatal):", e);
    return { migrated: 0 };
  }
}
