import React, { useEffect, useState } from "react";
import { T, F } from "../../config/theme";
import toast from "react-hot-toast";
import { useStore } from "../../core/store";
import { useAdaptiveUX, filterInsightsForDisplay, getStateBannerProps, getAdaptiveGreeting } from "../../core/household/adaptiveUX";
import { loadData } from "../../core/firebase";
import { db } from "../../core/db";
import { Spinner } from "../../shared/components";
import { createActionsFromInsight, executeRecommendedAction } from "../../core/recommendationActions";
import { CleoSetupScreen } from "../onboarding/OnboardingScreen";
import { buildHouseholdSnapshot, generateHouseholdInsights, getTopInsight, loadHouseholdInsights, saveHouseholdInsights } from "../../core/household";
import { computeHouseholdScores, type HouseholdScores, type ScoreBand, type AttentionSeverity } from "../../core/intelligence/householdScores";

// ── Shared home-data fetch ─────────────────────────────────────────
// Three cards used to fire their own loadData bursts for the same docs.
// One promise per uid per mount-window; each card derives its own state.
let _homeDocs: { uid: string; at: number; p: Promise<Record<string, any>> } | null = null;
function loadHomeDocs(uid: string): Promise<Record<string, any>> {
  if (_homeDocs && _homeDocs.uid === uid && Date.now() - _homeDocs.at < 30_000) return _homeDocs.p;
  const p = (async () => {
    const [tasks, budgetV2, budgetV1, calendar, school, trips, circle, thrive] = await Promise.all([
      loadData(uid, "tasks"),
      loadData(uid, "budget_v2"),
      loadData(uid, "budget"),
      loadData(uid, "calendar"),
      loadData(uid, "school"),
      loadData(uid, "trips"),
      loadData(uid, "circle"),
      loadData(uid, "thrive"),
    ]);
    return { tasks, budget: budgetV2 || budgetV1, calendar, school, trips, circle, thrive };
  })();
  _homeDocs = { uid, at: Date.now(), p };
  return p;
}

// ── Briefing Hero Card (unchanged) ────────────────────────────────
const getWindow = () => {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return { id:"morning",   label:"YOUR MORNING",   greeting:"Good morning",   icon:"☀" };
  if (h >= 12 && h < 17) return { id:"afternoon", label:"AFTERNOON CHECK", greeting:"Good afternoon", icon:"◦" };
  return { id:"evening", label:"EVENING WIND-DOWN", greeting:"Good evening", icon:"✦" };
};

