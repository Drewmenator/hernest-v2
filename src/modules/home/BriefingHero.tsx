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
import { onEnterSpace } from "../../shared/utils/a11y";

// ── Briefing Hero Card (unchanged) ────────────────────────────────
const getWindow = () => {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return { id:"morning",   label:"YOUR MORNING",   greeting:"Good morning",   icon:"☀" };
  if (h >= 12 && h < 17) return { id:"afternoon", label:"AFTERNOON CHECK", greeting:"Good afternoon", icon:"◦" };
  return { id:"evening", label:"EVENING WIND-DOWN", greeting:"Good evening", icon:"✦" };
};

export function BriefingHero({ onExpand }: { onExpand: () => void }) {
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
    <div onClick={onExpand} role="button" tabIndex={0} onKeyDown={onEnterSpace} aria-label="Generate your briefing" style={{ background: `linear-gradient(135deg,${T.esp},#3D2E22)`, borderRadius: 20, padding: "20px", marginBottom: 12, cursor: "pointer" }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: "0 0 6px" }}>{getWindow().label}</p>
      <p style={{ fontFamily: F.serif, fontSize: 22, fontStyle: "italic", color: "#fff", margin: "0 0 4px" }}>{getWindow().icon} {getWindow().greeting}</p>
      <p style={{ fontFamily: F.sans, fontSize: 12, color: "rgba(255,255,255,0.5)", margin: 0 }}>Tap to generate your {getWindow().id} briefing →</p>
    </div>
  );

  return (
    <div role="button" tabIndex={0} onKeyDown={onEnterSpace} aria-label={expanded ? "Collapse briefing" : "Expand full briefing"} style={{ background: `linear-gradient(135deg,${T.esp},#3D2E22)`, borderRadius: 20, padding: "20px", marginBottom: 12, cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
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

