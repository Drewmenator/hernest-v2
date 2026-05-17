import React, { useState, useEffect, useRef } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, HeroCard, Pill, ProgressBar, AIBadge, Spinner } from "../../shared/components";
import { saveData, loadData } from "../../core/firebase";
import { ai } from "../../core/ai";
import { askWellness } from "../../core/aiOrchestrator";
import { bus } from "../../core/events";
import toast from "react-hot-toast";

// ── Types ──────────────────────────────────────────────────────────
interface SleepLog { hours: number; date: string; quality?: "poor"|"okay"|"good"; }
interface Habit { id: string; label: string; icon: string; done: boolean; source: "manual"|"inferred"; }
interface CoachMsg { role: "user"|"assistant"; content: string; }
interface WeeklyScore { score: number; headline: string; wins: string[]; focus: string; affirmation: string; generatedAt: number; }

const DEFAULT_HABITS: Habit[] = [
  { id:"water",    label:"Drink 8 glasses",      icon:"💧", done:false, source:"manual" },
  { id:"move",     label:"Move your body",        icon:"🏃", done:false, source:"manual" },
  { id:"mindful",  label:"5 min mindfulness",     icon:"🧘", done:false, source:"manual" },
  { id:"nourish",  label:"Eat nourishing food",   icon:"🥗", done:false, source:"manual" },
  { id:"outside",  label:"Get outside today",     icon:"☀️", done:false, source:"manual" },
  { id:"gratitude",label:"3 things I'm grateful for", icon:"🙏", done:false, source:"manual" },
];

const MOOD_LEVELS = [
  { value:1, label:"Struggling", emoji:"😞" },
  { value:2, label:"Low",        emoji:"😕" },
  { value:3, label:"Okay",       emoji:"😐" },
  { value:4, label:"Good",       emoji:"🙂" },
  { value:5, label:"Thriving",   emoji:"✨" },
];

const SLEEP_OPTIONS = [4,5,6,7,8,9];