function BriefingHero({ onExpand }: { onExpand: () => void }) {
  const [weather, setWeather] = React.useState<any>(null);
  React.useEffect(() => {
    import("../../core/weather").then(({ getWeatherByLocation }) => {
      getWeatherByLocation().then(w => { if (w) setWeather(w); });
    });
  }, []);
  const [briefing, setBriefing] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);
  const { user, profile } = useStore();
  const [tasks, setTasks] = React.useState<any[]>([]);
  const [events, setEvents] = React.useState<any[]>([]);
  const [moodLogged, setMoodLogged] = React.useState(false);
  const [mood, setMood] = React.useState<string|null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    db.getTodayBriefing().then((cached: any) => {
      if (cached?.data) setBriefing(cached.data);
    }).catch(() => {});
    import("../../core/firebase").then(({ loadData }) => {
      const uid = user?.uid;
      if (!uid) return;
      loadData(uid, "tasks").then((d:any) => { if (d?.tasks) setTasks(d.tasks); });
      loadData(uid, "calendar").then((d:any) => { if (d?.events) setEvents(d.events); });
      loadData(uid, "thrive").then((d:any) => {
        const today = new Date().toISOString().split("T")[0];
        const todayMood = (d?.moodLog as any[])?.find((m:any) => m.date === today);
        if (todayMood) setMoodLogged(true);
      });
    });
  }, [user?.uid]);

  if (!briefing) return (
    <div onClick={onExpand} style={{ background: `linear-gradient(135deg,${T.esp},#3D2E22)`, borderRadius: 20, padding: "20px", marginBottom: 12, cursor: "pointer" }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: "0 0 6px" }}>{getWindow().label}</p>
      <p style={{ fontFamily: F.serif, fontSize: 22, fontStyle: "italic", color: "#fff", margin: "0 0 4px" }}>{getWindow().icon} {getWindow().greeting}</p>
      <p style={{ fontFamily: F.sans, fontSize: 12, color: "rgba(255,255,255,0.5)", margin: 0 }}>Tap to generate your {getWindow().id} briefing →</p>
    </div>
  );

  return (
    <div style={{ background: `linear-gradient(135deg,${T.esp},#3D2E22)`, borderRadius: 20, padding: "20px", marginBottom: 12, cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: "0 0 4px" }}>{getWindow().label}</p>
          {briefing.focusWord && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: F.serif, fontSize: 32, fontStyle: "italic", color: T.gold, letterSpacing:"-0.02em" }}>{briefing.focusWord.word}</span>
              <span style={{ fontSize: 24 }}>{briefing.focusWord.emoji}</span>
            </div>
          )}
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
          {weather && (
            <div style={{ display:"flex", alignItems:"center", gap:4, background:"rgba(255,255,255,0.08)", borderRadius:20, padding:"3px 10px" }}>
              <span style={{ fontSize:14 }}>{weather.icon}</span>
              <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"rgba(255,255,255,0.8)" }}>{weather.temp}°{weather.unit}</span>
            </div>
          )}
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 14 }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {briefing.greeting && !expanded && (
        <p style={{ fontFamily:F.serif, fontSize:14, fontStyle:"italic", color:"rgba(255,255,255,0.7)", margin:"0 0 10px", lineHeight:1.5 }}>
          "{briefing.greeting}"
        </p>
      )}

      {!expanded && (() => {
        const today = new Date().toISOString().split("T")[0];
        const pendingTasks = tasks.filter((t:any) => t.status === "pending").length;
        const doneTasks = tasks.filter((t:any) => t.status === "completed" && t.updatedAt > Date.now() - 86400000).length;
        const nextEvent = events.filter((e:any) => e.date >= today).sort((a:any,b:any) => a.date.localeCompare(b.date))[0];
        return (
          <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
            <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:20, padding:"3px 10px", display:"flex", alignItems:"center", gap:4 }}>
              <span style={{ fontSize:11 }}>✓</span>
              <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"rgba(255,255,255,0.8)" }}>{doneTasks}/{doneTasks+pendingTasks} tasks</span>
            </div>
            {nextEvent && (
              <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:20, padding:"3px 10px", display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ fontSize:11 }}>📅</span>
                <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"rgba(255,255,255,0.8)" }}>{nextEvent.title?.slice(0,20)}</span>
              </div>
            )}
          </div>
        );
      })()}

      {!expanded && briefing.priorities?.slice(0, 3).map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0" }}>
          <span style={{ fontFamily: F.sans, fontSize: 11, color: T.gold, flexShrink: 0 }}>{i + 1}.</span>
          <p style={{ fontFamily: F.sans, fontSize: 12, color: "rgba(255,255,255,0.8)", margin: 0, lineHeight: 1.4 }}>{p.text}</p>
        </div>
      ))}

      {!expanded && getWindow().id === "evening" && !moodLogged && (
        <div style={{ marginTop:12, paddingTop:10, borderTop:"1px solid rgba(255,255,255,0.1)" }}>
          <p style={{ fontFamily:F.sans, fontSize:11, color:"rgba(255,255,255,0.5)", margin:"0 0 8px" }}>How did today feel?</p>
          <div style={{ display:"flex", gap:8 }}>
            {[{label:"◦ Hard", color:"#C4846A"},{label:"◎ Okay", color:"#C9A961"},{label:"✦ Good", color:"#4CAF7D"}].map(m => (
              <button key={m.label} onClick={async e => {
                e.stopPropagation();
                setMoodLogged(true);
                setMood(m.label);
                const { loadData, saveData } = await import("../../core/firebase");
                if (!user?.uid) return;
                const today = new Date().toISOString().split("T")[0];
                const d = await loadData(user.uid, "thrive");
                const logs = (d?.moodLog as any[]) || [];
                const rating = m.label.includes("Hard") ? 3 : m.label.includes("Okay") ? 6 : 9;
                logs.unshift({ date:today, rating, label:m.label.replace(/[◦◎✦] /,"") });
                await saveData(user.uid, "thrive", { ...d, moodLog: logs.slice(0,30) });
              }}
                style={{ flex:1, padding:"6px 8px", background:"rgba(255,255,255,0.06)", border:`1px solid ${m.color}40`, borderRadius:10, fontFamily:"'DM Sans',sans-serif", fontSize:11, color:m.color, cursor:"pointer", touchAction:"manipulation" }}>
                {m.label}
              </button>
            ))}
          </div>
          {mood && <p style={{ fontFamily:F.sans, fontSize:11, color:"rgba(255,255,255,0.4)", margin:"6px 0 0", textAlign:"center" }}>Logged ✓</p>}
        </div>
      )}

      <div style={{ maxHeight: expanded ? "800px" : "0px", overflow: "hidden", transition: "max-height 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}>
        {briefing.focusWord?.why && (
          <p style={{ fontFamily: F.sans, fontSize: 12, color: "rgba(255,255,255,0.6)", margin: "8px 0 12px", fontStyle: "italic" }}>{briefing.focusWord.why}</p>
        )}
        {briefing.priorities?.map((p: any, i: number) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ fontFamily: F.sans, fontSize: 11, color: T.gold, flexShrink: 0, width: 16 }}>{p.rank}.</span>
            <div>
              <p style={{ fontFamily: F.sans, fontSize: 12, color: "#fff", margin: "0 0 2px", fontWeight: 600 }}>{p.text}</p>
              <p style={{ fontFamily: F.sans, fontSize: 11, color: "rgba(255,255,255,0.5)", margin: 0 }}>{p.whyToday}</p>
            </div>
          </div>
        ))}
        {briefing.energy && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(255,255,255,0.06)", borderRadius: 10 }}>
            <p style={{ fontFamily: F.sans, fontSize: 11, color: T.gold, margin: "0 0 4px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Energy · {briefing.energy.predictedLevel}</p>
            <p style={{ fontFamily: F.sans, fontSize: 12, color: "rgba(255,255,255,0.7)", margin: 0 }}>{briefing.energy.tip}</p>
          </div>
        )}
        {briefing.affirmation && (
          <p style={{ fontFamily: F.serif, fontSize: 14, fontStyle: "italic", color: "rgba(255,255,255,0.7)", margin: "12px 0 0", lineHeight: 1.6 }}>"{briefing.affirmation.text}"</p>
        )}
      </div>

      <p style={{ fontFamily: F.sans, fontSize: 11, color: "rgba(255,255,255,0.35)", margin: "10px 0 0", textAlign: "center" }}>
        {expanded ? "Tap to collapse" : "Tap to expand full briefing"}
      </p>
    </div>
  );
}

