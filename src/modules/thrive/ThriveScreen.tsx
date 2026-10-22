// ─── Wellness (Thrive, rethought) ──────────────────────────────────
// One screen, usable in 30 seconds: Cleo's note for today, read from the
// measured numbers (she no longer asks about mood or energy; the body data
// says more), the body card, "move this week" dots that fill themselves
// from Apple Health or Oura, at most one suggestion, up to 3 optional small
// habits and a plain weekly summary. The weekly AI score and the Coach chat
// are gone: "Ask Cleo about this" opens the Cleo tab instead.
// Export name stays ThriveScreen so the Me tab can render it.
import React, { useEffect, useMemo, useState } from "react";
import { trackEvent } from "../../core/analytics";
import { T, F, ATMOS } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, GlowCard, Headline, Skeleton, ProgressRing, PullToRefresh } from "../../shared/components";
import { ThriveVitals } from "./ThriveVitals";
import { loadData, saveData } from "../../core/firebase";
import { bus } from "../../core/events";
import { todayLocal } from "../../core/dateAwareness";
import { openCleo } from "../../shared/utils/openCleo";
import type { WearableDay } from "../../core/wellnessAutoTrack";
import { dayTone } from "../../core/thriveCheckin";
import {
  GOAL_PRESETS, HABIT_CHOICES, MAX_HABITS,
  addDays, weekDays, activityByDay, weekDots, goalProgress, moveStreak,
  pickSuggestion, habitsFromPicks, toggleHabit, isHabitDoneToday, sleepForWeek,
  weekSummary, goalLabel, isValidGoal, cleoWellnessPrompt,
  type MoveGoal, type HabitRow, type StoredRow,
} from "./wellnessLogic";

// Refresh Apple Health / Oura, auto-log sleep, and hand back what changed.
async function fetchWearable(uid: string): Promise<{ wearable: WearableDay | null; sleepLog: StoredRow[] | null }> {
  try {
    const { autoTrackWellness } = await import("../../core/wellnessAutoTrack");
    const r = await autoTrackWellness(uid);
    const sleepLog = r.sleepLogged ? ((await loadData(uid, "thrive"))?.sleepLog as StoredRow[] | undefined) ?? null : null;
    return { wearable: r.wearable, sleepLog };
  } catch {
    return { wearable: null, sleepLog: null };
  }
}