export function ThriveScreen() {
  const { user, profile } = useStore();
  const [tab, setTab] = useState("today");

  // Today state
  const [water, setWater]   = useState(0);
  const [sleep, setSleep]   = useState<SleepLog|null>(null);
  const [mood, setMood]     = useState<number|null>(null);
  const [habits, setHabits] = useState<Habit[]>(DEFAULT_HABITS);
  const [celebrated, setCelebrated] = useState(false);

  // Weekly score
  const [score, setScore]       = useState<WeeklyScore|null>(null);
  const [generatingScore, setGeneratingScore] = useState(false);

  // Coach
  const [coachMsgs, setCoachMsgs]   = useState<CoachMsg[]>([
    { role:"assistant", content:`Hello${profile?.name?`, ${profile.name}`:""}. I'm your wellness coach. I can see your sleep, water, habits and mood. How are you feeling today?` }
  ]);
  const [coachInput, setCoachInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const doneCount = habits.filter(h => h.done).length;
  const today = new Date().toISOString().split("T")[0];

  // Load from Firestore
  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "thrive").then(d => {
      if (!d) return;
      if (d.water)  setWater(d.water as number);
      if (d.habits) setHabits(d.habits as Habit[]);
      if (d.score)  setScore(d.score as WeeklyScore);
      // Load today's sleep
      if (d.sleepLog) {
        const logs = d.sleepLog as SleepLog[];
        const todayLog = logs.find(l => l.date === today);
        if (todayLog) setSleep(todayLog);
      }
      // Load today's mood
      if (d.moodLog) {
        const logs = d.moodLog as { date: string; value: number }[];
        const todayMood = logs.find(l => l.date === today);
        if (todayMood) setMood(todayMood.value);
      }
    });
  }, [user?.uid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [coachMsgs]);

  // ── Persist helpers ───────────────────────────────────────────────
  const persist = async (updates: Record<string, unknown>) => {
    if (!user?.uid) return;
    await saveData(user.uid, "thrive", updates);
  };

  // ── Water ─────────────────────────────────────────────────────────
  const logWater = async (glasses: number) => {
    setWater(glasses);
    await persist({ water: glasses });
    await bus.publish("thrive.water.logged", { glasses }, { userId: user!.uid, source: "thrive" });
  };

  // ── Sleep ─────────────────────────────────────────────────────────
  const logSleep = async (hours: number) => {
    const log: SleepLog = { hours, date: today };
    setSleep(log);
    // Load existing logs and update
    const existing = await loadData(user!.uid, "thrive");
    const logs: SleepLog[] = (existing?.sleepLog as SleepLog[]) || [];
    const updated = [...logs.filter(l => l.date !== today), log];
    await persist({ sleepLog: updated });
    await bus.publish("thrive.sleep.logged", { hours }, { userId: user!.uid, source: "thrive" });
    toast.success(`${hours}h sleep logged ✓`);
  };

  // ── Mood ──────────────────────────────────────────────────────────
  const logMood = async (value: number) => {
    setMood(value);
    const existing = await loadData(user!.uid, "thrive");
    const logs = (existing?.moodLog as { date: string; value: number }[]) || [];
    const updated = [...logs.filter(l => l.date !== today), { date: today, value }];
    await persist({ moodLog: updated });
    await bus.publish("thrive.mood.logged", { value }, { userId: user!.uid, source: "thrive" });
  };

  // ── Habits ────────────────────────────────────────────────────────
  const toggleHabit = async (id: string) => {
    const updated = habits.map(h => h.id === id ? { ...h, done: !h.done } : h);
    setHabits(updated);
    await persist({ habits: updated });

    const h = updated.find(h => h.id === id);
    if (h?.done) {
      await bus.publish("thrive.habit.completed", { id, label: h.label }, { userId: user!.uid, source: "thrive" });
      // Celebrate if all done
      const allDone = updated.every(h => h.done);
      if (allDone && !celebrated) {
        setCelebrated(true);
        toast.success("🎉 All habits complete today! You're amazing!");
        setTimeout(() => setCelebrated(false), 5000);
      }
    }
  };

  // ── Weekly Score ─────────────────────────────────────────────────
  const generateScore = async () => {
    setGeneratingScore(true);
    const sleepAvg = sleep?.hours || 0;
    const habitsRate = Math.round((doneCount / habits.length) * 100);
    const moodVal = mood || 3;

    const sys = `You are Nora, a warm wellness coach. Generate a weekly wellness score.
Return ONLY valid JSON:
{"score":0,"headline":"one punchy sentence","wins":["string","string"],"focus":"one gentle suggestion","affirmation":"one warm personal sentence"}
Score 1-10 honestly. Adjust tone: gentle if score<5, encouraging if 5-7, celebratory if 8+.`;

    const ctx = `Name: ${profile?.name||"lovely"}. Sleep: ${sleepAvg}h avg. Habits done: ${habitsRate}%. Mood: ${moodVal}/5. Water: ${water}/8 glasses.`;
    const result = await ai(sys, ctx, "wellness_score");

    if (!result.error) {
      try {
        const data = JSON.parse(result.text.replace(/```json|```/g,"").trim());
        const weekScore: WeeklyScore = { ...data, generatedAt: Date.now() };
        setScore(weekScore);
        await persist({ score: weekScore });
        await bus.publish("thrive.score.generated", { score: data.score }, { userId: user!.uid, source: "thrive" });
      } catch { toast.error("Couldn't generate score"); }
    }
    setGeneratingScore(false);
  };

  // ── Wellness Coach ────────────────────────────────────────────────
  const askCoach = async () => {
    if (!coachInput.trim() || coachLoading) return;
    const userMsg: CoachMsg = { role:"user", content:coachInput };
    setCoachMsgs(p => [...p, userMsg]);
    setCoachInput("");
    setCoachLoading(true);

    const ctx = `Sleep last night: ${sleep?.hours||"unknown"}h. Water today: ${water}/8 glasses. Habits done: ${doneCount}/${habits.length}. Mood: ${mood ? MOOD_LEVELS.find(m=>m.value===mood)?.label : "not logged"}.`;
    const sys = `You are Nora, a warm empathetic wellness coach inside HerNest.
${ctx}
You can see her actual wellness data. Be specific, warm, and non-judgmental.
If she's struggling, lead with compassion. If thriving, match her energy.
Keep responses concise — 2-3 sentences max.`;

    const history = coachMsgs.slice(-6).map(m => ({ role:m.role, content:m.content }));
    const result = await ai(sys, coachInput, "wellness_coach", history);

    setCoachMsgs(p => [...p, {
      role:"assistant",
      content: result.error ? "I'm having trouble connecting. Please try again." : result.text
    }]);
    setCoachLoading(false);
  };

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="WELLNESS" title="Thrive" />

      <HeroCard
        eyebrow="TODAY"
        title={doneCount===habits.length && habits.length>0 ? "All habits complete 🎉" : `${doneCount} of ${habits.length} habits done`}
        subtitle={sleep ? `${sleep.hours}h sleep · ${water}/8 glasses · ${mood ? MOOD_LEVELS.find(m=>m.value===mood)?.label : "mood not logged"}` : "Log your sleep and mood below"}
        color={doneCount===habits.length && habits.length>0 ? T.sage : T.esp}
      >
        <div style={{ marginTop:12 }}><ProgressBar value={doneCount} max={habits.length} color={T.gold}/></div>
      </HeroCard>

      {/* Tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:16, overflowX:"auto", paddingBottom:4 }}>
        {["today","score","coach"].map(t => (
          <Pill key={t} label={t==="today"?"Today":t==="score"?"Weekly Score":"💬 Nora Coach"} active={tab===t} onClick={()=>setTab(t)}/>
        ))}
      </div>

      {/* ── TODAY ─────────────────────────────────────────────────── */}
      {tab==="today" && <>

        {/* Mood */}
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>HOW ARE YOU FEELING?</p>
          <div style={{ display:"flex", justifyContent:"space-between" }}>
            {MOOD_LEVELS.map(m => (
              <button key={m.value} onClick={()=>logMood(m.value)} style={{ flex:1, padding:"10px 4px", borderRadius:12, border:`2px solid ${mood===m.value?T.gold:T.linen}`, background:mood===m.value?T.goldP:"transparent", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:4, touchAction:"manipulation", minHeight:60 }}>
                <span style={{ fontSize:22 }}>{m.emoji}</span>
                <span style={{ fontFamily:F.sans, fontSize:9, color:mood===m.value?T.gold:T.taupe, fontWeight:mood===m.value?700:400 }}>{m.label}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Sleep */}
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>SLEEP LAST NIGHT</p>
          <div style={{ display:"flex", gap:8, justifyContent:"space-between" }}>
            {SLEEP_OPTIONS.map(h => (
              <button key={h} onClick={()=>logSleep(h)} style={{ flex:1, padding:"10px 4px", borderRadius:12, border:`2px solid ${sleep?.hours===h?T.sky:T.linen}`, background:sleep?.hours===h?T.skyP:"transparent", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:2, touchAction:"manipulation", minHeight:56 }}>
                <span style={{ fontFamily:F.serif, fontSize:18, fontWeight:700, color:sleep?.hours===h?T.sky:T.esp }}>{h}</span>
                <span style={{ fontFamily:F.sans, fontSize:9, color:T.taupe }}>hrs</span>
              </button>
            ))}
          </div>
          {sleep && (
            <p style={{ fontFamily:F.sans, fontSize:11, color:sleep.hours>=7?T.sage:sleep.hours>=6?T.gold:T.blush, margin:"10px 0 0", textAlign:"center" }}>
              {sleep.hours>=7 ? "✓ Great sleep!" : sleep.hours>=6 ? "Almost there — aim for 7+ hours" : "Low sleep detected — be gentle with yourself today"}
            </p>
          )}
        </Card>

        {/* Water */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>WATER TODAY</p>
            <span style={{ fontFamily:F.serif, fontSize:24, fontWeight:700, color:T.sky }}>{water}<span style={{ fontFamily:F.sans, fontSize:12, color:T.taupe }}>/8</span></span>
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {Array.from({length:8},(_,i) => (
              <button key={i} onClick={()=>logWater(i<water?i:i+1)} style={{ flex:1, height:32, borderRadius:8, cursor:"pointer", background:i<water?T.sky:T.skyP, border:"none", transition:"background .15s", touchAction:"manipulation" }}/>
            ))}
          </div>
          <p style={{ fontFamily:F.sans, fontSize:10, color:T.taupe, margin:"8px 0 0", textAlign:"center" }}>Tap to log · tap filled glass to remove</p>
        </Card>

        {/* Habits */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>HABITS</p>
            <span style={{ fontFamily:F.sans, fontSize:11, color:T.gold }}>{doneCount}/{habits.length}</span>
          </div>
          {habits.map(h => (
            <div key={h.id} onClick={()=>toggleHabit(h.id)} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderBottom:`1px solid ${T.linen}`, cursor:"pointer", touchAction:"manipulation" }}>
              <div style={{ width:36, height:36, borderRadius:"50%", background:h.done?`${T.sage}20`:T.sand, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0, transition:"background .2s" }}>{h.icon}</div>
              <p style={{ fontFamily:F.sans, fontSize:13, color:h.done?T.taupe:T.esp, margin:0, flex:1, textDecoration:h.done?"line-through":"none", transition:"all .2s" }}>{h.label}</p>
              <div style={{ width:24, height:24, borderRadius:8, border:`2px solid ${h.done?T.sage:T.linen}`, background:h.done?T.sage:"transparent", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:14, flexShrink:0, transition:"all .2s" }}>
                {h.done ? "✓" : ""}
              </div>
            </div>
          ))}
        </Card>
      </>}

      {/* ── WEEKLY SCORE ───────────────────────────────────────────── */}
      {tab==="score" && <>
        {score ? (
          <>
            <div style={{ background:`linear-gradient(135deg,${T.esp},#3D2E22)`, borderRadius:24, padding:"24px 20px", marginBottom:16, textAlign:"center" }}>
              <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, letterSpacing:"0.16em", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", margin:"0 0 8px" }}>WEEKLY SCORE</p>
              <div style={{ fontFamily:F.serif, fontSize:72, fontWeight:600, color:T.gold, lineHeight:1 }}>{score.score}</div>
              <div style={{ fontFamily:F.sans, fontSize:11, color:"rgba(255,255,255,0.4)" }}>/10</div>
              <p style={{ fontFamily:F.serif, fontSize:18, fontStyle:"italic", color:"#fff", margin:"16px 0 0", lineHeight:1.4 }}>{score.headline}</p>
              <AIBadge label="Generated by Nora" />
            </div>
            {score.wins?.length > 0 && (
              <Card>
                <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>THIS WEEK'S WINS</p>
                {score.wins.map((w,i) => (
                  <div key={i} style={{ display:"flex", gap:10, padding:"8px 0" }}>
                    <span style={{ color:T.gold, flexShrink:0 }}>✦</span>
                    <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{w}</p>
                  </div>
                ))}
              </Card>
            )}
            {score.focus && (
              <Card>
                <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 8px" }}>FOCUS FOR NEXT WEEK</p>
                <p style={{ fontFamily:F.sans, fontSize:14, color:T.esp, margin:0, lineHeight:1.6 }}>{score.focus}</p>
              </Card>
            )}
            {score.affirmation && (
              <div style={{ background:`linear-gradient(135deg,${T.gold}15,${T.esp}08)`, border:`1px solid ${T.gold}30`, borderRadius:16, padding:"16px 18px", marginBottom:12 }}>
                <p style={{ fontFamily:F.serif, fontSize:16, fontStyle:"italic", color:T.esp, margin:0, lineHeight:1.6 }}>{score.affirmation}</p>
              </div>
            )}
            <button onClick={generateScore} disabled={generatingScore} style={{ width:"100%", padding:"12px", background:"none", border:`1.5px solid ${T.linen}`, borderRadius:14, fontFamily:F.sans, fontSize:13, color:T.taupe, cursor:"pointer", marginTop:4, minHeight:48 }}>
              ↻ Regenerate Score
            </button>
          </>
        ) : (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:14, color:T.taupe, textAlign:"center", padding:"16px 0 8px", lineHeight:1.6 }}>
              Nora will analyse your sleep, water, habits and mood to generate your personalised weekly wellness score.
            </p>
            <button onClick={generateScore} disabled={generatingScore} style={{ width:"100%", padding:"14px", background:`linear-gradient(135deg,${T.esp},#4a2e18)`, color:"#fff", border:"none", borderRadius:14, fontFamily:F.sans, fontSize:15, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, minHeight:52, touchAction:"manipulation" }}>
              {generatingScore ? <><Spinner size={18} color="#fff"/>Calculating...</> : "✦ Generate My Score"}
            </button>
          </Card>
        )}
      </>}

      {/* ── NORA COACH ─────────────────────────────────────────────── */}
      {tab==="coach" && (
        <div style={{ display:"flex", flexDirection:"column" }}>
          <div style={{ marginBottom:12 }}>
            {coachMsgs.map((m,i) => (
              <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start", marginBottom:10 }}>
                {m.role==="assistant" && (
                  <div style={{ width:28, height:28, borderRadius:"50%", background:`linear-gradient(135deg,${T.sage},#4a8c50)`, display:"flex", alignItems:"center", justifyContent:"center", marginRight:8, flexShrink:0, alignSelf:"flex-end" }}>
                    <span style={{ fontSize:12 }}>✦</span>
                  </div>
                )}
                <div style={{ maxWidth:"82%", background:m.role==="user"?`linear-gradient(135deg,${T.esp},#4a3020)`:"#fff", borderRadius:m.role==="user"?"20px 20px 4px 20px":"20px 20px 20px 4px", padding:"12px 16px", border:m.role==="assistant"?`1px solid ${T.linen}`:"none" }}>
                  {m.content.split("\n").filter(l=>l.trim()).map((line,j) => (
                    <p key={j} style={{ fontFamily:F.sans, fontSize:13, color:m.role==="user"?"rgba(255,255,255,.9)":T.esp, margin:"0 0 4px", lineHeight:1.6 }}>{line}</p>
                  ))}
                </div>
              </div>
            ))}
            {coachLoading && (
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <div style={{ width:28, height:28, borderRadius:"50%", background:`linear-gradient(135deg,${T.sage},#4a8c50)`, display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ fontSize:12 }}>✦</span></div>
                <div style={{ background:"#fff", borderRadius:"20px 20px 20px 4px", padding:"12px 16px", border:`1px solid ${T.linen}` }}><Spinner size={16}/></div>
              </div>
            )}
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
