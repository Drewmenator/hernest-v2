// ─── Briefing filter: drop filler the AI invents ─────────────────────
// The brief should only point at real things: her tasks, calendar, school,
// bills, trips, birthdays. Asked for a fixed number of priorities, the AI used
// to pad the list with generic advice ("spend 15 minutes with your son") and
// app chores ("log your sleep"). The prompt now says not to; this is the
// safety net, applied to fresh and cached briefings alike.

// Generic parenting / family-time advice.
const FAMILY_TIME = /\b(quality|one[- ]on[- ]one|1[- ]on[- ]1|special|bonding|uninterrupted|undistracted|connection)\s+time\b|\bspend\s+(some\s+|a\s+few\s+)?(\d+\s*(-\s*\d+\s*)?|a\s+few\s+|some\s+)?(min(ute)?s?|moments?|time)\s+(with|together)\b|\b(connect|bond|reconnect)\s+with\s+(your|her|the)\s+(son|daughter|kids?|child(ren)?|little\s+ones?|family)\b/i;
// Asking her to log or track something in the app.
const LOG_IN_APP = /\b(log|logging|track|tracking|record|recording|enter|add)\s+(your\s+|her\s+|last\s+night'?s\s+|today'?s\s+)*(sleep|mood|energy|habits?|water|steps|check-?in|wellness)\b|\bcheck[- ]in\s+(in|on)\s+(thrive|the\s+app)\b/i;

export function isFiller(text: string | null | undefined): boolean {
  if (!text) return false;
  return FAMILY_TIME.test(text) || LOG_IN_APP.test(text);
}

interface FilterableBriefing {
  priorities?: { rank: number; text: string; whyToday?: string }[];
  tasks?: { aiSuggestion: string; completionNote: string };
  energy?: { tip: string; scheduleSuggestion: string } | null;
}

export function cleanBriefing<B extends FilterableBriefing>(b: B): B {
  if (!b) return b;
  const priorities = (b.priorities || [])
    .filter(p => !isFiller(p?.text) && !isFiller(p?.whyToday))
    .map((p, i) => ({ ...p, rank: i + 1 }));
  return {
    ...b,
    priorities,
    ...(b.tasks ? { tasks: { ...b.tasks, aiSuggestion: isFiller(b.tasks.aiSuggestion) ? "" : b.tasks.aiSuggestion } } : {}),
    ...(b.energy ? { energy: {
      ...b.energy,
      tip: isFiller(b.energy.tip) ? "" : b.energy.tip,
      scheduleSuggestion: isFiller(b.energy.scheduleSuggestion) ? "" : b.energy.scheduleSuggestion,
    } } : {}),
  };
}