const label: React.CSSProperties = { fontFamily: F.sans, fontSize: 17, fontWeight: 700, color: T.text, margin: "0 0 10px" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", padding: "6px 0", fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: T.action, cursor: "pointer", minHeight: 44 };
const chip = (on: boolean): React.CSSProperties => ({
  padding: "9px 14px", borderRadius: 20, border: `1.5px solid ${on ? T.esp : T.linen}`, background: on ? T.esp : "#fff",
  color: on ? "#fff" : T.bark, fontFamily: F.sans, fontSize: 13, cursor: "pointer", touchAction: "manipulation", minHeight: 40,
});

export function ThriveScreen() {
  const { user, profile } = useStore();
  const uid = user?.uid;
  const name = profile?.name || "";
  const today = todayLocal();
  const hour = new Date().getHours();

  const [loaded, setLoaded] = useState(false);
  const [sleepLog, setSleepLog] = useState<StoredRow[]>([]);
  const [goal, setGoal] = useState<MoveGoal | null>(null);
  const [movedDays, setMovedDays] = useState<string[]>([]);
  const [habitPicks, setHabitPicks] = useState<string[]>([]);
  const [habits, setHabits] = useState<HabitRow[]>([]);
  const [wearable, setWearable] = useState<WearableDay | null>(null);
  const [eventsToday, setEventsToday] = useState(0);
  const [checkinText, setCheckinText] = useState("");
  const [healthUpgrade, setHealthUpgrade] = useState(false);
  const [onIphone, setOnIphone] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [editingGoal, setEditingGoal] = useState(false);
  const [editingHabits, setEditingHabits] = useState(false);
  const [showBody, setShowBody] = useState(false);
  const [suggestionHidden, setSuggestionHidden] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────
  const applyWearable = (r: { wearable: WearableDay | null; sleepLog: StoredRow[] | null }) => {
    setWearable(r.wearable);
    if (r.sleepLog) setSleepLog(r.sleepLog);
  };

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    loadData(uid, "thrive").then(d => {
      if (!alive) return;
      setSleepLog((d?.sleepLog as StoredRow[]) || []);
      if (isValidGoal(d?.moveGoal)) setGoal(d!.moveGoal as MoveGoal);
      setMovedDays(Array.isArray(d?.movedDays) ? (d!.movedDays as string[]) : []);
      const picks = Array.isArray(d?.habitPicks) ? (d!.habitPicks as string[]).filter(id => HABIT_CHOICES.some(h => h.id === id)) : [];
      setHabitPicks(picks);
      setHabits(habitsFromPicks(picks, d?.habits as Partial<HabitRow>[] | undefined));
      setLoaded(true);
    }).catch(() => setLoaded(true));
    fetchWearable(uid).then(r => { if (alive) applyWearable(r); });
    import("../../core/upcomingEvents")
      .then(m => m.loadUpcomingEvents(uid, 1))
      .then(evs => { if (alive) setEventsToday(evs.length); })
      .catch(() => {});
    import("../../core/appleHealth").then(async m => {
      if (!alive) return;
      setOnIphone(m.appleHealthSupported());
      setHealthUpgrade(await m.appleHealthNeedsUpgrade(uid));
    }).catch(() => {});
    return () => { alive = false; };
  }, [uid]);

  // Cleo's note, from real wearable numbers, cached once a day
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    import("../../core/thriveCheckin").then(async ({ generateCheckin }) => {
      const text = await generateCheckin(uid, name, wearable);
      if (alive) setCheckinText(text);
    }).catch(() => {});
    return () => { alive = false; };
  }, [uid, name, wearable]);

  // ── Derived ──────────────────────────────────────────────────────
  // A lighter day comes from the body data, not a question.
  const lighterDay = dayTone(wearable) === "lighter";

  const days = useMemo(() => weekDays(today), [today]);
  const activity = useMemo(() => activityByDay(wearable), [wearable]);
  const dots = goal ? weekDots(goal, today, activity, movedDays) : null;
  const progress = goal && dots ? goalProgress(goal, dots) : null;
  const todayDot = dots?.find(d => d.date === today);
  const movedToday = todayDot?.state === "moved";
  const tappedToday = movedDays.includes(today);
  const streak = dots ? moveStreak(dots) : 0;
  const daysSoFar = days.filter(d => d <= today).length;

  const suggestion = suggestionHidden ? null : pickSuggestion({
    hour, sleepHours: wearable?.date === today ? wearable.sleepHours : null,
    readiness: wearable?.readiness ?? null, mood: null, energy: lighterDay ? "low" : null, eventsToday,
    progress, movedToday, streak, sedentaryMins: wearable?.sedentaryMins,
  });

  const summary = weekSummary({
    sleepHours: sleepForWeek(days, wearable, sleepLog),
    movedDays: progress ? progress.done : null,
    daysSoFar,
    moods: [],
  });

  // ── Actions ──────────────────────────────────────────────────────
  const chooseGoal = async (g: MoveGoal) => {
    if (!uid) return;
    setGoal(g); setEditingGoal(false);
    await saveData(uid, "thrive", { moveGoal: g });
    trackEvent("move_goal_set", { type: g.type, amount: g.amount, days: g.days });
  };

  const toggleMovedToday = async () => {
    if (!uid) return;
    const updated = tappedToday
      ? movedDays.filter(d => d !== today)
      : [...movedDays.filter(d => d >= addDays(today, -30)), today]; // a month is plenty
    setMovedDays(updated);
    await saveData(uid, "thrive", { movedDays: updated });
    if (!tappedToday) trackEvent("moved_today_tapped");
  };

  const togglePick = (id: string) => {
    setHabitPicks(p => p.includes(id) ? p.filter(x => x !== id) : p.length >= MAX_HABITS ? p : [...p, id]);
  };
  const saveHabitPicks = async () => {
    if (!uid) return;
    const rows = habitsFromPicks(habitPicks, habits);
    setHabits(rows); setEditingHabits(false);
    await saveData(uid, "thrive", { habitPicks, habits: rows });
    trackEvent("habits_chosen", { count: habitPicks.length });
  };
  const tickHabit = async (id: string) => {
    if (!uid) return;
    const rows = toggleHabit(habits, id, today);
    setHabits(rows);
    await saveData(uid, "thrive", { habits: rows });
    const h = rows.find(r => r.id === id);
    if (h && isHabitDoneToday(h, today)) {
      bus.publish("thrive.habit.completed", { id, name: h.name, streak: h.streak }, { userId: uid, source: "thrive" }).catch(() => {});
    }
  };

  const connectHealth = async () => {
    if (!uid) return;
    if (!onIphone) { useStore.getState().setActiveTab("connections"); return; }
    setConnecting(true);
    const ah = await import("../../core/appleHealth");
    const { connectAppleHealth, appleHealthState } = ah;
    const r = await connectAppleHealth(uid);
    setConnecting(false);
    setHealthUpgrade(false);
    if (r !== "connected") {
      // Never fail silently: say what happened.
      const { default: toast } = await import("react-hot-toast");
      toast.error(r === "timeout"
        ? "Apple Health didn't answer. Close HerNest fully, open it again and try once more."
        : `Couldn't connect Apple Health. ${ah.lastAppleHealthError || "Try again in a moment."}`, { duration: 7000 });
      trackEvent("apple_health_connect_failed", { result: r, reason: ah.lastAppleHealthError.slice(0, 80) });
      return;
    }
    trackEvent("apple_health_connected", { from: "wellness" });
    // iPhone only asks once. If sharing was skipped before, nothing comes
    // through: send her to the steps in Connections instead of a dead end.
    if (await appleHealthState(uid) === "no_data") {
      const { default: toast } = await import("react-hot-toast");
      toast("No Health data has come through yet. If sharing is off, here's how to switch it on.", { icon: "♡", duration: 6000 });
      useStore.getState().setActiveTab("connections");
      return;
    }
    applyWearable(await fetchWearable(uid));
  };

  const askCleo = () => {
    trackEvent("wellness_ask_cleo");
    openCleo(cleoWellnessPrompt(summary, goal, progress));
  };

  // ── UI ───────────────────────────────────────────────────────────
  const sourceName = wearable?.source === "oura" ? "Oura" : wearable ? "Apple Health" : null;

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle collapse eyebrow="Just for you" title="Wellness" />
      {uid && <PullToRefresh onRefresh={async () => applyWearable(await fetchWearable(uid))} />}

      {/* 1. Today's note: Cleo's one line, read from the measured numbers */}
      <GlowCard tint="cleo" grain eyebrow="Today's note from Cleo" ariaLabel="Today's note" reveal={false}>
        {checkinText
          ? <Headline size={22}>{checkinText}</Headline>
          : <div role="status" aria-label="Your note for today is on its way">
              <Skeleton onTint height={20} width="94%" />
              <Skeleton onTint height={20} width="66%" style={{ marginTop: 8 }} />
            </div>}

        {!wearable && loaded && (
          <button onClick={connectHealth} disabled={connecting} style={{ ...linkBtn, color: ATMOS.cleo.ink, margin: "8px 0 -6px", textAlign: "left" }}>
            {connecting ? "Connecting…" : onIphone ? "Connect Apple Health so this fills in by itself ›" : "Connect Apple Health or Oura ›"}
          </button>
        )}
        {wearable && healthUpgrade && (
          <button onClick={connectHealth} disabled={connecting} style={{ ...linkBtn, color: ATMOS.cleo.ink, margin: "8px 0 -6px", textAlign: "left" }}>
            {connecting ? "Asking…" : "Let HerNest count your workouts too ›"}
          </button>
        )}
      </GlowCard>

      {wearable && <ThriveVitals w={wearable} expanded={showBody} onToggle={() => setShowBody(s => !s)} />}

      {/* 2. Move this week */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <p style={label}>Move this week</p>
          {goal && !editingGoal && <button onClick={() => setEditingGoal(true)} style={linkBtn}>Change goal</button>}
        </div>

        {(!goal || editingGoal) ? (
          <>
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: "0 0 10px" }}>Pick one simple goal. You can change it anytime.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {GOAL_PRESETS.map(p => {
                const on = !!goal && goalLabel(goal) === p.label;
                return <button key={p.id} onClick={() => chooseGoal(p.goal)} style={chip(on)}>{p.label}</button>;
              })}
            </div>
            {editingGoal && <button onClick={() => setEditingGoal(false)} style={{ ...linkBtn, marginTop: 8 }}>Cancel</button>}
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "0 0 14px" }}>
              {progress && (
                <ProgressRing value={progress.done / progress.target} size={58} stroke={6} color={T.sage} track={T.sageP}>
                  <span style={{ fontFamily: F.sans, fontSize: 15, fontWeight: 800, color: T.text, fontVariantNumeric: "tabular-nums" }}>{progress.done}/{progress.target}</span>
                </ProgressRing>
              )}
              <p style={{ fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: T.esp, margin: 0 }}>{goalLabel(goal)}</p>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }} aria-label={`This week: ${progress?.text}`}>
              {dots!.map(d => (
                <div key={d.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: d.state === "moved" ? T.sage : "transparent",
                    border: d.state === "moved" ? `2px solid ${T.sage}` : d.state === "today" ? `2px solid ${T.esp}` : `2px ${d.state === "future" ? "dashed" : "solid"} ${T.linen}`,
                    display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13,
                  }}>{d.state === "moved" ? "✓" : ""}</div>
                  <span style={{ fontFamily: F.sans, fontSize: 12, fontWeight: d.date === today ? 700 : 500, color: d.date === today ? T.esp : T.taupe }}>{d.letter}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <p style={{ fontFamily: F.sans, fontSize: 13, color: progress?.met ? T.sage : T.esp, fontWeight: 600, margin: 0 }}>{progress?.text}</p>
              {(!movedToday || tappedToday) && (
                <button onClick={toggleMovedToday} style={{ padding: "9px 14px", borderRadius: 12, border: `1.5px solid ${tappedToday ? T.linen : T.sage}`, background: tappedToday ? "#fff" : T.sageP, color: tappedToday ? T.taupe : T.esp, fontFamily: F.sans, fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 40, touchAction: "manipulation" }}>
                  {tappedToday ? "Undo today" : "I moved today"}
                </button>
              )}
            </div>
            <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "8px 0 0" }}>
              {sourceName ? `Fills in from ${sourceName}${wearable?.source === "apple_health" ? ", including workouts" : ""}.` : "Tap \"I moved today\" on days you move."}
            </p>
          </>
        )}
      </Card>

      {/* 3. One suggestion, at most */}
      {suggestion && (
        <div style={{ background: `${T.gold}12`, border: `1px solid ${T.gold}30`, borderRadius: 14, padding: "12px 14px", marginBottom: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 14, flexShrink: 0, color: T.goldText }}>✦</span>
          <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0, lineHeight: 1.5, flex: 1 }}>{suggestion.text}</p>
          <button onClick={() => setSuggestionHidden(true)} aria-label="Dismiss suggestion" style={{ background: "none", border: "none", color: T.taupe, fontSize: 16, cursor: "pointer", padding: 0, minWidth: 24, minHeight: 24 }}>×</button>
        </div>
      )}

      {/* 4. Small habits (optional) */}
      {(habits.length > 0 || editingHabits) ? (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <p style={label}>Small habits</p>
            {!editingHabits && <button onClick={() => setEditingHabits(true)} style={linkBtn}>Edit</button>}
          </div>
          {editingHabits ? (
            <>
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: "0 0 10px" }}>Choose up to {MAX_HABITS}, or none.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                {HABIT_CHOICES.map(h => {
                  const on = habitPicks.includes(h.id);
                  const full = !on && habitPicks.length >= MAX_HABITS;
                  return <button key={h.id} onClick={() => togglePick(h.id)} disabled={full} style={{ ...chip(on), opacity: full ? 0.45 : 1 }}>{h.icon} {h.name}</button>;
                })}
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <button onClick={saveHabitPicks} style={{ ...linkBtn, fontSize: 13 }}>Done</button>
                <button onClick={() => { setHabitPicks(habits.map(h => h.id)); setEditingHabits(false); }} style={{ ...linkBtn, color: T.taupe }}>Cancel</button>
              </div>
            </>
          ) : habits.map(h => {
            const done = isHabitDoneToday(h, today);
            return (
              <button key={h.id} onClick={() => tickHabit(h.id)} aria-pressed={done}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 0", background: "none", border: "none", borderTop: `1px solid ${T.linen}`, cursor: "pointer", minHeight: 48, textAlign: "left" }}>
                <span style={{ width: 24, height: 24, borderRadius: 8, border: `2px solid ${done ? T.sage : T.linen}`, background: done ? T.sage : "#fff", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{done ? "✓" : ""}</span>
                <span style={{ fontSize: 16 }}>{h.icon}</span>
                <span style={{ fontFamily: F.sans, fontSize: 14, color: T.esp, flex: 1, textDecoration: done ? "line-through" : "none" }}>{h.name}</span>
                {h.streak >= 2 && <span style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe }}>{h.streak} days</span>}
              </button>
            );
          })}
        </Card>
      ) : loaded && (
        <button onClick={() => setEditingHabits(true)} style={{ ...linkBtn, display: "block", margin: "0 0 12px 4px" }}>+ Add small habits (optional)</button>
      )}

      {/* 5. This week */}
      <Card>
        <p style={label}>This week</p>
        <p style={{ fontFamily: F.sans, fontSize: 14, color: T.esp, margin: "0 0 12px", lineHeight: 1.55 }}>
          {summary || "Check in for a few days and your week will show here."}
        </p>
        <button onClick={askCleo} style={{ width: "100%", padding: "12px", background: T.action, color: "#fff", border: "none", borderRadius: 14, fontFamily: F.sans, fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 48, touchAction: "manipulation" }}>
          Ask Cleo about this
        </button>
      </Card>
    </div>
  );
}
