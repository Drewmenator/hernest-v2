import React, { useState, useEffect, useRef } from "react";
import { trackEvent } from "../../core/analytics";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, HeroCard, Pill, ProgressBar, AIBadge, Spinner, EmptyState } from "../../shared/components";
import { ThriveVitals } from "./ThriveVitals";
import { computeWeeklyScore } from "../../core/thriveCheckin";
import { saveData, loadData } from "../../core/firebase";
import { ai } from "../../core/ai";
import { bus } from "../../core/events";
import { pickNudge } from "../../core/thriveCheckin";
import toast from "react-hot-toast";

// ── Types per blueprint ────────────────────────────────────────────
interface SleepLog { date: string; hours: number; quality: "poor"|"fair"|"good"|"excellent"; source?: "manual"|"oura"|"apple_health"; }
interface WaterLog  { date: string; glasses: number; target: number; timestamps: string[]; }
interface MoodLog   { date: string; rating: number; label: string; note?: string; }
interface Habit     { id: string; name: string; icon: string; category: string; done: boolean; streak: number; autoDetect?: boolean; lastCompleted?: string; }
interface WeeklyScore {
  score: number; headline: string;
  breakdown: { sleep: number; readiness: number; activity: number; mood: number };
  wins: string[]; focus: string; affirmation: string;
  trend: string; generatedAt: number;
}
interface CoachMsg { role: "user"|"assistant"; content: string; }

const SLEEP_QUALITY = [
  { value:"poor",      label:"Poor",      emoji:"😞", color:T.blush },
  { value:"fair",      label:"Fair",      emoji:"😐", color:T.taupe },
  { value:"good",      label:"Good",      emoji:"🙂", color:T.sky },
  { value:"excellent", label:"Excellent", emoji:"✨", color:T.sage },
] as const;

const MOOD_LEVELS = [
  { value:3, label:"Struggling", emoji:"◦", color:"#C4846A", desc:"Hard day" },
  { value:6, label:"Okay",       emoji:"◎", color:"#C9A961", desc:"Getting through" },
  { value:9, label:"Good",       emoji:"✦", color:"#4CAF7D", desc:"Feeling good" },
];

const DEFAULT_HABITS: Habit[] = [
  { id:"water",    name:"Drink 8 glasses",       icon:"💧", category:"nutrition",   done:false, streak:0, autoDetect:true },
  { id:"move",     name:"Move your body",         icon:"🏃", category:"movement",    done:false, streak:0 },
  { id:"mindful",  name:"5 min mindfulness",      icon:"🧘", category:"mindfulness", done:false, streak:0 },
  { id:"nourish",  name:"Eat nourishing food",    icon:"🥗", category:"nutrition",   done:false, streak:0 },
  { id:"outside",  name:"Get outside",            icon:"☀️", category:"movement",    done:false, streak:0 },
  { id:"sleep7",   name:"Sleep 7+ hours",         icon:"😴", category:"rest",        done:false, streak:0, autoDetect:true },
  { id:"gratitude",name:"3 gratitudes",           icon:"🙏", category:"mindfulness", done:false, streak:0 },
];

// Weekly score now lives in core/thriveCheckin (computeWeeklyScore) — the
// old hydration/habits-weighted calc functions were removed with the
// manual-logging redesign.

function detectPatterns(sleepLogs: SleepLog[], moodLogs: MoodLog[]): string {
  if (sleepLogs.length < 3 || moodLogs.length < 3) return "";
  const avgSleep = sleepLogs.reduce((a,l)=>a+l.hours,0)/sleepLogs.length;
  const avgMood  = moodLogs.reduce((a,l)=>a+l.rating,0)/moodLogs.length;
  if (avgSleep < 6 && avgMood < 5) return "Low sleep is affecting your mood. Prioritise rest this week.";
  if (avgSleep >= 7.5 && avgMood >= 7) return "Great sleep is lifting your mood. Keep protecting your bedtime!";
  return "";
}