// ── NEW: Household Pulse Card ─────────────────────────────────────
function HouseholdPulseCard() {
  const { user, profile, householdSnapshot, householdInsights, setHouseholdSnapshot, setHouseholdInsights, dismissInsight } = useStore();
  const [loading, setLoading] = useState(false);
  const [insightLoading, setInsightLoading] = useState(false);
  const [showCleoSetup, setShowCleoSetup] = useState(false);

  // Load snapshot + insights on mount
  useEffect(() => {
    if (!user?.uid || householdSnapshot) return;
    setLoading(true);
    buildHouseholdSnapshot(user.uid)
      .then(snap => setHouseholdSnapshot(snap))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || householdInsights.length > 0) return;
    loadHouseholdInsights(user.uid).then(ins => {
      if (ins.length > 0) setHouseholdInsights(ins);
    });
  }, [user?.uid]);

  const handleGenerateInsight = async () => {
    if (!user?.uid || !householdSnapshot) return;
    setInsightLoading(true);
    try {
      const insights = await generateHouseholdInsights(householdSnapshot, user.uid, {
        profileName: profile?.name,
        kids: profile?.kids?.map((k: any) => k.name),
      });
      if (insights.length > 0) {
        setHouseholdInsights(insights);
        await saveHouseholdInsights(user.uid, insights);
      }
    } catch (e) {
      console.warn("[Home] insight generation failed:", e);
      toast.error("Couldn't generate insights — try again in a moment");
    }
    setInsightLoading(false);
  };

  if (showCleoSetup) return <CleoSetupScreen onComplete={() => setShowCleoSetup(false)} />;

  const snap = householdSnapshot;
  const adaptiveConfig = useAdaptiveUX(snap);
  const filteredInsights = filterInsightsForDisplay(householdInsights, adaptiveConfig);
  const topInsight = getTopInsight(filteredInsights.length ? filteredInsights : householdInsights);
  const banner = getStateBannerProps(adaptiveConfig);

  const gradeColor = (grade: string) => {
    const map: Record<string, string> = { A: T.sage, B: T.teal, C: T.gold, D: T.blush, F: "#ff4444", "—": T.taupe };
    return map[grade] || T.taupe;
  };

  const loadColor = (load: string) => {
    const map: Record<string, string> = { light: T.sage, normal: T.teal, heavy: T.gold, critical: T.blush };
    return map[load] || T.taupe;
  };

  const loadLabel = (load: string) => {
    const map: Record<string, string> = { light: "Light", normal: "Steady", heavy: "Heavy", critical: "Critical" };
    return map[load] || load;
  };

  if (loading) return (
    <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12, display: "flex", justifyContent: "center" }}>
      <Spinner size={20} />
    </div>
  );

  if (!snap) return null;

  const f = snap.financial;
  const pct = f.totalBudget > 0 ? Math.round((f.totalSpent / f.totalBudget) * 100) : 0;

  return (
    <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: 0 }}>HOUSEHOLD PULSE</p>
        <span style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe }}>
          {new Date(snap.lastRefreshed).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>

      {/* Adaptive state banner */}
      {banner.show && (
        <div style={{ padding: "8px 10px", background: `${banner.color}15`, borderRadius: 10, marginBottom: 10, borderLeft: `3px solid ${banner.color}` }}>
          <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: banner.color, margin: "0 0 2px" }}>{banner.label}</p>
          <p style={{ fontFamily: F.sans, fontSize: 11, color: T.esp, margin: 0 }}>{banner.description}</p>
        </div>
      )}

      {/* Three stat pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {/* Financial health */}
        <div onClick={() => useStore.getState().setActiveTab("budget")}
          style={{ flex: 1, padding: "10px 8px", background: "#fff", borderRadius: 14, border: `1px solid ${T.linen}`, textAlign: "center", cursor: "pointer" }}>
          <p style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: gradeColor(f.financialHealthGrade), margin: "0 0 2px" }}>
            {f.financialHealthGrade}
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Finance</p>
        </div>

        {/* Calendar load */}
        <div onClick={() => useStore.getState().setActiveTab("calendar")}
          style={{ flex: 1, padding: "10px 8px", background: "#fff", borderRadius: 14, border: `1px solid ${T.linen}`, textAlign: "center", cursor: "pointer" }}>
          <p style={{ fontFamily: F.serif, fontSize: 14, fontWeight: 700, color: loadColor(snap.calendarLoad), margin: "0 0 2px" }}>
            {loadLabel(snap.calendarLoad)}
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Schedule</p>
        </div>

        {/* Household stress */}
        <div onClick={() => useStore.getState().setActiveTab("briefing")}
          style={{ flex: 1, padding: "10px 8px", background: "#fff", borderRadius: 14, border: `1px solid ${T.linen}`, textAlign: "center", cursor: "pointer" }}>
          <p style={{ fontFamily: F.serif, fontSize: 14, fontWeight: 700,
            color: snap.householdStressLevel === "high" ? T.blush : snap.householdStressLevel === "moderate" ? T.gold : T.sage,
            margin: "0 0 2px", textTransform: "capitalize" }}>
            {snap.householdStressLevel}
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Stress</p>
        </div>
      </div>

      {/* Budget bar */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe }}>Budget this month</span>
          <span style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700,
            color: pct > 90 ? T.blush : pct > 70 ? T.gold : T.sage }}>
            {pct}% · ${Math.round(f.cashRemaining).toLocaleString()} left
          </span>
        </div>
        <div style={{ height: 4, background: T.linen, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: pct > 90 ? T.blush : pct > 70 ? T.gold : T.sage, borderRadius: 4, transition: "width 0.6s ease" }} />
        </div>
      </div>

      {/* Goals at risk */}
      {snap.activeGoals.filter(g => g.riskStatus !== "on_track").length > 0 && (
        <div style={{ padding: "8px 10px", background: `${T.gold}10`, borderRadius: 10, marginBottom: 10 }}>
          <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0 }}>
            ⚠ {snap.activeGoals.filter(g => g.riskStatus !== "on_track").map(g => g.name).join(", ")} {snap.activeGoals.filter(g => g.riskStatus !== "on_track").length === 1 ? "goal needs" : "goals need"} attention
          </p>
        </div>
      )}

      {/* Top AI insight */}
      {/* Top 3 insights */}
      {(filteredInsights.length ? filteredInsights : householdInsights)
        .filter(i => !i.dismissed)
        .slice(0, 3)
        .map((insight, idx) => {
          const CATEGORY_COLORS: Record<string, string> = {
            spending: T.blush, savings: T.sage, debt: T.gold,
            cashflow: T.teal, stress: T.lav, scheduling: T.sky,
            family: T.esp, health: T.sage, decision: T.gold, opportunity: T.teal,
          };
          const color = CATEGORY_COLORS[insight.category] || T.teal;
          return (
            <div key={insight.id} style={{ padding: "10px 12px", background: `${color}10`, borderRadius: 12, border: `1px solid ${color}25`, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    ✦ {insight.category?.toUpperCase() || "INSIGHT"} {idx === 0 ? "· TOP PRIORITY" : ""}
                  </p>
                  <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: "0 0 4px", lineHeight: 1.5 }}>
                    {insight.observation}
                  </p>
                  <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color, margin: 0 }}>
                    → {insight.recommendation}
                  </p>
                </div>
                <button onClick={() => dismissInsight(insight.id)}
                  style={{ background: "none", border: "none", color: T.taupe, cursor: "pointer", fontSize: 16, flexShrink: 0, padding: 0 }}>
                  ×
                </button>
              </div>
            </div>
          );
        })
      }

      {/* Empty state when no insights */}
      {householdInsights.filter(i => !i.dismissed).length === 0 && !insightLoading && (householdSnapshot?.financial?.monthlyIncome || 0) === 0 && (
        <div style={{ background:T.sand, borderRadius:16, padding:"20px", marginBottom:12, textAlign:"center" }}>
          <p style={{ fontFamily:F.serif, fontSize:18, fontStyle:"italic", color:T.esp, margin:"0 0 8px" }}>Cleo is ready when you are</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 16px", lineHeight:1.6 }}>Add your income and budget to unlock household insights, financial health scores, and Cleo's full intelligence.</p>
          <button onClick={() => setShowCleoSetup(true)}
            style={{ background:T.esp, color:"#fff", border:"none", borderRadius:12, padding:"10px 20px", fontFamily:F.sans, fontSize:13, fontWeight:600, cursor:"pointer" }}>
            Set up with Cleo ✦
          </button>
        </div>
      )}

      {/* Generate / refresh insights — hidden in relief mode */}
      {adaptiveConfig.showOptimizationNudges && (
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleGenerateInsight} disabled={insightLoading}
          style={{ flex: 1, padding: "8px", background: "none", border: `1px solid ${T.teal}`, borderRadius: 10, fontFamily: F.sans, fontSize: 11, color: T.teal, cursor: "pointer" }}>
          {insightLoading ? "Analyzing..." : householdInsights.length > 0 ? "↺ Refresh insights" : "✦ Generate insights"}
        </button>
        <button onClick={() => setShowCleoSetup(true)}
          style={{ flex: 1, padding: "8px", background: "none", border: `1px solid ${T.linen}`, borderRadius: 10, fontFamily: F.sans, fontSize: 11, color: T.esp, cursor: "pointer" }}>
          View CFO →
        </button>
      </div>
      )}

      {showCleoSetup && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: T.cream, overflowY: "auto" }}>
          <CleoSetupScreen onComplete={() => setShowCleoSetup(false)} />
        </div>
      )}
    </div>
  );
}

