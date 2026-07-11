// ─── Date awareness (server mirror of src/core/dateAwareness.ts) ────
// Serverless functions are JS and can't import the app's TS, so the same
// birthday/age logic lives here. Keep the two in sync. Handles both
// "YYYY-MM-DD" (date-picker) and legacy "MM-DD" (no year) strings.

export function parseDateParts(s) {
  if (!s || typeof s !== "string") return null;
  const nums = s.split("-").map((n) => parseInt(n, 10));
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (nums.length === 3) {
    const [a, b, c] = nums;
    if (a > 31) return { year: a, month: b, day: c };
    return { year: c > 31 ? c : undefined, month: a, day: b };
  }
  if (nums.length === 2) return { month: nums[0], day: nums[1] };
  return null;
}

export function computeAge(birthDate, now = new Date()) {
  const p = parseDateParts(birthDate);
  if (!p || !p.year) return null;
  let age = now.getFullYear() - p.year;
  const monthDiff = (now.getMonth() + 1) - p.month;
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < p.day)) age--;
  return age >= 0 && age < 130 ? age : null;
}

export function daysUntilBirthday(birthday, now = new Date()) {
  const p = parseDateParts(birthday);
  if (!p) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), p.month - 1, p.day);
  if (next.getTime() < today.getTime()) next = new Date(now.getFullYear() + 1, p.month - 1, p.day);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

export function isBirthdayToday(birthday, now = new Date()) {
  const p = parseDateParts(birthday);
  if (!p) return false;
  return (now.getMonth() + 1) === p.month && now.getDate() === p.day;
}

// Age someone turns on their birthday (for "June turns 7 today"). Needs a year.
export function turningAge(birthDate, now = new Date()) {
  const p = parseDateParts(birthDate);
  if (!p || !p.year) return null;
  if (isBirthdayToday(birthDate, now)) return now.getFullYear() - p.year;
  const age = computeAge(birthDate, now);
  return age == null ? null : age + 1;
}

export const todayISO = (now = new Date()) => now.toISOString().split("T")[0];
