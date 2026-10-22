// ─── "Your family": the one people list ──────────────────────────
// People used to live in three places: Family members (family doc), Circle
// contacts (circle doc) and Profile family fields (profile.partner/kids/
// parents/inlaws). mergePeople() copies Circle and Profile people into the
// family members list once, skipping anyone already there by name. It never
// removes anything, and the old circle/profile data is left untouched.
import type { FamilyMember } from "./store";

export type CheckInEvery = "weekly" | "biweekly" | "monthly" | "quarterly";

// FamilyMember plus the extra details that came over from Circle. The store's
// FamilyMember type is shared, so these live here as optional fields.
export interface Person extends FamilyMember {
  relation?: string;          // finer label: grandparent, sibling, friend, colleague…
  birthday?: string;          // "MM-DD" when the year isn't known (birthDate is full YYYY-MM-DD)
  giftIdeas?: string;
  checkIn?: CheckInEvery;     // optional "check in with them" reminder
  lastCheckIn?: string;       // YYYY-MM-DD
  emoji?: string;
  importedFrom?: "circle" | "profile";
}

export const CHECK_IN_DAYS: Record<CheckInEvery, number> = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 90 };

const COLORS = ["#F472A0", "#5BB8E8", "#4CAF7D", "#F97316", "#C9A961", "#8B7BB5", "#e07b54"];

