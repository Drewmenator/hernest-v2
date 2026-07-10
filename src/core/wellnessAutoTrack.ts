// ─── Wellness auto-tracking ────────────────────────────────────────
// Connectors (Oura, Apple Health) know sleep and movement — so log them
// automatically instead of asking. Thrive only asks what a wearable can't
// know (mood, water). Runs on app open (after connector sync) and when the
// Thrive screen mounts. Manual logs always win: auto-log never overwrites
// an entry the user created or adjusted.
import { doc, getDoc } from "firebase/firestore";
import { db, loadData, saveData } from "./firebase";
import { bus } from "./events";

export interface WearableDay {
  source: "oura" | "apple_health";
  date: string;
  sleepHours: number | null;
  sleepScore: number | null;   // Oura only
  readiness: number | null;    // Oura only
  steps: number | null;
  // Tier 1 recovery + stress (Oura only)
  avgHrv: number | null;
  restingHr: number | null;
  readinessContributors: Record<string, number> | null;
  stressDay: "restored" | "normal" | "stressful" | null;
  stressHighMins: number | null;
  recoveryHighMins: number | null;
  // Tier 2 activity detail (Oura only)
  activeCalories: number | null;
  sedentaryMins: number | null;
  activityScore: number | null;
}

const STEPS_GOAL = 7000; // auto-completes the "Move your body" habit

function scoreToQuality(score: number | null): "poor" | "fair" | "good" | "excellent" {
  if (score == null) return "good";
  return score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 55 ? "fair" : "poor";
}

// Latest wearable snapshot — Oura preferred (richer), Apple Health fallback.
export async function readWearable(uid: string): Promise<WearableDay | null> {
  const recentCutoff = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
  try {
    const [ouraSnap, ahSnap] = await Promise.all([
      getDoc(doc(db, "users", uid, "integrations", "oura")),
      getDoc(doc(db, "users", uid, "integrations", "apple_health")),
    ]);
    const oura = ouraSnap.data();
    if (oura?.date && oura.date >= recentCutoff && (oura.lastSleepHours != null || oura.steps != null)) {
      return {
        source: "oura", date: oura.date,
        sleepHours: oura.lastSleepHours ?? null,
        sleepScore: oura.sleepScore ?? null,
        readiness: oura.readinessScore ?? null,
        steps: oura.steps ?? null,
        avgHrv: oura.avgHrv ?? null,
        restingHr: oura.restingHr ?? null,
        readinessContributors: oura.readinessContributors ?? null,
        stressDay: oura.stressDay ?? null,
        stressHighMins: oura.stressHighMins ?? null,
        recoveryHighMins: oura.recoveryHighMins ?? null,
        activeCalories: oura.activeCalories ?? null,
        sedentaryMins: oura.sedentaryMins ?? null,
        activityScore: oura.activityScore ?? null,
      };
    }
    const ah = ahSnap.data();
    if (ah?.date && ah.date >= recentCutoff && (ah.lastSleepHours != null || ah.lastSteps != null)) {
      return {
        source: "apple_health", date: ah.date,
        sleepHours: ah.lastSleepHours ?? null,
        sleepScore: null, readiness: null,
        steps: ah.lastSteps ?? null,
        avgHrv: null, restingHr: null, readinessContributors: null,
        stressDay: null, stressHighMins: null, recoveryHighMins: null,
        activeCalories: null, sedentaryMins: null, activityScore: null,
      };
    }
  } catch (e) {
    console.warn("[WellnessAutoTrack] wearable read failed:", e);
  }
  return null;
}

// Auto-log sleep + movement into the thrive doc. Returns what changed.
export async function autoTrackWellness(uid: string): Promise<{ wearable: WearableDay | null; sleepLogged: boolean; moveDone: boolean }> {
  const wearable = await readWearable(uid);
  if (!wearable) return { wearable: null, sleepLogged: false, moveDone: false };

  try {
    const d = (await loadData(uid, "thrive")) || {};
    const sleepLog = (d.sleepLog as any[]) || [];
    const habits = (d.habits as any[]) || [];
    const updates: Record<string, unknown> = {};
    let sleepLogged = false;
    let moveDone = false;

    // Sleep: log/refresh from the wearable. A manual entry always wins and is
    // never touched; but a previous WEARABLE entry may be updated (Oura keeps
    // finalizing a night through the morning, and a parsing fix can correct a
    // bad value) — so re-sync when the hours changed, unless the user edited it.
    const wHours = wearable.sleepHours;
    const existingSleep = sleepLog.find(l => l?.date === wearable.date);
    const canWriteSleep = wHours != null && (
      !existingSleep ||
      (existingSleep.source !== "manual" && Math.round((existingSleep.hours || 0) * 10) !== Math.round(wHours * 10))
    );
    if (canWriteSleep && wHours != null) {
      const entry = {
        date: wearable.date,
        hours: Math.round(wHours * 10) / 10,
        quality: scoreToQuality(wearable.sleepScore),
        source: wearable.source,
      };
      updates.sleepLog = [...sleepLog.filter(l => l?.date !== wearable.date), entry];
      // Auto-detect the "sleep 7+" habit like the manual flow does
      if (habits.length) {
        updates.habits = habits.map(h =>
          h.id === "sleep7" ? { ...h, done: wHours >= 7, streak: wHours >= 7 ? (h.streak || 0) + 1 : 0, lastCompleted: wearable.date } : h
        );
      }
      sleepLogged = true;
    }

    // Movement: steps goal reached today → complete the "move" habit
    const today = new Date().toISOString().split("T")[0];
    if (wearable.steps != null && wearable.steps >= STEPS_GOAL && wearable.date === today) {
      const base = (updates.habits as any[]) || habits;
      const move = base.find(h => h.id === "move");
      if (move && !(move.done && move.lastCompleted === today)) {
        updates.habits = base.map(h =>
          h.id === "move" ? { ...h, done: true, streak: (h.streak || 0) + 1, lastCompleted: today } : h
        );
        moveDone = true;
      }
    }

    if (Object.keys(updates).length) {
      await saveData(uid, "thrive", updates);
      if (sleepLogged) {
        bus.publish("thrive.sleep.logged", { hours: wearable.sleepHours, quality: scoreToQuality(wearable.sleepScore), source: wearable.source }, { userId: uid, source: "wellnessAutoTrack" }).catch(() => {});
      }
    }
    return { wearable, sleepLogged, moveDone };
  } catch (e) {
    console.warn("[WellnessAutoTrack] failed:", e);
    return { wearable, sleepLogged: false, moveDone: false };
  }
}