// ── Today's Intelligence Card (unchanged) ─────────────────────────
// ── Phase 4: Household Intelligence scores + Risk Radar ──────────
const BAND_COLOR: Record<ScoreBand, string> = { fragile: T.blush, stretched: T.gold, steady: T.teal, resilient: T.sage };
const SEV_COLOR: Record<AttentionSeverity, string> = { alert: T.blush, watch: T.gold, info: T.sky };
const SEV_RANK: Record<AttentionSeverity, number> = { alert: 3, watch: 2, info: 1 };
const SOURCE_TAB: Record<string, string> = { budget: "budget", tasks: "plan", school: "plan", trips: "trips", goals: "budget", thrive: "thrive", circle: "circle", calendar: "calendar" };
const cc_str = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

// ── Phase 6: Command Center — the unified "what needs you today" ──
// Pure consumer of the intelligence outputs: merges the Risk Radar, proactive
// alerts, and any recommended actions into ONE ranked queue at the top of home.
interface CCItem { id: string; severity: AttentionSeverity; label: string; detail: string; tab: string; }

function CommandCenterCard() {
  const { user, profile } = useStore();
  const setActiveTab = useStore(s => s.setActiveTab);
  const [items, setItems] = useState<CCItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    // Safety ceiling: never leave the Command Center spinning on a hung read
    const ceiling = setTimeout(() => { if (alive) setLoading(false); }, 12_000);
    (async () => {
      const out: CCItem[] = [];
      try {
        const { buildAppContext } = await import("../../core/contextBuilder");
        const appCtx = await buildAppContext(user.uid, (profile ?? {}) as unknown as Record<string, unknown>);
        for (const a of computeHouseholdScores(appCtx).attention) {
          out.push({ id: `radar_${a.id}`, severity: a.severity, label: cc_str(a.title), detail: cc_str(a.suggestedAction), tab: SOURCE_TAB[a.source] || "plan" });
        }
      } catch (e) { console.warn("[CommandCenter] radar failed:", e); }
      try {
        const alerts = ((await loadData(user.uid, "alerts"))?.alerts as any[]) || [];
        // Relationship nudges are gentle by design — surface at most one, as info.
        let circleShown = false;
        for (const al of alerts.slice(0, 6)) {
          const isCircle = cc_str(al?.type) === "circle";
          if (isCircle && circleShown) continue;
          if (isCircle) circleShown = true;
          const sev: AttentionSeverity = isCircle ? "info" : al?.severity === "critical" ? "alert" : al?.severity === "warning" ? "watch" : "info";
          let label = cc_str(al?.message);
          // Sanitize legacy stored copies of the old guilt-y circle wording
          const legacy = label.match(/^(.+?) — (\d+) days since last contact$/);
          if (legacy) label = Number(legacy[2]) >= 999 ? `Say hi to ${legacy[1]} when you have a moment ✦` : `${legacy[1]} might love to hear from you — it's been ${legacy[2]} days`;
          if (label) out.push({ id: `alert_${cc_str(al?.type)}_${label.slice(0, 12)}`, severity: sev, label, detail: "", tab: SOURCE_TAB[cc_str(al?.type)] || "home" });
        }
      } catch { /* non-fatal */ }
      try {
        const actions = ((await loadData(user.uid, "recommended_actions"))?.actions as any[]) || [];
        for (const ac of actions.filter(a => a?.status === "pending" || a?.status === "active").slice(0, 4)) {
          const sev: AttentionSeverity = ac?.priority === "high" ? "alert" : ac?.priority === "medium" ? "watch" : "info";
          const label = cc_str(ac?.label);
          if (label) out.push({ id: `rec_${cc_str(ac?.id)}`, severity: sev, label, detail: cc_str(ac?.description), tab: SOURCE_TAB[cc_str(ac?.targetModule)] || "cleo" });
        }
      } catch { /* non-fatal */ }

      // Dedup by label, rank by severity, keep the top few.
      const seen = new Set<string>();
      const ranked = out
        .filter(i => i.label && !seen.has(i.label.toLowerCase()) && seen.add(i.label.toLowerCase()))
        .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])
        .slice(0, 5);
      if (alive) { setItems(ranked); setLoading(false); }
      clearTimeout(ceiling);
    })();
    return () => { alive = false; clearTimeout(ceiling); };
  }, [user?.uid]);

  if (loading) return (
    <div style={{ background: T.esp, borderRadius: 20, padding: "18px", marginBottom: 12, display: "flex", justifyContent: "center" }}>
      <Spinner size={20} />
    </div>
  );

  const allClear = items.length === 0;

  return (
    <div style={{ background: T.esp, borderRadius: 20, padding: "18px", marginBottom: 12, color: "#fff" }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: "0 0 6px" }}>COMMAND CENTER</p>
      <p style={{ fontFamily: F.serif, fontSize: 22, fontStyle: "italic", color: "#fff", margin: "0 0 14px", lineHeight: 1.15 }}>
        {allClear ? "You're all caught up ✦" : `${items.length} thing${items.length > 1 ? "s" : ""} need${items.length > 1 ? "" : "s"} you today`}
      </p>
      {allClear ? (
        <p style={{ fontFamily: F.sans, fontSize: 13, color: "rgba(255,255,255,0.7)", margin: 0, lineHeight: 1.5 }}>Nothing pressing across your finances, schedule, tasks or people. I'll flag anything that needs a decision.</p>
      ) : (
        items.map(it => {
          const color = SEV_COLOR[it.severity];
          return (
            <div key={it.id} onClick={() => setActiveTab(it.tab)}
              style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "10px 12px", background: "rgba(255,255,255,0.06)", borderRadius: 12, marginBottom: 7, cursor: "pointer", borderLeft: `3px solid ${color}` }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 5 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: F.sans, fontSize: 13.5, fontWeight: 700, color: "#fff", margin: "0 0 1px" }}>{it.label}</p>
                {it.detail && <p style={{ fontFamily: F.sans, fontSize: 12, color: "rgba(255,255,255,0.7)", margin: 0, lineHeight: 1.4 }}>{it.detail}</p>}
              </div>
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 16, flexShrink: 0 }}>›</span>
            </div>
          );
        })
      )}
    </div>
  );
}

