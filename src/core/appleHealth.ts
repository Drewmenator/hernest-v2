// ─── Apple Health (HealthKit), read directly on the iPhone ──────────
// Replaces the iOS Shortcut workaround (which could only send sleep hours and
// steps) on the native app. Reads the last week from HealthKit and stores a
// daily summary in users/{uid}/data/apple_health, the same shape
// wellnessAutoTrack already understands, plus heart and exercise data.
// The web app can't read HealthKit and keeps the Shortcut path.
import { Capacitor } from "@capacitor/core";
import type { HealthDataType, HealthSample, Workout } from "@capgo/capacitor-health";
import { loadData, saveData } from "./firebase";
import type { WearableDayPoint } from "./wellnessAutoTrack";

const READ_TYPES: HealthDataType[] = [
  "sleep", "steps", "restingHeartRate", "heartRateVariability", "exerciseTime", "mindfulness", "workouts",
];
// Bumped when READ_TYPES grows, so people who connected earlier can be asked
// once for the new types (iOS only shows the sheet for types not asked yet).
export const READ_TYPES_VERSION = 2; // 2: workouts
const ASLEEP = new Set(["asleep", "rem", "deep", "light"]);
const DAYS = 7;

export function appleHealthSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

async function plugin() {
  const { Health } = await import("@capgo/capacitor-health");
  return Health;
}

// Local YYYY-MM-DD for an ISO timestamp (HealthKit returns UTC instants).
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const minutesBetween = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000);

// Hours asleep per night, keyed by the local day the person woke up. Uses
// stage data when present; ignores in-bed and awake time. When several
// sources (Watch, iPhone, a sleep app) record the same night, the one with the
// most sleep wins rather than adding them up.
export function sleepHoursByNight(samples: HealthSample[]): Record<string, number> {
  const bySourceNight: Record<string, number> = {};
  for (const smp of samples) {
    const night = localDay(smp.endDate);
    const source = smp.sourceId || smp.sourceName || "unknown";
    let mins = 0;
    if (smp.hasStageData && smp.stages?.length) {
      mins = smp.stages.filter(st => ASLEEP.has(st.stage)).reduce((a, st) => a + st.durationMinutes, 0);
    } else if (!smp.sleepState || ASLEEP.has(smp.sleepState)) {
      mins = minutesBetween(smp.startDate, smp.endDate);
    }
    const key = `${night}|${source}`;
    bySourceNight[key] = (bySourceNight[key] || 0) + mins;
  }
  const out: Record<string, number> = {};
  for (const [key, mins] of Object.entries(bySourceNight)) {
    const night = key.split("|")[0];
    out[night] = Math.max(out[night] || 0, Math.round((mins / 60) * 10) / 10);
  }
  return out;
}