export function normalizeName(name?: string | null): string {
  return (name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Full dates go in birthDate (drives age); "MM-DD" goes in birthday.
function splitBirthday(b?: string | null): { birthDate?: string; birthday?: string } {
  if (!b || typeof b !== "string") return {};
  const s = b.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { birthDate: s };
  if (/^\d{1,2}-\d{1,2}$/.test(s)) return { birthday: s };
  return {};
}

interface CircleContact {
  id?: string; name?: string; relationship?: string; birthday?: string; age?: number;
  contactFrequency?: string; lastInteraction?: { date?: string }; notes?: string; emoji?: string;
  interests?: string[];
}

interface ProfileLike {
  partner?: { name?: string; birthday?: string } | string | null;
  kids?: Array<{ id?: string; name?: string; birthDate?: string; birthday?: string; age?: number; school?: string; allergies?: string[] }>;
  children?: ProfileLike["kids"];
  parents?: Array<{ name?: string; birthday?: string }>;
  inlaws?: Array<{ name?: string; birthday?: string }>;
}

function circleToPerson(c: CircleContact): Omit<Person, "id" | "color"> | null {
  if (!c?.name?.trim()) return null;
  const rel = c.relationship || "other";
  const role: FamilyMember["role"] = rel === "partner" ? "partner" : rel === "child" ? "child" : rel === "parent" ? "parent" : "other";
  const freq = c.contactFrequency === "daily" ? "weekly" : c.contactFrequency;
  // Only carry the check-in reminder for people you don't live with.
  const checkIn = role === "partner" || role === "child" ? undefined
    : (["weekly", "biweekly", "monthly", "quarterly"].includes(freq || "") ? freq as CheckInEvery : undefined);
  return {
    name: c.name.trim(),
    role,
    relation: role === "other" ? rel : undefined,
    ...splitBirthday(c.birthday),
    age: typeof c.age === "number" ? c.age : undefined,
    notes: [c.notes, ...(c.interests?.length ? [`likes ${c.interests.join(", ")}`] : [])].filter(Boolean).join(" · ") || undefined,
    checkIn,
    lastCheckIn: c.lastInteraction?.date || undefined,
    emoji: c.emoji,
    importedFrom: "circle",
  };
}

function profilePeople(p: ProfileLike | null | undefined): Array<Omit<Person, "id" | "color"> & { id?: string }> {
  if (!p) return [];
  const out: Array<Omit<Person, "id" | "color"> & { id?: string }> = [];
  const partnerName = typeof p.partner === "string" ? p.partner : p.partner?.name;
  if (partnerName?.trim()) {
    out.push({ name: partnerName.trim(), role: "partner", ...splitBirthday(typeof p.partner === "object" ? p.partner?.birthday : undefined), importedFrom: "profile" });
  }
  for (const k of (p.kids || p.children || [])) {
    if (!k?.name?.trim()) continue;
    out.push({
      id: k.id, name: k.name.trim(), role: "child",
      ...splitBirthday(k.birthDate || k.birthday),
      age: typeof k.age === "number" ? k.age : undefined,
      notes: (k.allergies || []).length ? `allergies: ${(k.allergies || []).join(", ")}` : undefined,
      schoolInfo: k.school ? { country: "US", schoolType: "public", schoolName: k.school } : undefined,
      importedFrom: "profile",
    });
  }
  for (const g of (p.parents || [])) {
    if (g?.name?.trim()) out.push({ name: g.name.trim(), role: "parent", relation: "grandparent", ...splitBirthday(g.birthday), importedFrom: "profile" });
  }
  for (const g of (p.inlaws || [])) {
    if (g?.name?.trim()) out.push({ name: g.name.trim(), role: "inlaw", ...splitBirthday(g.birthday), importedFrom: "profile" });
  }
  return out;
}

// Fill gaps on an existing person from a duplicate, never overwriting.
function fillGaps(existing: Person, extra: Partial<Person>): Person {
  const next: Person = { ...existing };
  let changed = false;
  for (const key of ["birthDate", "birthday", "age", "notes", "giftIdeas", "checkIn", "lastCheckIn", "emoji", "relation", "schoolInfo"] as const) {
    if (next[key] == null && extra[key] != null) { (next as unknown as Record<string, unknown>)[key] = extra[key]; changed = true; }
  }
  // A full date of birth beats a year-less birthday.
  if (next.birthDate && next.birthday) { delete next.birthday; changed = true; }
  return changed ? next : existing;
}

export interface MergeResult { members: Person[]; added: number; updated: number; }

export function mergePeople(
  members: FamilyMember[] | null | undefined,
  circleContacts: CircleContact[] | null | undefined,
  profile: ProfileLike | null | undefined,
  makeId: () => string = () => crypto.randomUUID(),
): MergeResult {
  const result: Person[] = [...((members || []) as Person[])];
  const index = new Map<string, number>();
  result.forEach((m, i) => { const k = normalizeName(m.name); if (k && !index.has(k)) index.set(k, i); });
  const usedIds = new Set(result.map(m => m.id));
  let added = 0, updated = 0;

  const take = (incoming: Omit<Person, "id" | "color"> & { id?: string }) => {
    const key = normalizeName(incoming.name);
    if (!key) return;
    const at = index.get(key);
    if (at != null) {
      const merged = fillGaps(result[at], incoming);
      if (merged !== result[at]) { result[at] = merged; updated++; }
      return;
    }
    const id = incoming.id && !usedIds.has(incoming.id) ? incoming.id : makeId();
    usedIds.add(id);
    const person = Object.fromEntries(Object.entries({ ...incoming, id, color: COLORS[result.length % COLORS.length] })
      .filter(([, v]) => v !== undefined)) as unknown as Person;
    index.set(key, result.length);
    result.push(person);
    added++;
  };

  // Profile first: it holds full kid DOBs and school names; Circle fills the rest.
  profilePeople(profile).forEach(take);
  (circleContacts || []).map(circleToPerson).forEach(p => { if (p) take(p); });

  return { members: result, added, updated };
}

// The label shown under a person's name.
export function relationLabel(p: Person): string {
  if (p.relation) return p.relation;
  return ({ partner: "partner", child: "child", parent: "grandparent", inlaw: "in-law", other: "friend" } as const)[p.role] || p.role;
}

// Days until a check-in is due (negative = overdue). null when no reminder set.
export function checkInDueIn(p: Person, today: string): number | null {
  if (!p.checkIn) return null;
  const every = CHECK_IN_DAYS[p.checkIn];
  if (!p.lastCheckIn) return 0;
  const last = new Date(p.lastCheckIn + "T00:00:00").getTime();
  const now = new Date(today + "T00:00:00").getTime();
  if (isNaN(last) || isNaN(now)) return 0;
  return every - Math.round((now - last) / 86400000);
}
