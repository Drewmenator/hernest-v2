// ─── Date/time awareness ─────────────────────────────────────────────
// Ages and birthdays must reflect TODAY, not the day they were entered. The
// app stored `age` as a frozen number, so a child stayed 6 forever. The fix:
// derive age live from a full date of birth, and parse birthdays robustly.
//
// Stored birthday/DOB strings come in two shapes:
//   "YYYY-MM-DD" — full date, from <input type="date"> (the source of truth)
//   "MM-DD"      — legacy month/day only, no year (can't yield an age)
// parseDateParts handles both so every consumer reads them correctly.

// Local-time YYYY-MM-DD for "today". Use this instead of
// `new Date().toISOString().split("T")[0]`, which returns the UTC date and is
// a day ahead/behind for users west/east of UTC (breaks due-today/overdue math).
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface DateParts { year?: number; month: number; day: number; }

export function parseDateParts(s?: string | null): DateParts | null {
  if (!s || typeof s !== "string") return null;
  const nums = s.split("-").map((n) => parseInt(n, 10));
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (nums.length === 3) {
    const [a, b, c] = nums;
    // Year-first (YYYY-MM-DD) is what date pickers emit; detect by magnitude.
    if (a > 31) return { year: a, month: b, day: c };
    // Fallback: MM-DD-YYYY-ish — treat first two as month/day.
    return { year: c > 31 ? c : undefined, month: a, day: b };
  }
  if (nums.length === 2) return { month: nums[0], day: nums[1] };
  return null;
}

// Age in whole years from a full DOB, using today. Returns null without a year
// (a bare "MM-DD" can't produce an age) or for nonsensical values.
export function computeAge(birthDate?: string | null, now: Date = new Date()): number | null {
  const p = parseDateParts(birthDate);
  if (!p || !p.year) return null;
  let age = now.getFullYear() - p.year;
  const monthDiff = (now.getMonth() + 1) - p.month;
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < p.day)) age--;
  return age >= 0 && age < 130 ? age : null;
}

// Whole days until the next occurrence of this birthday (0 = today).
export function daysUntilBirthday(birthday?: string | null, now: Date = new Date()): number | null {
  const p = parseDateParts(birthday);
  if (!p) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), p.month - 1, p.day);
  if (next.getTime() < today.getTime()) next = new Date(now.getFullYear() + 1, p.month - 1, p.day);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

export function isBirthdayToday(birthday?: string | null, now: Date = new Date()): boolean {
  const p = parseDateParts(birthday);
  if (!p) return false;
  return (now.getMonth() + 1) === p.month && now.getDate() === p.day;
}

// The age someone turns ON their next/most-recent birthday — for celebratory
// copy ("June turns 7 today"). Needs a birth year; null otherwise.
export function turningAge(birthDate?: string | null, now: Date = new Date()): number | null {
  const p = parseDateParts(birthDate);
  if (!p || !p.year) return null;
  if (isBirthdayToday(birthDate, now)) return now.getFullYear() - p.year;
  const age = computeAge(birthDate, now);
  return age == null ? null : age + 1; // the age at the upcoming birthday
}

// Preferred display age for a person who may have a full DOB and/or a stored
// static age. A real DOB always wins (it's live); fall back to the stored age.
export function displayAge(person: { birthDate?: string | null; age?: number | null }): number | null {
  const fromDob = computeAge(person.birthDate);
  if (fromDob != null) return fromDob;
  return typeof person.age === "number" ? person.age : null;
}