// Workout minutes per local day. Workouts logged by the Fitness app or another
// app (Peloton, Strava...) count even without an Apple Watch.
export function workoutMinutesByDay(workouts: Workout[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of workouts) {
    const day = localDay(w.startDate);
    out[day] = (out[day] || 0) + Math.max(0, w.duration || 0) / 60;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

// Asks iOS for read access. iOS never says whether the person allowed it, so
// we just try to read afterwards.
export async function connectAppleHealth(uid: string): Promise<"connected" | "unavailable" | "error"> {
  if (!appleHealthSupported()) return "unavailable";
  try {
    const Health = await plugin();
    const { available } = await Health.isAvailable();
    if (!available) return "unavailable";
    await Health.requestAuthorization({ read: READ_TYPES });
    await saveData(uid, "apple_health", { connected: true, connectedAt: Date.now(), readTypesVersion: READ_TYPES_VERSION });
    await syncAppleHealth(uid);
    return "connected";
  } catch (e) {
    console.warn("[AppleHealth] connect failed:", e);
    return "error";
  }
}

// Connected before workouts were read? Ask iOS once more for the new types.
export async function appleHealthNeedsUpgrade(uid: string): Promise<boolean> {
  if (!appleHealthSupported()) return false;
  const d = await loadData(uid, "apple_health").catch(() => null);
  return !!d?.connected && ((d.readTypesVersion as number) || 1) < READ_TYPES_VERSION;
}

// True if the saved summary has any real number in it. iOS gives an app
// empty results (not an error) when Health sharing is off for it.
export function hasHealthData(d: Record<string, unknown> | null | undefined): boolean {
  if (!d) return false;
  const vals = [d.lastSleepHours, d.lastSteps, d.restingHr, d.avgHrv, d.exerciseMins, d.mindfulMins];
  if (vals.some(v => typeof v === "number" && v > 0)) return true;
  const hist = Array.isArray(d.history) ? (d.history as Record<string, unknown>[]) : [];
  return hist.some(p => ["sleepHours", "steps", "hrv", "restingHr", "activeMins"].some(k => typeof p?.[k] === "number" && (p[k] as number) > 0));
}

// "off": not connected · "no_data": connected but the iPhone shares nothing
// (Health permission skipped or turned off) · "ok": data is coming in.
export async function appleHealthState(uid: string): Promise<"off" | "no_data" | "ok"> {
  if (!appleHealthSupported()) return "off";
  const d = await loadData(uid, "apple_health").catch(() => null);
  if (!d?.connected) return "off";
  return hasHealthData(d) ? "ok" : "no_data";
}

// Stops reading and clears the saved summary. (Only iOS can withdraw the
// permission itself: Settings > Health > Data Access & Devices.)
export async function disconnectAppleHealth(uid: string): Promise<void> {
  await saveData(uid, "apple_health", {
    connected: false, disconnectedAt: Date.now(),
    lastSleepHours: null, lastSteps: null, restingHr: null, avgHrv: null, exerciseMins: null, mindfulMins: null, history: [],
  });
}

export async function isAppleHealthConnected(uid: string): Promise<boolean> {
  if (!appleHealthSupported()) return false;
  const d = await loadData(uid, "apple_health").catch(() => null);
  return !!d?.connected;
}

// Reads the last week and stores the summary. Safe to call often.
export async function syncAppleHealth(uid: string): Promise<boolean> {
  if (!(await isAppleHealthConnected(uid))) return false;
  try {
    const Health = await plugin();
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (DAYS - 1));
    const range = { startDate: start.toISOString(), endDate: end.toISOString() };
    const sleepRange = { startDate: new Date(start.getTime() - 12 * 3600000).toISOString(), endDate: range.endDate };

    const daily = async (dataType: HealthDataType, aggregation: "sum" | "average") => {
      const res = await Health.queryAggregated({ dataType, ...range, bucket: "day", aggregation }).catch(() => ({ samples: [] }));
      const map: Record<string, number> = {};
      for (const b of res.samples) map[localDay(b.startDate)] = b.value;
      return map;
    };
    const [sleepRes, workoutRes, steps, restingHr, hrv, exercise, mindful] = await Promise.all([
      Health.readSamples({ dataType: "sleep", ...sleepRange, limit: 500 }).catch(() => ({ samples: [] })),
      Health.queryWorkouts({ ...range, limit: 200 }).catch(() => ({ workouts: [] as Workout[] })),
      daily("steps", "sum"),
      daily("restingHeartRate", "average"),
      daily("heartRateVariability", "average"),
      daily("exerciseTime", "sum"),
      daily("mindfulness", "sum"),
    ]);
    const sleep = sleepHoursByNight(sleepRes.samples);
    const workoutMins = workoutMinutesByDay(workoutRes.workouts);

    const days: string[] = [];
    for (let i = 0; i < DAYS; i++) days.push(localDay(new Date(start.getTime() + i * 86400000).toISOString()));
    const round = (n: number | undefined) => (n == null ? null : Math.round(n));
    const history: WearableDayPoint[] = days.map(day => ({
      day,
      sleepHours: sleep[day] ?? null,
      sleepScore: null, readiness: null,
      hrv: round(hrv[day]), restingHr: round(restingHr[day]),
      steps: round(steps[day]),
      stressDay: null,
      // Exercise ring minutes already include Watch workouts; take whichever is
      // larger so a workout logged by another app still counts.
      activeMins: exercise[day] == null && workoutMins[day] == null ? null : Math.max(round(exercise[day]) ?? 0, workoutMins[day] ?? 0),
    }));
    const today = days[days.length - 1];

    await saveData(uid, "apple_health", {
      connected: true,
      source: "healthkit",
      date: today,
      lastSleepHours: sleep[today] ?? null,
      lastSteps: round(steps[today]),
      restingHr: round(restingHr[today]),
      avgHrv: round(hrv[today]),
      exerciseMins: round(exercise[today]),
      mindfulMins: round(mindful[today]),
      history,
      syncedAt: Date.now(),
    });
    return true;
  } catch (e) {
    console.warn("[AppleHealth] sync failed:", e);
    return false;
  }
}
