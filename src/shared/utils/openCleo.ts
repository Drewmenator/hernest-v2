import { useStore } from "../../core/store";

export const CLEO_PREFILL_KEY = "hn_cleo_prefill";

// Open the Cleo tab, optionally with a message ready to send.
export function openCleo(prefill?: string) {
  try { if (prefill) sessionStorage.setItem(CLEO_PREFILL_KEY, prefill); } catch { /* private mode */ }
  useStore.getState().setActiveTab("cleo");
}