function ScoreDial({ label, score, band, headline }: { label: string; score: number; band: ScoreBand; headline: string }) {
  const color = BAND_COLOR[band];
  return (
    <div style={{ flex: 1, background: "#fff", border: `1px solid ${T.linen}`, borderRadius: 14, padding: "12px 12px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontFamily: F.sans, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.taupe }}>{label}</span>
        <span style={{ fontFamily: F.serif, fontSize: 24, fontWeight: 700, color }}>{score}</span>
      </div>
      <div style={{ height: 4, background: T.linen, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.6s ease" }} />
      </div>
      <p style={{ fontFamily: F.sans, fontSize: 10.5, color: T.bark, margin: 0, lineHeight: 1.4 }}>
        <span style={{ fontWeight: 700, color, textTransform: "capitalize" }}>{band}</span> · {headline}
      </p>
    </div>
  );
}

function HouseholdScoresCard() {
  const { user, profile } = useStore();
  const [scores, setScores] = useState<HouseholdScores | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    (async () => {
      try {
        const { buildAppContext } = await import("../../core/contextBuilder");
        const appCtx = await buildAppContext(user.uid, (profile ?? {}) as unknown as Record<string, unknown>);
        if (alive) setScores(computeHouseholdScores(appCtx));
      } catch (e) {
        console.warn("[Home] scores failed:", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.uid]);

  if (loading) return (
    <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12, display: "flex", justifyContent: "center" }}>
      <Spinner size={20} />
    </div>
  );
  if (!scores) return null;

  return (
    <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12 }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>HOUSEHOLD INTELLIGENCE</p>

      {/* Resilience + Productivity dials (the Risk Radar lives in the Command Center) */}
      <div style={{ display: "flex", gap: 8 }}>
        <ScoreDial label="Resilience" score={scores.resilience.score} band={scores.resilience.band} headline={scores.resilience.headline} />
        <ScoreDial label="Productivity" score={scores.productivity.score} band={scores.productivity.band} headline={scores.productivity.headline} />
      </div>
    </div>
  );
}

function IntelligenceCard() {
  const { user } = useStore();
  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    const today = new Date().toISOString().split("T")[0];
    loadHomeDocs(user.uid).then(({ tasks: tasksD, budget: budgetD, calendar: calendarD, school: schoolD, trips: tripsD, circle: circleD }) => {
      const allTasks = (tasksD?.tasks as any[]) || [];
      const pending = allTasks.filter((t: any) => t.status !== "completed");
      const overdue = pending.filter((t: any) => t.dueDate && t.dueDate < today);
      const categories = (budgetD?.categories as any[]) || [];
      const totalBudget = categories.reduce((s: number, c: any) => s + (c.budget || 0), 0);
      const totalSpent = categories.reduce((s: number, c: any) => s + (c.spent || 0), 0);
      const budgetPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
      const budgetStatus = budgetPct >= 95 ? "critical" : budgetPct >= 85 ? "warning" : budgetPct >= 70 ? "watch" : "healthy";
      const calEvents = (calendarD?.events as any[]) || [];
      const todayEvents = calEvents.filter((e: any) => e.date === today);
      const schoolEvents = (schoolD?.events as any[]) || [];
      const urgentSchool = schoolEvents.filter((e: any) => e.requiresAction && e.actionDeadline >= today);
      const trips = (tripsD?.trips as any[]) || [];
      const upcoming = trips.filter((t: any) => t.departureDate > today).sort((a: any, b: any) => a.departureDate.localeCompare(b.departureDate));
      const nextTrip = upcoming[0];
      const daysUntil = nextTrip ? Math.ceil((new Date(nextTrip.departureDate).getTime() - Date.now()) / 86400000) : null;
      const contacts = (circleD?.contacts as any[]) || [];
      const circleOverdue = contacts.filter((c: any) => {
        if (!c.lastContact) return true;
        const days = Math.floor((Date.now() - new Date(c.lastContact).getTime()) / 86400000);
        const freq = c.frequency === "weekly" ? 7 : c.frequency === "monthly" ? 30 : 90;
        return days > freq;
      }).length;
      setData({ pending: pending.length, overdue: overdue.length, budgetPct, budgetStatus, todayEvents: todayEvents.length, nextEvent: todayEvents[0], urgentSchool: urgentSchool.length, urgentSchoolItem: urgentSchool[0], nextTrip, daysUntil, circleOverdue });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user?.uid]);

  const budgetColor = data.budgetStatus === "critical" ? "#dc2626" : data.budgetStatus === "warning" ? T.gold : T.sage;

  return (
    <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12 }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>TODAY'S INTELLIGENCE</p>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}><Spinner size={20} /></div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div onClick={() => useStore.getState().setActiveTab("plan")} style={{ background: "#fff", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: `1px solid ${T.linen}`, cursor: "pointer" }}>
              <p style={{ fontFamily: F.serif, fontSize: 20, fontWeight: 700, color: data.overdue > 0 ? "#dc2626" : T.esp, margin: "0 0 2px" }}>{data.pending || 0}</p>
              <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Tasks{data.overdue > 0 ? ` · ${data.overdue} late` : ""}</p>
            </div>
            <div onClick={() => useStore.getState().setActiveTab("calendar")} style={{ background: "#fff", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: `1px solid ${T.linen}`, cursor: "pointer" }}>
              <p style={{ fontFamily: F.serif, fontSize: 20, fontWeight: 700, color: T.esp, margin: "0 0 2px" }}>{data.todayEvents || 0}</p>
              <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Events</p>
            </div>
            <div onClick={() => useStore.getState().setActiveTab("budget")} style={{ background: "#fff", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: `1px solid ${T.linen}`, cursor: "pointer" }}>
              <p style={{ fontFamily: F.serif, fontSize: 20, fontWeight: 700, color: budgetColor, margin: "0 0 2px" }}>{data.budgetPct || 0}%</p>
              <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Budget</p>
            </div>
          </div>
          {data.urgentSchool > 0 && (
            <div onClick={() => useStore.getState().setActiveTab("plan")} style={{ display: "flex", gap: 10, padding: "8px 10px", background: `${T.blush}10`, borderRadius: 10, marginBottom: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>🎒</span>
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0 }}>{data.urgentSchoolItem?.title || `${data.urgentSchool} school action needed`}</p>
            </div>
          )}
          {data.nextTrip && data.daysUntil !== null && data.daysUntil <= 30 && (
            <div onClick={() => useStore.getState().setActiveTab("trips")} style={{ display: "flex", gap: 10, padding: "8px 10px", background: `${T.gold}10`, borderRadius: 10, marginBottom: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>✈️</span>
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0 }}>{data.nextTrip.destination} in {data.daysUntil} days</p>
            </div>
          )}
          {data.circleOverdue > 0 && (
            <div onClick={() => useStore.getState().setActiveTab("circle")} style={{ display: "flex", gap: 10, padding: "8px 10px", background: `${T.gold}10`, borderRadius: 10, marginBottom: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>💌</span>
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0 }}>{data.circleOverdue} check-in{data.circleOverdue > 1 ? "s" : ""} overdue</p>
            </div>
          )}
          {data.nextEvent && (
            <div onClick={() => useStore.getState().setActiveTab("calendar")} style={{ display: "flex", gap: 10, padding: "8px 10px", background: `${T.sage}10`, borderRadius: 10, marginBottom: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>📅</span>
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0 }}>{data.nextEvent.title}{data.nextEvent.time ? ` · ${data.nextEvent.time}` : ""}</p>
            </div>
          )}
          {!data.urgentSchool && !data.nextTrip && !data.circleOverdue && !data.nextEvent && data.pending === 0 && (
            <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, textAlign: "center", padding: "8px 0", fontStyle: "italic" }}>You're all caught up ✦</p>
          )}
          <p onClick={() => useStore.getState().setActiveTab("plan")} style={{ fontFamily: F.sans, fontSize: 11, color: T.gold, margin: "8px 0 0", cursor: "pointer", textAlign: "right" }}>See full plan →</p>
        </>
      )}
    </div>
  );
}

