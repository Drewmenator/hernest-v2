// ─── HerNest Context Graph — React Hook ──────────────────────────
// src/core/graph/useContextGraph.ts

import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store";
import { getHouseholdId } from "../identity";
import {
  createContextGraph, loadGraphFromFirestore,
  updateGraphFromModuleEvent, detectCrossModulePatterns,
  generateContextPackForCleo, generateContextPackForCFO,
} from "./GraphService";
import type { HouseholdContextGraph, ModuleEvent, CleoContextPack, CFOContextPack } from "./types";

interface UseContextGraphReturn {
  graph: HouseholdContextGraph | null;
  cleoPack: CleoContextPack | null;
  cfoPack: CFOContextPack | null;
  loading: boolean;
  refresh: () => Promise<void>;
  handleEvent: (event: ModuleEvent) => Promise<void>;
}

export function useContextGraph(): UseContextGraphReturn {
  const { user } = useStore();
  const [graph, setGraph] = useState<HouseholdContextGraph | null>(null);
  const [cleoPack, setCleoPack] = useState<CleoContextPack | null>(null);
  const [cfoPack, setCfoPack] = useState<CFOContextPack | null>(null);
  const [loading, setLoading] = useState(false);

  const buildPacks = useCallback((g: HouseholdContextGraph) => {
    setCleoPack(generateContextPackForCleo(g, useStore.getState().user?.uid));
    setCfoPack(generateContextPackForCFO(g));
  }, []);

  const refresh = useCallback(async () => {
    const hid = getHouseholdId();
    if (!hid) return;
    setLoading(true);
    try {
      const cached = await loadGraphFromFirestore(hid);
      if (cached) {
        setGraph(cached);
        buildPacks(cached);
      } else {
        const fresh = await createContextGraph(hid);
        await detectCrossModulePatterns(fresh, hid);
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
    const hid = getHouseholdId();
    if (!graph || !hid) return;
    const updated = await updateGraphFromModuleEvent(hid, event, { ...graph });
    setGraph(updated);
    buildPacks(updated);
  }, [graph, user?.uid, buildPacks]);

  useEffect(() => { refresh(); }, [user?.uid]);

  return { graph, cleoPack, cfoPack, loading, refresh, handleEvent };
}