export function ThriveScreen() {
  const { user, profile } = useStore();
  const [tab, setTab] = useState("today");

  // Today state
  const [sleepLog, setSleepLog]   = useState<SleepLog|null>(null);
  const [sleepQuality, setSleepQuality] = useState<SleepLog["quality"]>("good");
  const [sleepHours, setSleepHours] = useState<number|null>(null);
  const [wearable, setWearable] = useState<import("../../core/wellnessAutoTrack").WearableDay|null>(null);
  const [adjustSleep, setAdjustSleep] = useState(false);
  const [checkinText, setCheckinText] = useState<string>("");
  const [showBody, setShowBody] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [waterLog, setWaterLog]   = useState<WaterLog|null>(null);
  const [moodLog, setMoodLog]     = useState<MoodLog|null>(null);
  const [habits, setHabits]       = useState<Habit[]>(DEFAULT_HABITS);
  const [celebrated, setCelebrated] = useState(false);

  // Weekly score
  const [score, setScore]         = useState<WeeklyScore|null>(null);
  const [genScore, setGenScore]   = useState(false);

  // History for score calc
  const [sleepHistory, setSleepHistory] = useState<SleepLog[]>([]);
  const [moodHistory, setMoodHistory]   = useState<MoodLog[]>([]);
  const [waterHistory, setWaterHistory] = useState<WaterLog[]>([]);

  // Coach
  const [coachMsgs, setCoachMsgs] = useState<CoachMsg[]>([
    { role:"assistant", content:`Hello${(profile as any)?.name?`, ${(profile as any).name}`:""}! I'm your wellness coach. I can see your sleep, water, habits and mood data. What would you like to work on?` }
  ]);
  const [coachInput, setCoachInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const today = new Date().toISOString().split("T")[0];
  const doneCount = habits.filter(h=>h.done).length;
  const water = waterLog?.glasses || 0;

  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "thrive").then(d => {
      if (!d) return;
      if (d.habits) {
        // Reset habits daily — clear done status if not completed today
        const loadedHabits = (d.habits as Habit[]).map(h => ({
          ...h,
          done: h.lastCompleted === today ? h.done : false,
        }));
        setHabits(loadedHabits);
      }
      if (d.score) setScore(d.score as WeeklyScore);
      // Load today's logs
      const sLogs = (d.sleepLog as SleepLog[]) || [];
      const mLogs = (d.moodLog  as MoodLog[])  || [];
      const wLogs = (d.waterLog as WaterLog[])  || [];
      setSleepHistory(sLogs); setMoodHistory(mLogs); setWaterHistory(wLogs);
      const todaySleep = sLogs.find(l=>l.date===today);
      const todayMood  = mLogs.find(l=>l.date===today);
      const todayWater = wLogs.find(l=>l.date===today);
      if (todaySleep) { setSleepLog(todaySleep); setSleepHours(todaySleep.hours); setSleepQuality(todaySleep.quality); }
      if (todayMood)  setMoodLog(todayMood);
      if (todayWater) setWaterLog(todayWater);
    });
    // Wearables know sleep & movement — auto-log them, then refresh state.
    // Manual entries always win; auto-log never overwrites a user's log.
    import("../../core/wellnessAutoTrack").then(async ({ autoTrackWellness }) => {
      try {
        const r = await autoTrackWellness(user.uid);
        if (r.wearable) setWearable(r.wearable);
        if (r.sleepLogged || r.moveDone) {
          const d = await loadData(user.uid, "thrive");
          if (d?.sleepLog) {
            const sLogs = d.sleepLog as SleepLog[];
            setSleepHistory(sLogs);
            const t = sLogs.find(l => l.date === today) || sLogs.find(l => l.date === r.wearable?.date);
            if (t) { setSleepLog(t); setSleepHours(t.hours); setSleepQuality(t.quality); }
          }
          if (d?.habits) setHabits((d.habits as Habit[]).map(h => ({ ...h, done: h.lastCompleted === today ? h.done : false })));
        }
      } catch { /* non-fatal */ }
    });
  }, [user?.uid]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [coachMsgs]);

  // Cleo's check-in paragraph — generated from real wearable numbers, cached daily
  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    import("../../core/thriveCheckin").then(async ({ generateCheckin }) => {
      const text = await generateCheckin(user.uid, (profile as any)?.name || "", wearable);
      if (alive) setCheckinText(text);
    }).catch(() => {});
    return () => { alive = false; };
  }, [user?.uid, wearable?.date, wearable?.readiness]);

  const persist = async (updates: Record<string, unknown>) => {
    if (!user?.uid) return;
    await saveData(user.uid, "thrive", updates);
  };

  // ── Sleep per blueprint (quality + hours) ─────────────────────────
  const logSleep = async () => {
    if (!sleepHours || !user?.uid) return;
    const log: SleepLog = { date:today, hours:sleepHours, quality:sleepQuality, source:"manual" };
    const updated = [...sleepHistory.filter(l=>l.date!==today), log];
    setSleepLog(log); setSleepHistory(updated);

    // Auto-detect "sleep 7+" habit
    const updatedHabits = habits.map(h =>
      h.id==="sleep7" ? { ...h, done:sleepHours>=7, streak:sleepHours>=7?h.streak+1:0 } : h
    );
    setHabits(updatedHabits);

    await persist({ sleepLog:updated, habits:updatedHabits, moodLog:moodHistory, waterLog:waterHistory, score });
    await bus.publish("thrive.sleep.logged", { hours:sleepHours, quality:sleepQuality }, { userId:user.uid, source:"thrive" });
    trackEvent("sleep_logged", { hours: sleepHours, quality: sleepQuality });
    toast.success(`${sleepHours}h ${sleepQuality} sleep logged ✓`);
  };

  // ── Water with timestamps per blueprint ───────────────────────────
  const logWater = async (glasses: number) => {
    if (!user?.uid) return;
    const existing = waterLog || { date:today, glasses:0, target:8, timestamps:[] };
    const log: WaterLog = { ...existing, glasses, timestamps:[...existing.timestamps, new Date().toISOString()] };
    const updated = [...waterHistory.filter(l=>l.date!==today), log];
    setWaterLog(log); setWaterHistory(updated);

    // Auto-detect water habit
    const updatedHabits = habits.map(h =>
      h.id==="water" ? { ...h, done:glasses>=8, streak:glasses>=8?h.streak+1:h.streak } : h
    );
    setHabits(updatedHabits);

    if ((waterLog?.glasses||0) < 8 && glasses >= 8) {
      toast.success("💧 Daily water goal reached! 🎉");
    }

    await persist({ waterLog:updated, habits:updatedHabits, sleepLog:sleepHistory, moodLog:moodHistory, score });
    await bus.publish("thrive.water.logged", { glasses }, { userId:user!.uid, source:"thrive" });
  };

  // ── Mood 1-10 per blueprint ───────────────────────────────────────
  const logMood = async (rating: number) => {
    if (!user?.uid) return;
    const label = MOOD_LEVELS.find(m=>m.value===rating)?.label || "Okay";
    const log: MoodLog = { date:today, rating, label };
    const updated = [...moodHistory.filter(l=>l.date!==today), log];
    setMoodLog(log); setMoodHistory(updated);
    await persist({ moodLog:updated, sleepLog:sleepHistory, waterLog:waterHistory, habits, score });
    await bus.publish("thrive.mood.logged", { rating, label }, { userId:user!.uid, source:"thrive" });
  };

  // ── Habits with streak tracking per blueprint ──────────────────────
  const toggleHabit = async (id: string) => {
    if (!user?.uid) return;
    const updated = habits.map(h => {
      if (h.id !== id) return h;
      const nowDone = !h.done;
      return { ...h, done:nowDone, streak:nowDone?h.streak+1:Math.max(0,h.streak-1), lastCompleted:nowDone?today:h.lastCompleted };
    });
    setHabits(updated);

    const h = updated.find(h=>h.id===id);
    if (h?.done) {
      await bus.publish("thrive.habit.completed", { id, name:h.name, streak:h.streak }, { userId:user.uid, source:"thrive" });
      // Streak celebration per blueprint
      if (h.streak === 7)  toast.success(`🔥 7-day streak on "${h.name}"!`);
      if (h.streak === 30) toast.success(`🏆 30-day streak on "${h.name}"! Incredible!`);
      // All done
      if (updated.every(h=>h.done) && !celebrated) {
        setCelebrated(true);
        toast.success("🎉 All habits complete! You're amazing today!");
        setTimeout(()=>setCelebrated(false),5000);
      }
    }
    await persist({ habits:updated, sleepLog:sleepHistory, moodLog:moodHistory, waterLog:waterHistory, score });
  };

  // ── Weekly Score per blueprint weighted formula ────────────────────
  const generateScore = async () => {
    setGenScore(true);
    const hist = wearable?.history || [];
    const moodRatings = moodHistory.slice(-7).map((m: any) => m.rating || m.value || 6);
    const activityScores = hist.map(() => wearable?.activityScore).filter((v): v is number => v != null);
    const { score: total, breakdown } = computeWeeklyScore(
      hist.map(d => ({ sleepScore: d.sleepScore, sleepHours: d.sleepHours, readiness: d.readiness })),
      activityScores,
      moodRatings,
    );

    const sys = `You are Cleo, a warm wellness coach. Generate a weekly wellness score summary.
Return ONLY valid JSON:
{"headline":"one punchy sentence","wins":["string","string"],"focus":"one gentle suggestion","affirmation":"one warm personal sentence","trend":"improving|stable|declining"}
Score is ${total.toFixed(1)}/10. Sleep: ${breakdown.sleep.toFixed(1)}, Readiness: ${breakdown.readiness.toFixed(1)}, Activity: ${breakdown.activity.toFixed(1)}, Mood: ${breakdown.mood.toFixed(1)} (all /10).
User: ${(profile as any)?.name||"lovely"}. Tone: ${total>=8?"celebratory":total>=6?"encouraging":"gentle"}. Ground every claim in these numbers — never invent.`;

    const result = await ai(sys, `Weekly wellness for ${(profile as any)?.name||"user"}. 7-day trend from their ring:\n${hist.map(d => `${d.day}: sleep ${d.sleepHours ?? "?"}h (score ${d.sleepScore ?? "?"}), readiness ${d.readiness ?? "?"}`).join("\n")}\nRecent mood (of 9): ${moodRatings.slice(-3).join(", ") || "not logged"}`, "wellness_score");

    if (!result.error) {
      try {
        const data = JSON.parse(result.text.replace(/```json\s*/gi,"").replace(/```/g,"").trim());
        const ws: WeeklyScore = {
          score: total,
          headline: data.headline,
          breakdown,
          wins: data.wins||[], focus:data.focus, affirmation:data.affirmation,
          trend: data.trend||"stable", generatedAt:Date.now(),
        };
        setScore(ws);
        await persist({ score:ws, sleepLog:sleepHistory, moodLog:moodHistory });
        await bus.publish("thrive.score.generated", { score:total }, { userId:user!.uid, source:"thrive" });
      } catch { toast.error("Couldn't generate score"); }
    }
    setGenScore(false);
  };

  // ── Wellness Coach with real data per blueprint ────────────────────
  const askCoach = async () => {
    if (!coachInput.trim()||coachLoading) return;
    const userMsg: CoachMsg = { role:"user", content:coachInput };
    setCoachMsgs(p=>[...p,userMsg]);
    setCoachInput("");
    setCoachLoading(true);

    const avgSleep = sleepHistory.slice(-7).reduce((a,l)=>a+l.hours,0)/Math.max(sleepHistory.slice(-7).length,1);
    const avgMood  = moodHistory.slice(-7).reduce((a,l)=>a+l.rating,0)/Math.max(moodHistory.slice(-7).length,1);
    const pattern  = detectPatterns(sleepHistory.slice(-7), moodHistory.slice(-7));

    const sys = `You are Cleo, a warm empathetic wellness coach inside HerNest. CRITICAL: Never invent symptoms, diagnoses, or medical advice. Only reflect back what the user shares.

WELLNESS DATA:
- Sleep this week: avg ${avgSleep.toFixed(1)}h. Today: ${sleepLog?.hours||"not logged"}h (${sleepLog?.quality||"unknown"}).
- Water today: ${water}/8 glasses.
- Habits today: ${doneCount}/${habits.length} done.
- Mood today: ${moodLog?.rating||"not logged"}/10 (${moodLog?.label||"unknown"}).
- Weekly score: ${score?.score||"not generated"}/10.
${pattern ? `Pattern: ${pattern}` : ""}

RULES:
1. NEVER judge. No "you should" or "that's a lot."
2. Use REAL numbers: "You've slept avg ${avgSleep.toFixed(1)}h" not "you haven't slept much."
3. Frame everything as choices, not failures.
4. Celebrate wins genuinely.
5. If struggling, suggest ONE small thing.
6. Keep responses to 2-3 sentences.`;

    const history = coachMsgs.slice(-6).map(m=>({ role:m.role, content:m.content }));
    const result = await ai(sys, coachInput, "wellness_coach", history);
    setCoachMsgs(p=>[...p,{ role:"assistant", content:result.error?"Having trouble connecting — try again.":result.text }]);
    setCoachLoading(false);
  };

  // ── Score color ────────────────────────────────────────────────────
  const scoreColor = score ? score.score>=8?T.sage:score.score>=6?T.gold:T.blush : T.esp;

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="WELLNESS" title="Thrive"/>

      {/* Pattern detection callout */}
      {detectPatterns(sleepHistory.slice(-7), moodHistory.slice(-7)) && (
        <div style={{ background:`${T.gold}12`, border:`1px solid ${T.gold}30`, borderRadius:14, padding:"10px 14px", marginBottom:12, display:"flex", gap:10 }}>
          <span style={{ fontSize:16, flexShrink:0, color:T.gold }}>✦</span>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.esp, margin:0, lineHeight:1.5 }}>
            {detectPatterns(sleepHistory.slice(-7), moodHistory.slice(-7))}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:16, overflowX:"auto", paddingBottom:4 }}>
        {["today","score","coach"].map(t=>(
          <Pill key={t} label={t==="today"?"Today":t==="score"?"Weekly Score":"💬 Coach"} active={tab===t} onClick={()=>setTab(t)}/>
        ))}
      </div>

      {/* ── TODAY ─────────────────────────────────────────────────── */}
      {tab==="today" && <>

        {/* 1. Cleo's Check-in — the voice. Mood is the ONE human input. */}
        <div style={{ background:`linear-gradient(135deg,${T.esp},#3D2E22)`, borderRadius:24, padding:"22px 20px", marginBottom:12 }}>
          <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, letterSpacing:"0.16em", textTransform:"uppercase", color:"rgba(255,255,255,0.45)", margin:"0 0 10px" }}>CLEO'S CHECK-IN</p>
          <p style={{ fontFamily:F.serif, fontStyle:"italic", fontSize:16, color:"rgba(255,255,255,0.92)", margin:"0 0 14px", lineHeight:1.6 }}>
            {checkinText || (wearable ? "Reading your night..." : "I can read your body once your ring is connected — until then, how are you feeling?")}
          </p>
          {!moodLog ? (
            <div style={{ display:"flex", gap:8 }}>
              {MOOD_LEVELS.map(m=>(
                <button key={m.value} onClick={()=>logMood(m.value)} aria-label={`Mood: ${m.label}`} style={{ flex:1, padding:"10px 8px", borderRadius:14, border:"1.5px solid rgba(255,255,255,0.22)", background:"rgba(255,255,255,0.08)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, touchAction:"manipulation", minHeight:44 }}>
                  <span style={{ fontSize:14, color:(m as any).color }}>{m.emoji}</span>
                  <span style={{ fontFamily:F.sans, fontSize:12, fontWeight:600, color:"#fff" }}>{m.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <p style={{ fontFamily:F.sans, fontSize:12, color:T.gold, margin:0 }}>
              {moodLog.rating>=8?"Noted — glad today feels good ✦":moodLog.rating>=5?"Noted. Steady as she goes ✦":"Noted. Be gentle with yourself today ✦"}
            </p>
          )}
        </div>

        {/* 2. Your body, understood — all from the ring. Or a connect prompt. */}
        {wearable ? (
          <ThriveVitals w={wearable} expanded={showBody} onToggle={()=>setShowBody(s=>!s)} />
        ) : (
          <EmptyState
            icon="♡"
            title="Connect your ring to see this come alive"
            body="Thrive reads sleep, readiness, recovery and activity straight from your Oura ring or Apple Health — no logging. Connect one and your body's story shows up here each morning."
            actionLabel="Connect a wearable ✦"
            onAction={()=>useStore.getState().setActiveTab("connections")}
          />
        )}

        {/* 3. One gentle nudge, max — only when it's actionable */}
        {(() => {
          const nudge = !nudgeDismissed ? pickNudge(wearable, 8, new Date().getHours()) : null;
          return nudge ? (
            <div style={{ background:`${T.gold}12`, border:`1px solid ${T.gold}30`, borderRadius:14, padding:"10px 14px", marginBottom:12, display:"flex", gap:10, alignItems:"flex-start" }}>
              <span style={{ fontSize:14, flexShrink:0, color:T.goldText }}>✦</span>
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.esp, margin:0, lineHeight:1.5, flex:1 }}>{nudge.text}</p>
              <button onClick={()=>setNudgeDismissed(true)} aria-label="Dismiss" style={{ background:"none", border:"none", color:T.taupe, fontSize:14, cursor:"pointer", padding:0, flexShrink:0 }}>×</button>
            </div>
          ) : null;
        })()}
      </>}

      {/* ── WEEKLY SCORE      {/* ── WEEKLY SCORE per blueprint weighted formula ────────────── */}
      {tab==="score" && <>
        {score ? (
          <>
            <div style={{ background:`linear-gradient(135deg,${T.esp},#3D2E22)`, borderRadius:24, padding:"28px 20px", marginBottom:16, textAlign:"center" }}>
              <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, letterSpacing:"0.16em", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", margin:"0 0 8px" }}>WEEKLY WELLNESS SCORE</p>
              <div style={{ fontFamily:F.serif, fontSize:80, fontWeight:600, color:scoreColor, lineHeight:1 }}>{score.score}</div>
              <div style={{ fontFamily:F.sans, fontSize:12, color:"rgba(255,255,255,0.4)" }}>/10</div>
              <p style={{ fontFamily:F.serif, fontSize:18, fontStyle:"italic", color:"#fff", margin:"16px 0 0", lineHeight:1.4 }}>{score.headline}</p>
              <span style={{ fontFamily:F.sans, fontSize:10, color:T.gold, textTransform:"uppercase", letterSpacing:"0.1em" }}>{score.trend}</span>
            </div>

            {/* Score breakdown per blueprint */}
            <Card>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>SCORE BREAKDOWN</p>
              {[
                { label:"Sleep",      value:score.breakdown.sleep,      weight:"30%", color:T.navy },
                { label:"Readiness",  value:score.breakdown.readiness,  weight:"30%", color:T.sage },
                { label:"Activity",   value:score.breakdown.activity,   weight:"20%", color:T.goldText },
                { label:"Mood",       value:score.breakdown.mood,       weight:"20%", color:T.gold },
              ].map(item=>(
                <div key={item.label} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontFamily:F.sans, fontSize:12, color:T.esp }}>{item.label} <span style={{ color:T.taupe, fontSize:10 }}>({item.weight})</span></span>
                    <span style={{ fontFamily:F.serif, fontSize:16, fontWeight:700, color:item.color }}>{item.value.toFixed(1)}</span>
                  </div>
                  <ProgressBar value={item.value} max={10} color={item.color} height={5}/>
                </div>
              ))}
            </Card>

            {score.wins?.length>0 && <Card>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>THIS WEEK'S WINS</p>
              {score.wins.map((w,i)=>(
                <div key={i} style={{ display:"flex", gap:10, padding:"7px 0" }}>
                  <span style={{ color:T.gold, flexShrink:0 }}>✦</span>
                  <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{w}</p>
                </div>
              ))}
            </Card>}

            {score.focus && <Card>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 8px" }}>FOCUS NEXT WEEK</p>
              <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0, lineHeight:1.6 }}>{score.focus}</p>
            </Card>}

            <div style={{ background:`linear-gradient(135deg,${scoreColor}15,${T.esp}08)`, border:`1px solid ${scoreColor}30`, borderRadius:16, padding:"16px 18px", marginBottom:12 }}>
              <p style={{ fontFamily:F.serif, fontSize:16, fontStyle:"italic", color:T.esp, margin:0, lineHeight:1.7 }}>{score.affirmation}</p>
            </div>

            <button onClick={()=>setScore(null)} style={{ width:"100%", padding:"10px", background:"none", border:`1px solid ${T.linen}`, borderRadius:12, fontFamily:F.sans, fontSize:12, color:T.taupe, cursor:"pointer", minHeight:44 }}>↻ Regenerate</button>
          </>
        ) : (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:14, color:T.taupe, textAlign:"center", padding:"16px 0 12px", lineHeight:1.6 }}>
              Cleo calculates your wellness score using a weighted formula:<br/>
              <span style={{ color:T.esp, fontWeight:600 }}>Sleep 25% · Mood 25% · Habits 20% · Hydration 15%</span>
            </p>
            <button onClick={generateScore} disabled={genScore} style={{ width:"100%", padding:"14px", background:`linear-gradient(135deg,${T.esp},#4a2e18)`, color:"#fff", border:"none", borderRadius:14, fontFamily:F.sans, fontSize:15, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, minHeight:52, touchAction:"manipulation" }}>
              {genScore?<><Spinner size={18} color="#fff"/>Calculating...</>:"✦ Generate My Score"}
            </button>
          </Card>
        )}
      </>}

      {/* ── CLEO COACH ────────────────────────────────────────────── */}
      {tab==="coach" && (
        <div style={{ display:"flex", flexDirection:"column" }}>
          <div style={{ marginBottom:12 }}>
            {coachMsgs.map((m,i)=>(
              <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start", marginBottom:10 }}>
                {m.role==="assistant" && <div style={{ width:28, height:28, borderRadius:"50%", background:`linear-gradient(135deg,${T.sage},#4a8c50)`, display:"flex", alignItems:"center", justifyContent:"center", marginRight:8, flexShrink:0, alignSelf:"flex-end", fontSize:12 }}>✦</div>}
                <div style={{ maxWidth:"82%", background:m.role==="user"?`linear-gradient(135deg,${T.esp},#4a3020)`:"#fff", borderRadius:m.role==="user"?"20px 20px 4px 20px":"20px 20px 20px 4px", padding:"12px 16px", border:m.role==="assistant"?`1px solid ${T.linen}`:"none" }}>
                  {m.content.split("\n").filter(l=>l.trim()).map((line,j)=>(
                    <p key={j} style={{ fontFamily:F.sans, fontSize:13, color:m.role==="user"?"rgba(255,255,255,.9)":T.esp, margin:"0 0 4px", lineHeight:1.6 }}>{line}</p>
                  ))}
                </div>
              </div>
            ))}
            {coachLoading && <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:28, height:28, borderRadius:"50%", background:`linear-gradient(135deg,${T.sage},#4a8c50)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12 }}>✦</div>
              <div style={{ background:"#fff", borderRadius:"20px 20px 20px 4px", padding:"12px 16px", border:`1px solid ${T.linen}` }}><Spinner size={16}/></div>
            </div>}
            <div ref={bottomRef}/>
          </div>
          <div style={{ display:"flex", gap:8, borderTop:`1px solid ${T.linen}`, paddingTop:8 }}>
            <input value={coachInput} onChange={e=>setCoachInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&askCoach()} placeholder="Talk to your wellness coach..." style={{ flex:1, background:T.ivory, border:`1.5px solid ${T.linen}`, borderRadius:14, padding:"12px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", minHeight:48 }}/>
            <button onClick={askCoach} disabled={!coachInput.trim()||coachLoading} style={{ width:48, height:48, borderRadius:14, background:coachInput.trim()?T.sage:T.linen, border:"none", color:"#fff", fontSize:18, cursor:coachInput.trim()?"pointer":"not-allowed", flexShrink:0, touchAction:"manipulation" }}>→</button>
          </div>
        </div>
      )}
    </div>
  );
}
