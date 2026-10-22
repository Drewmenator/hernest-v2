// ─── Household snapshot ────────────────────────────────────────────
// A light read of how full the household's week is: calendar load, an
// upcoming trip, and recent mood and sleep. Cleo's opening line and the Trips
// list use it to pitch their tone. Money was removed in simplify phase 3 (the
// old Budget record it read is no longer written; bills reach Cleo through
// contextRetrieval instead).
import { loadData } from "../firebase";
import type { HouseholdSnapshot } from "../store";

type Ev = { date?: string };
type Trip = { destination?: string; departureDate?: string };
type MoodLog = { value?: number };
type SleepLog = { hours?: number };

// Local calendar day (not UTC: in a US evening UTC is already tomorrow,
// which dropped today's events from the week count).
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Pure part, exported for tests.
export function snapshotFrom(
  docs: { calendar?: { events?: Ev[] } | null; thrive?: { moodLog?: MoodLog[]; sleepLog?: SleepLog[] } | null; trips?: { trips?: Trip[] } | null },
  now: Date = new Date(),
): HouseholdSnapshot {
  const events = docs.calendar?.events || [];
  const today = isoDay(now);
  const in7 = isoDay(new Date(now.getTime() + 7 * 86400000));
  const in14 = isoDay(new Date(now.getTime() + 14 * 86400000));
  const week = events.filter(e => e.date && e.date >= today && e.date <= in7).length;
  const fortnight = events.filter(e => e.date && e.date >= today && e.date <= in14).length;
  const calendarLoad: HouseholdSnapshot["calendarLoad"] =
    week >= 12 ? "critical" : week >= 7 ? "heavy" : week >= 3 ? "normal" : "light";

  const mood = (docs.thrive?.moodLog || []).slice(-5).map(l => l.value || 3);
  const sleep = (docs.thrive?.sleepLog || []).slice(-5).map(l => l.hours || 7);
  const avg = (xs: number[], fallback: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback);
  const avgMood = avg(mood, 3);
  const avgSleep = avg(sleep, 7);

  const trip = (docs.trips?.trips || [])
    .map(t => ({ t, days: t.departureDate ? Math.ceil((new Date(t.departureDate).getTime() - now.getTime()) / 86400000) : NaN }))
    .filter(x => x.days >= 0 && x.days <= 14)
    .sort((a, b) => a.days - b.days)[0];

  const stress =
    (avgMood < 2 ? 3 : avgMood < 3 ? 1 : 0) +
    (avgSleep < 5 ? 3 : avgSleep < 6 ? 1 : 0) +
    (calendarLoad === "critical" ? 2 : calendarLoad === "heavy" ? 1 : 0) +
    (trip ? 1 : 0);

  return {
    calendarLoad,
    busyWeeksAhead: Math.min(3, Math.floor(fortnight / 5)),
    householdStressLevel: stress >= 4 ? "high" : stress >= 2 ? "moderate" : "low",
    upcomingTrip: trip ? { name: trip.t.destination || "Your trip", daysUntil: trip.days } : undefined,
    wellness: { avgMood: Math.round(avgMood * 10) / 10, avgSleep: Math.round(avgSleep * 10) / 10 },
    lastRefreshed: now.toISOString(),
  };
}

export async function buildHouseholdSnapshot(userId: string): Promise<HouseholdSnapshot> {
  const [thrive, calendar, trips] = await Promise.all([
    loadData(userId, "thrive"),
    loadData(userId, "calendar"),
    loadData(userId, "trips"),
  ]);
  return snapshotFrom({ thrive: thrive as never, calendar: calendar as never, trips: trips as never });
}
