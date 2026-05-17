// ─── HerNest Context Graph — React Hook ──────────────────────────
// src/core/graph/useContextGraph.ts

import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store";
import {
  createContextGraph, loadGraphFromFirestore,
  updateGraphFromModuleEvent, detectCrossModulePatterns,
  generateContextPackForNora, generateContextPackForCFO,
} from "./GraphService";
import type { HouseholdContextGraph, ModuleEvent, NoraContextPack, CFOContextPack } from "./types";

interface UseContextGraphReturn {
  graph: HouseholdContextGraph | null;
  noraPack: NoraContextPack | null;
  cfoPack: CFOContextPack | null;
  loading: boolean;
  refresh: () => Promise<void>;
  handleEvent: (event: ModuleEvent) => Promise<void>;
}

export function useContextGraph(): UseContextGraphReturn {
  const { user } = useStore();
  const [graph, setGraph] = useState<HouseholdContextGraph | null>(null);
  const [noraPack, setNoraPack] = useState<NoraContextPack | null>(null);
  const [cfoPack, setCfoPack] = useState<CFOContextPack | null>(null);
  const [loading, setLoading] = useState(false);

  const buildPacks = useCallback((g: HouseholdContextGraph) => {
    setNoraPack(generateContextPackForNora(g));
    setCfoPack(generateContextPackForCFO(g));
  }, []);

  const refresh = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    try {
      const cached = await loadGraphFromFirestore(user.uid);
      if (cached) {
        setGraph(cached);
        buildPacks(cached);
      } else {
        const fresh = await createContextGraph(user.uid);
        await detectCrossModulePatterns(fresh, user.uid);
        setGraph(fresh);
        buildPacks(fresh);
      }
    } catch (e) {
      console.error("[useContextGraph] refresh failed:", e);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, buildPacks]);

  const handleEvent = useCallback(async (event: ModuleEvent) => {
    if (!graph || !user?.uid) return;
    const updated = await updateGraphFromModuleEvent(user.uid, event, { ...graph });
    setGraph(updated);
    buildPacks(updated);
  }, [graph, user?.uid, buildPacks]);

  useEffect(() => { refresh(); }, [user?.uid]);

  return { graph, noraPack, cfoPack, loading, refresh, handleEvent };
}