// ── Family HQ Card (unchanged) ────────────────────────────────────
function FamilyHQCard() {
  const { familyMembers } = useStore();
  if (familyMembers.length === 0) return null;
  const ROLE_ICONS: Record<string, string> = { partner: "💛", child: "⭐", parent: "🌿", inlaw: "🌸", other: "✦" };
  return (
    <div onClick={() => useStore.getState().setActiveTab("family")} style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: 0 }}>FAMILY HQ</p>
        <span style={{ fontFamily: F.sans, fontSize: 11, color: T.gold }}>View →</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {familyMembers.slice(0, 4).map((m, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: `${m.color}20`, border: `1.5px solid ${m.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
              {ROLE_ICONS[m.role]}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>{m.name}</p>
              {m.notes && <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>{m.notes}</p>}
            </div>
          </div>
        ))}
      </div>
      <div onClick={(e) => { e.stopPropagation(); useStore.getState().setActiveTab("cleo"); }} style={{ marginTop: 10, padding: "8px 12px", background: `${T.gold}10`, borderRadius: 10, textAlign: "center" }}>
        <p style={{ fontFamily: F.sans, fontSize: 12, color: T.gold, margin: 0, fontWeight: 600 }}>✦ Ask Cleo about your family</p>
      </div>
    </div>
  );
}

// ── Module Grid (unchanged) ───────────────────────────────────────
function ModuleGrid() {
  const { user } = useStore();
  const setActiveTab = useStore(s => s.setActiveTab);
  const [badges, setBadges] = useState<Record<string, number | string>>({});

  useEffect(() => {
    if (!user?.uid) return;
    const today = new Date().toISOString().split("T")[0];
    loadHomeDocs(user.uid).then(({ tasks: tasksD, budget: budgetD, circle: circleD, trips: tripsD, thrive: thriveD, calendar: calendarD }) => {
      const b: Record<string, number | string> = {};
      const tasks = (tasksD?.tasks as any[]) || [];
      const overdue = tasks.filter((t: any) => t.status !== "completed" && t.dueDate && t.dueDate < today).length;
      if (overdue > 0) b.plan = overdue;
      const cats = (budgetD?.categories as any[]) || [];
      const overBudget = cats.filter((c: any) => c.budget > 0 && (c.spent / c.budget) >= 0.8).length;
      if (overBudget > 0) b.budget = overBudget;
      const contacts = (circleD?.contacts as any[]) || [];
      const circleOverdue = contacts.filter((c: any) => {
        if (!c.lastContact) return true;
        const days = Math.floor((Date.now() - new Date(c.lastContact).getTime()) / 86400000);
        const freq = c.frequency === "weekly" ? 7 : c.frequency === "monthly" ? 30 : 90;
        return days > freq;
      }).length;
      if (circleOverdue > 0) b.circle = circleOverdue;
      const trips = (tripsD?.trips as any[]) || [];
      const soon = trips.filter((t: any) => {
        const days = Math.ceil((new Date(t.departureDate).getTime() - Date.now()) / 86400000);
        return days >= 0 && days <= 14;
      });
      if (soon.length > 0) {
        const days = Math.ceil((new Date(soon[0].departureDate).getTime() - Date.now()) / 86400000);
        b.trips = days === 0 ? "today" : `${days}d`;
      }
      const logs = (thriveD?.logs as any[]) || [];
      const loggedToday = logs.some((l: any) => l.date === today);
      if (!loggedToday) b.thrive = "!";
      const events = (calendarD?.events as any[]) || [];
      const todayEvents = events.filter((e: any) => e.date === today).length;
      if (todayEvents > 0) b.calendar = todayEvents;
      setBadges(b);
    }).catch(() => {});
  }, [user?.uid]);

  const modules = [
    { id: "style",    label: "Style",    icon: "✦", sub: "What should I wear?",  color: T.blush },
    { id: "trips",    label: "Trips",    icon: "→", sub: "Plan your next escape", color: T.orange },
    { id: "thrive",   label: "Thrive",   icon: "◦", sub: "Log today's mood",     color: T.sage },
    { id: "circle",   label: "Circle",   icon: "◉", sub: "Your people",          color: T.sky },
    { id: "budget",   label: "Finances", icon: "◎", sub: "Household CFO",        color: T.yellow },
    { id: "plan",     label: "Plan",     icon: "◈", sub: "Tasks & meals",        color: T.esp },
    { id: "calendar", label: "Calendar", icon: "◆", sub: "Your schedule",        color: T.navy },
    { id: "family",   label: "Family",   icon: "⌂", sub: "Command centre",      color: T.gold },
    { id: "memory",   label: "Memory",   icon: "✦", sub: "What Cleo knows",      color: T.lav },
    { id: "connections", label: "Connect", icon: "⚯", sub: "Integrations",        color: T.teal },
  ];

  return (
    <div>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" }}>YOUR MODULES</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {modules.map((m, i) => (
          <div key={i} onClick={() => setActiveTab(m.id)}
            style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 16, padding: "14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, position: "relative", transition: "transform 0.15s ease" }}
            onMouseDown={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.97)"; }}
            onMouseUp={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
            onTouchStart={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.97)"; }}
            onTouchEnd={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: `${m.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, color: m.color, position: "relative" }}>
              {m.icon}
              {badges[m.id] !== undefined && (
                <div style={{ position: "absolute", top: -6, right: -6, background: m.id === "thrive" ? T.gold : T.blush, borderRadius: 20, minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", border: "2px solid #fff" }}>
                  <span style={{ fontFamily: F.sans, fontSize: 9, fontWeight: 700, color: "#fff" }}>{badges[m.id]}</span>
                </div>
              )}
            </div>
            <div>
              <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 700, color: T.esp, margin: "0 0 2px" }}>{m.label}</p>
              <p style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, margin: 0 }}>{m.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main HomeScreen ───────────────────────────────────────────────
export function HomeScreen() {
  const { profile } = useStore();
  const setActiveTab = useStore(s => s.setActiveTab);
  const name = profile?.name || "lovely";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <div style={{ marginBottom: 20, paddingTop: 8 }}>
        <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.taupe, margin: "0 0 6px" }}>{date}</p>
        <h1 style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: 34, color: T.esp, margin: "0 0 16px", fontWeight: 500, lineHeight: 1.1 }}>
          {greeting},<br />{name}.
        </h1>
      </div>

      <CommandCenterCard />
      <BriefingHero onExpand={() => setActiveTab("briefing")} />
      <HouseholdPulseCard />
      <HouseholdScoresCard />
      <IntelligenceCard />
      <FamilyHQCard />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
        {[
          { label: "Briefing", icon: "☀", tab: "briefing", color: T.gold },
          { label: "Chat Cleo", icon: "✦", tab: "cleo", color: T.esp },
          { label: "Add Task", icon: "+", tab: "plan", color: T.sage },
        ].map((a, i) => (
          <div key={i} onClick={() => setActiveTab(a.tab)} style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 14, padding: "12px 8px", cursor: "pointer", textAlign: "center" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `${a.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, margin: "0 auto 6px", color: a.color }}>{a.icon}</div>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color: T.esp, margin: 0 }}>{a.label}</p>
          </div>
        ))}
      </div>

      <ModuleGrid />
    </div>
  );
}
