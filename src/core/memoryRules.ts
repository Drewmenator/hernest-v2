// ─── Memory trust rules ────────────────────────────────────────────
// The small, pure rules that decide what Cleo may remember and what she may
// use. Kept free of Firebase so they are easy to test and to read.
//
//   1. Only things the user typed in herself ("Tell Cleo something") go
//      straight to active. Anything Cleo inferred waits for a yes.
//   2. Moods, health and distress are never suggested as lasting memories.
//   3. Only active, unexpired memories ever reach Cleo's context.
//   4. A suggestion the user said no to (or asked Cleo to forget) is not
//      suggested again.

// Where a memory came from.
//   user_typed: the user wrote it in "Tell Cleo something"
//   inferred:   Cleo picked it up from a chat or from app activity
//   imported:   carried over from the old memory store
export type MemoryOrigin = "user_typed" | "inferred" | "imported";

// Who can see it. Everything is private to the person who owns it for now.
export type MemoryVisibility = "private" | "household";

// The user's say-so on this memory.
//   user_typed: she wrote it, so no question was needed
//   pending:    waiting for her OK
//   confirmed:  she said yes
//   declined:   she said no
//   legacy:     saved before the ask-first rule; never asked
export type MemoryConfirmation = "user_typed" | "pending" | "confirmed" | "declined" | "legacy";

// Moods, health and distress: temporary or sensitive, never a lasting memory.
const SENSITIVE_STATE_PATTERNS: RegExp[] = [
  // feelings and mood
  /\b(stress(ed|ful)?|anxious|anxiety|depress(ed|ion)?|overwhelm(ed|ing)?|exhausted|burn(ed|t)[ -]?out|lonely|sad|upset|angry|furious|crying|cried|tearful|hopeless|worthless|miserable|grief|grieving|mood|panic(king)?|scared|afraid|frustrated)\b/i,
  /\bfeel(s|ing)?\s+(so\s+|really\s+|very\s+)?(bad|low|down|awful|terrible|tired|empty|numb)\b/i,
  // distress and crisis
  /\b(can'?t cope|falling apart|breaking down|suicid\w*|self[- ]harm|hurt (my|her)self|end it all|abuse[ds]?|violen(ce|t))\b/i,
  // health and body
  /\b(health|sick|illness|ill\b|diagnos\w*|disease|disorder|medication|meds\b|prescription|pills?|therapy|therapist|psychiatr\w*|counsel(l)?or|doctor|surgery|cancer|diabetes|pregnan\w*|miscarr\w*|fertility|ivf|menopaus\w*|postpartum|ppd|adhd|autism|insomnia|migraine|pain|injur\w*|weight|diet(ing)?|eating disorder|alcohol|drinking|sober|addict\w*)\b/i,
  /\b(my|her) period\b/i,
];

// Memory types that only ever describe a feeling or a health state.
const SENSITIVE_TYPES = new Set(["stress_pattern", "health", "temporary"]);

export function isSensitiveState(text: string, type?: string): boolean {
  if (type && SENSITIVE_TYPES.has(type)) return true;
  return SENSITIVE_STATE_PATTERNS.some(p => p.test(text));
}

// The status a brand-new memory starts with. Only the user's own words skip
// the question.
export function initialStatusFor(origin: MemoryOrigin | undefined): "active" | "needs_confirmation" {
  return origin === "user_typed" ? "active" : "needs_confirmation";
}

export function initialConfirmationFor(origin: MemoryOrigin | undefined): MemoryConfirmation {
  return origin === "user_typed" ? "user_typed" : "pending";
}

interface ContextCheckable {
  status: string;
  expiresAt?: string;
}

// The one gate between stored memories and Cleo's context.
export function isUsableInContext(m: ContextCheckable, now: number = Date.now()): boolean {
  if (m.status !== "active") return false;
  if (m.expiresAt) {
    const t = new Date(m.expiresAt).getTime();
    if (!Number.isNaN(t) && t < now) return false;
  }
  return true;
}

// Statuses that mean "the user said no" or "forget this". Cleo must not
// suggest the same thing again.
export function blocksResuggestion(status: string): boolean {
  return status === "rejected" || status === "deleted";
}

// Pick which waiting suggestions to show in chat after a reply: only ones
// from this chat, only ones not shown before, at most `limit`. Anything not
// picked still waits in "What Cleo knows".
interface Suggestable {
  id: string;
  status: string;
  createdAt: string;
  usage?: { lastShownToUserAt?: string };
}

export function pickChatSuggestions<M extends Suggestable>(
  memories: M[],
  sinceIso: string,
  limit = 2,
): M[] {
  return memories
    .filter(m => m.status === "needs_confirmation")
    .filter(m => !m.usage?.lastShownToUserAt)
    .filter(m => m.createdAt >= sinceIso)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.max(0, limit));
}
