// ─── HerNest Household Context Graph — Persistence ────────────────
// src/core/graph/persistence.ts
//
// Firestore load/save + debounced save scheduling.

import { loadData, saveData } from "../firebase";
import { GRAPH_KEY, CACHE_TTL_MS } from "./internals";
import type { HouseholdContextGraph, GraphNode } from "./types";

// Debounced cloud save — coalesces rapid event updates into one write
// (the in-memory graph in the hook stays current; only persistence is deferred).
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingSave: { userId: string; graph: HouseholdContextGraph } | null = null;

export function scheduleGraphSave(userId: string, graph: HouseholdContextGraph, delayMs = 4000): void {
  _pendingSave = { userId, graph };
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const p = _pendingSave;
    _saveTimer = null;
    _pendingSave = null;
    if (p) saveGraphToFirestore(p.userId, p.graph).catch(() => {});
  }, delayMs);
}

// nodeIndex duplicates every node in the doc; rebuild it on load instead of storing it.
function rebuildNodeIndex(graph: HouseholdContextGraph): Record<string, GraphNode> {
  const idx: Record<string, GraphNode> = {};
  const all: GraphNode[] = [
    ...graph.people, ...graph.finances, ...graph.calendar, ...graph.tasks,
    ...graph.goals, ...graph.decisions, ...graph.memories, ...graph.insights,
  ];
  all.forEach(n => { if (n?.id) idx[n.id] = n; });
  if (graph.stress?.id) idx[graph.stress.id] = graph.stress;
  return idx;
}

export async function saveGraphToFirestore(userId: string, graph: HouseholdContextGraph): Promise<void> {
  try {
    // Strip nodeIndex before persisting — it's rebuilt on load.
    const persisted: Partial<HouseholdContextGraph> = { ...graph };
    delete persisted.nodeIndex;
    await saveData(userId, GRAPH_KEY, JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>);
  } catch (e) {
    console.error("[Graph] save failed:", e);
  }
}

export async function loadGraphFromFirestore(userId: string): Promise<HouseholdContextGraph | null> {
  try {
    const data = await loadData(userId, GRAPH_KEY);
    if (!data) return null;
    const graph = data as unknown as HouseholdContextGraph;
    const isStale = (Date.now() - new Date(graph.lastUpdated).getTime()) > CACHE_TTL_MS;
    if (isStale) return null;
    graph.nodeIndex = rebuildNodeIndex(graph);
    return graph;
  } catch { return null; }
}
