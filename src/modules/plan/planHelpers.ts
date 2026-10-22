// Pure helpers for Plan: week dates, chores as tasks, the Week list, and
// bringing Family's old dinner plan into Plan → Meals.
import { todayLocal } from "../../core/dateAwareness";

// Other screens can open Plan on a given view (e.g. the old Calendar → Week).
export const PLAN_TAB_KEY = "hn_plan_tab";

export const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Local YYYY-MM-DD (toISOString is UTC, which is tomorrow on US evenings).
export const ymd = (d: Date) => todayLocal(d);

// Monday of the week containing `now` (Sunday belongs to the week that
// started six days earlier, not the next one).
export function mondayOf(now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  return d;
}

// The seven YYYY-MM-DD dates Monday..Sunday for the week containing `now`.
export function weekDates(now: Date = new Date()): string[] {
  const mon = mondayOf(now);
  return Array.from({ length: 7 }, (_, i) => ymd(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)));
}

// The seven dates Sunday..Saturday for the week containing `now`. The Week
// view uses this (US calendars start on Sunday); meal plans stay Monday-first.
export function sundayWeekDates(now: Date = new Date()): string[] {
  const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  return Array.from({ length: 7 }, (_, i) => ymd(new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + i)));
}

// ── Chores (family.tasks) shown as Plan tasks ────────────────────
export interface Chore { id: string; title: string; assignedTo?: string; done?: boolean; dueDate?: string; }

export interface PlanTaskLike {
  id: string; title: string;
  category: string; priority: string;
  status: "pending" | "completed";
  source: string; energyRequired: string; userConfirmed: boolean;
  dueDate?: string; createdAt: number;
  who?: string;
  isChore?: boolean;
}

export function choresToTasks(chores: Chore[] | null | undefined): PlanTaskLike[] {
  return (chores || []).filter(c => c && c.id && c.title).map(c => ({
    id: `chore:${c.id}`,
    title: c.title,
    category: "home",
    priority: "nice",
    status: c.done ? "completed" : "pending",
    source: "chore",
    energyRequired: "low",
    userConfirmed: true,
    ...(c.dueDate ? { dueDate: c.dueDate } : {}),
    createdAt: 0,
    who: c.assignedTo || "Everyone",
    isChore: true,
  }));
}

export const choreIdOf = (taskId: string) => taskId.startsWith("chore:") ? taskId.slice(6) : null;

// ── Week view: calendar + school + chores in one list ────────────
export interface WeekItem {
  id: string; date?: string; time?: string; title: string;
  kind: "event" | "school" | "birthday" | "trip" | "chore" | "task";
  who?: string; color?: string; done?: boolean;
}

interface EventLike { id?: string; title?: string; date?: string; time?: string; source?: string; child?: string; color?: string; }

export function buildWeekItems(input: {
  events?: EventLike[];
  schoolEvents?: EventLike[];
  chores?: Chore[];
  tasks?: Array<{ id: string; title: string; dueDate?: string; status?: string; who?: string }>;
  week: string[];
}): { byDay: Record<string, WeekItem[]>; undated: WeekItem[] } {
  const inWeek = new Set(input.week);
  const byDay: Record<string, WeekItem[]> = Object.fromEntries(input.week.map(d => [d, []]));
  const undated: WeekItem[] = [];
  const seen = new Set<string>();
  const sig = (date: string, title: string) => `${date}|${title.trim().toLowerCase()}`;

  const put = (item: WeekItem) => {
    if (!item.date) { undated.push(item); return; }
    if (!inWeek.has(item.date)) return;
    const key = sig(item.date, item.title);
    if (seen.has(key)) return;      // same event saved in two places (e.g. school doc + calendar doc)
    seen.add(key);
    byDay[item.date].push(item);
  };

  for (const e of input.events || []) {
    if (!e?.title || !e.date) continue;
    const date = e.date.slice(0, 10);
    const kind: WeekItem["kind"] = e.source === "school" || e.source === "school-term" ? "school"
      : e.source === "birthday" ? "birthday" : e.source === "trip" ? "trip" : "event";
    put({ id: `ev:${e.id || sig(date, e.title)}`, date, time: e.time, title: e.title, kind, who: e.child, color: e.color });
  }
  for (const e of input.schoolEvents || []) {
    if (!e?.title || !e.date) continue;
    const date = e.date.slice(0, 10);
    put({ id: `sc:${e.id || sig(date, e.title)}`, date, time: e.time, title: e.title, kind: "school", who: e.child });
  }
  for (const t of input.tasks || []) {
    if (!t.dueDate || t.status === "completed") continue;
    put({ id: `tk:${t.id}`, date: t.dueDate, title: t.title, kind: "task", who: t.who });
  }
  for (const c of input.chores || []) {
    if (!c?.title || c.done) continue;
    put({ id: `ch:${c.id}`, date: c.dueDate, title: c.title, kind: "chore", who: c.assignedTo || "Everyone" });
  }

  const order: Record<WeekItem["kind"], number> = { birthday: 0, trip: 1, event: 2, school: 3, task: 4, chore: 5 };
  for (const d of input.week) {
    byDay[d].sort((a, b) => (a.time || "").localeCompare(b.time || "") || order[a.kind] - order[b.kind]);
  }
  return { byDay, undated };
}

// Birthdays from the family list, placed in the given year.
export function birthdayEvents(people: Array<{ id: string; name: string; birthDate?: string; birthday?: string }>, year: number): EventLike[] {
  const out: EventLike[] = [];
  for (const p of people) {
    const raw = p.birthDate || p.birthday;
    if (!raw) continue;
    const parts = raw.split("-");
    const [m, d] = parts.length === 3 ? [parts[1], parts[2]] : [parts[0], parts[1]];
    if (!m || !d) continue;
    for (const y of [year, year + 1]) {       // a week can span New Year
      out.push({ id: `bday-${p.id}-${y}`, title: `${p.name}'s birthday`, date: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`, source: "birthday" });
    }
  }
  return out;
}

// ── Family → Dinners into Plan → Meals ───────────────────────────
export interface FamilyDinner { day?: string; dayName?: string; dinner?: string; }

// Old Family dinner plans had day names but no dates. Show them as this week's
// dinners so nothing disappears; generating a new plan replaces them.
export function familyDinnersToPlan(dinners: FamilyDinner[] | null | undefined, now: Date = new Date()) {
  const week = weekDates(now);
  const days = (dinners || [])
    .map(d => ({ name: d.day || d.dayName || "", dinner: (d.dinner || "").trim() }))
    .filter(d => DAYS_OF_WEEK.includes(d.name) && d.dinner)
    .sort((a, b) => DAYS_OF_WEEK.indexOf(a.name) - DAYS_OF_WEEK.indexOf(b.name))
    .map(d => ({ date: week[DAYS_OF_WEEK.indexOf(d.name)], dayName: d.name, dinner: d.dinner }));
  if (!days.length) return null;
  return { days, shoppingList: [] as never[], generatedAt: 0, fromFamily: true };
}
