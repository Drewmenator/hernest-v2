// ─── Today screen data (pure, testable) ────────────────────────────
// Turns the raw saved docs into the two short lists on Today:
// "Needs you" (most urgent first, max 5) and "This week".
import { daysUntilDue, displayAmount, type Bill } from "../../core/bills";
import { daysUntilBirthday, todayLocal } from "../../core/dateAwareness";
import { formatMoney } from "../../shared/utils/money";

export type NeedsKind = "bill" | "task" | "school" | "birthday" | "trip";

export interface NeedsItem {
  id: string;
  kind: NeedsKind;
  label: string;
  detail: string;
  tab: string;          // where tapping it goes
  urgent: boolean;      // overdue / today
  billId?: string;      // bill items get a Paid button
}

export interface Person { name?: string; birthday?: string; birthDate?: string }

export interface TaskLike { title?: string; text?: string; status?: string; done?: boolean; dueDate?: string }
export interface SchoolLike { id?: string; title?: string; child?: string; date?: string; requiresAction?: boolean; actionDeadline?: string }
export interface TripLike { destination?: string; departureDate?: string; date?: string; packingList?: { done?: boolean }[] }
export interface EventLike { title?: unknown; time?: unknown; date?: unknown }

export interface TodayDocs {
  bills?: Bill[];
  tasks?: TaskLike[];
  school?: SchoolLike[];
  trips?: TripLike[];
  people?: Person[];
}

export const NEEDS_MAX = 5;

const dayDiff = (iso: string | undefined, today: string): number | null => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const a = new Date(iso.slice(0, 10) + "T00:00:00").getTime();
  const b = new Date(today + "T00:00:00").getTime();
  return Math.round((a - b) / 86400000);
};

const isDone = (t: TaskLike) => t?.status === "completed" || t?.status === "done" || t?.done === true;

const whenWord = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);

export function tripDays(trip: TripLike, today: string): number | null {
  return dayDiff(trip?.departureDate || trip?.date, today);
}

// The next trip that hasn't started yet (or starts today).
export function nextTrip(trips: TripLike[] = [], now: Date = new Date()): { trip: TripLike; days: number } | null {
  const today = todayLocal(now);
  const upcoming = trips
    .map(t => ({ trip: t, days: tripDays(t, today) }))
    .filter((x): x is { trip: TripLike; days: number } => x.days != null && x.days >= 0)
    .sort((a, b) => a.days - b.days);
  return upcoming[0] || null;
}

export function buildNeedsYou(docs: TodayDocs, opts: { tripsOn: boolean; now?: Date }): NeedsItem[] {
  const now = opts.now ?? new Date();
  const today = todayLocal(now);
  const out: NeedsItem[] = [];

  // 1. Bills overdue or due today that she pays herself.
  for (const b of docs.bills || []) {
    if (!b?.name || b.autopay) continue;
    const d = daysUntilDue(b, now);
    if (d == null || d > 0) continue;
    const { amount } = displayAmount(b);
    out.push({
      id: `bill_${b.id}`, kind: "bill", billId: b.id, tab: "budget", urgent: true,
      label: d < 0 ? `${b.name} is overdue` : `${b.name} is due today`,
      detail: [amount ? formatMoney(amount) : "", d < 0 ? `${-d} day${d < -1 ? "s" : ""} late` : ""].filter(Boolean).join(" · "),
    });
  }

  // 2. Overdue tasks (one line, however many there are).
  const overdue = (docs.tasks || []).filter(t => !isDone(t) && t?.dueDate && t.dueDate.slice(0, 10) < today);
  if (overdue.length === 1) {
    out.push({ id: "tasks_overdue", kind: "task", tab: "plan", urgent: true, label: `${overdue[0].title || overdue[0].text || "A task"} is overdue`, detail: "" });
  } else if (overdue.length > 1) {
    out.push({ id: "tasks_overdue", kind: "task", tab: "plan", urgent: true, label: `${overdue.length} tasks are overdue`, detail: "Do one, move the rest" });
  }

  // 3. School deadlines in the next 3 days.
  for (const e of docs.school || []) {
    if (!e?.requiresAction) continue;
    const d = dayDiff(e.actionDeadline || e.date, today);
    if (d == null || d < 0 || d > 3) continue;
    out.push({ id: `school_${e.id || e.title}`, kind: "school", tab: "plan", urgent: d === 0, label: e.title || "School form", detail: `${e.child ? e.child + " · " : ""}needed ${whenWord(d)}` });
  }

  // 4. Birthdays in the next 7 days (deduped by name).
  const seen = new Set<string>();
  for (const p of docs.people || []) {
    const name = (p?.name || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    const d = daysUntilBirthday(p.birthday || p.birthDate, now);
    if (d == null || d > 7) continue;
    seen.add(name.toLowerCase());
    out.push({ id: `bday_${name}`, kind: "birthday", tab: "family", urgent: d === 0, label: d === 0 ? `${name}'s birthday is today` : `${name}'s birthday is ${whenWord(d)}`, detail: "" });
  }

  // 5. Trip prep, only if Trips is switched on.
  if (opts.tripsOn) {
    const nt = nextTrip(docs.trips, now);
    if (nt && nt.days <= 14) {
      const list = nt.trip.packingList || [];
      const pct = list.length ? Math.round((list.filter(i => i?.done).length / list.length) * 100) : 0;
      if (pct < 60) out.push({ id: "trip_prep", kind: "trip", tab: "trips", urgent: nt.days <= 3, label: `Pack for ${nt.trip.destination || "your trip"}`, detail: `Leaves ${whenWord(nt.days)} · ${list.length ? `packing ${pct}% done` : "no packing list yet"}` });
    }
  }

  // Urgent first; otherwise keep the order above (bills, tasks, school, ...).
  return out
    .map((it, i) => ({ it, i }))
    .sort((a, b) => Number(b.it.urgent) - Number(a.it.urgent) || a.i - b.i)
    .map(x => x.it)
    .slice(0, NEEDS_MAX);
}

// "3 bills this week · $380": unpaid bills due today through the next 6 days.
export function billsThisWeek(bills: Bill[] = [], now: Date = new Date()): { count: number; total: number } {
  let count = 0, total = 0;
  for (const b of bills) {
    if (!b?.name) continue;
    const d = daysUntilDue(b, now);
    if (d == null || d < 0 || d > 6) continue;
    count++;
    total += displayAmount(b).amount || 0;
  }
  return { count, total: Math.round(total) };
}

export interface DayEvent { title: string; time?: string; date: string }

// Today's and tomorrow's events, earliest first.
export function eventsTodayTomorrow(events: EventLike[] = [], now: Date = new Date()): { today: DayEvent[]; tomorrow: DayEvent[] } {
  const today = todayLocal(now);
  const t = new Date(now); t.setDate(t.getDate() + 1);
  const tomorrow = todayLocal(t);
  const pick = (day: string) => events
    .filter(e => e?.title && typeof e.date === "string" && e.date.slice(0, 10) === day)
    .map(e => ({ title: String(e.title), time: e.time ? String(e.time) : undefined, date: day }))
    .sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  return { today: pick(today), tomorrow: pick(tomorrow) };
}
