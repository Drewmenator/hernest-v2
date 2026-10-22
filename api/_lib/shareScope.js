// ─── What a partner may be shown ───────────────────────────────────
// Only household collections can ever be shared with a partner, whatever an
// invite asks for. Private records (wellness, Cleo's memories, profile,
// subscription, push state, invites) are never included. Keep in line with
// householdShared() in firestore.rules and HOUSEHOLD_COLLECTIONS in
// src/core/identity.ts.
export const SHAREABLE_CATEGORIES = [
  "tasks", "chores", "bills", "calendar", "calendar_synced",
  "school", "trips", "family", "circle", "budget", "budget_v2",
];

export function safeShareCategories(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(c => typeof c === "string" && SHAREABLE_CATEGORIES.includes(c)))];
}
