// ─── HerNest Household Identity (pure) ───────────────────────────
// Migration Step 1. No Firestore here — just the canonical accessor and
// the household/user collection-scoping map. Firestore ops live in
// householdService.ts to avoid an import cycle with firebase.ts.
//
// The model is deliberately zero-migration: a household's id IS the owner's
// uid. A solo user's household id === their own uid (so nothing changes for
// them). A joined partner resolves to the owner's uid (so they share data).

import { useStore } from "./store";

// Collections shared across the whole household (resolve to the owner's namespace).
// Anything NOT listed stays personal to each signed-in user (profile, settings,
// household_link, partner_invite, integrations).
//
// NOTE: thrive (wellness) and cleo_memory* are intentionally left OUT for now —
// they hold sensitive personal data. They graduate to household scope in Step 5,
// once per-member consent/visibility filtering exists. Do not add them early.
export const HOUSEHOLD_COLLECTIONS = new Set<string>([
  "budget",
  "budget_v2",
  "tasks",
  "calendar",
  "trips",
  "school",
  "circle",
  "household_insights",
  "household_graph",
]);

export function isHouseholdCollection(collection: string): boolean {
  return HOUSEHOLD_COLLECTIONS.has(collection);
}

// The canonical accessor — use this instead of user.uid for household data.
// Falls back to the signed-in uid, so solo users and any pre-bootstrap calls
// behave exactly as they did before this change.
export function getHouseholdId(): string | null {
  const s = useStore.getState();
  return s.currentHouseholdId ?? s.user?.uid ?? null;
}
