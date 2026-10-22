import React, { useState, useEffect, useRef } from "react";
import { T, F } from "../../config/theme";
import { useStore, openCleo } from "../../core/store";
import { Card, PageTitle, Pill, AIBadge, Spinner, EmptyState } from "../../shared/components";
import { db as localDb } from "../../core/db";
import { TONE_PROFILES, type AppContext } from "../../core/contextBuilder";
import toast from "react-hot-toast";
import { getWeatherByLocation, type WeatherData } from "../../core/weather";
import { generateBriefing, type Briefing } from "./generateBriefing";

// ── Energy level display ───────────────────────────────────────────
const ENERGY_COLORS: Record<string,string> = {
  "high": T.sage, "medium": T.gold, "low": T.sky, "very-low": T.blush
};

const URGENCY_COLORS: Record<string,string> = {
  "critical": "#dc2626", "high": T.gold, "medium": T.esp, "low": T.taupe
};

const SOURCE_EMOJIS: Record<string,string> = {
  task:"✓", calendar:"◈", school:"◆", budget:"◎", bills:"◎", trip:"→", circle:"✦", health:"◦"
};

export function BriefingScreen() {
  const { user, profile, familyMembers } = useStore();
  const [ctx, setCtx]           = useState<AppContext|null>(null);
  const [briefing, setBriefing] = useState<Briefing|null>(null);
  const [loading, setLoading]   = useState(false);
  const getTimeWindow = () => {
    const h = new Date().getHours();
    if (h >= 6 && h < 12) return "morning";
    if (h >= 12 && h < 17) return "afternoon";
    return "evening";
  };
  const [tab, setTab] = useState(getTimeWindow());
  const [sunLoading, setSunLoading] = useState(false);
  const [weather, setWeather] = useState<WeatherData|null>(null);
  const [travelLoading, setTravelLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasFetched = React.useRef(false);
  useEffect(() => {
    if (!user?.uid || !profile || hasFetched.current) return;
    hasFetched.current = true;
    getWeatherByLocation().then(w => { if (w) setWeather(w); });

    // Check cache — only generate if stale (3 windows per day)
    const checkCacheAndGenerate = async () => {
      try {
        const cached = await localDb.getTodayBriefing();
        if (cached?.data && cached?.generatedAt) {
          const now = new Date();
          const cachedAt = new Date(cached.generatedAt);
          const currentWindow = getTimeWindow();
          const cachedHour = cachedAt.getHours();
          const cachedWindow =
            cachedHour >= 6 && cachedHour < 12 ? "morning" :
            cachedHour >= 12 && cachedHour < 17 ? "afternoon" : "evening";
          const sameDay = cachedAt.toDateString() === now.toDateString();
          if (sameDay && cachedWindow === currentWindow) {
            setBriefing(cached.data as unknown as Briefing);
            setLoading(false);
            return;
          }
        }
      } catch (e) { console.warn("[Briefing] cache check failed:", e); }
      generate();
    };
    checkCacheAndGenerate();
  }, [user?.uid, profile?.name]);

  // ── Generate full cross-module briefing ───────────────────────────
  const generate = async () => {
    if (!user?.uid) { setLoading(false); return; }
    // Reset hasFetched so manual retry always works
    hasFetched.current = false;
    if (!briefing) setLoading(true);

    try {
      const { briefing: parsed, ctx: appCtx } = await generateBriefing({ uid: user.uid, profile, familyMembers, weather });
      setCtx(appCtx);
      setBriefing(parsed);


    } catch(e) {
      console.error("[Briefing] catch error:", e);
      toast.error("Briefing failed — tap ↻ to retry");
    }
    setLoading(false);
  };

  // ── Tabs ──────────────────────────────────────────────────────────
  const tabs = [

    ...(ctx?.trips?.isClose && ctx?.trips?.next ? [{ id:"travel", label:`✈ ${ctx.trips.next.dest}` }] : []),
  ];

  // ── Tone color ────────────────────────────────────────────────────
  const toneColor = ctx ? ctx.toneConfig.color : T.esp;

  // ── Loading state ─────────────────────────────────────────────────
  if (loading && !briefing) {
    return (
      <div style={{ animation: "fadeUp .45s ease both" }}>
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: T.taupe, margin: "0 0 2px" }}>YOUR DAILY BRIEFING</p>
          <p style={{ fontFamily: F.serif, fontSize: 28, fontStyle: "italic", color: T.esp, margin: 0 }}>Briefing</p>
        </div>
        <div style={{ background: `linear-gradient(135deg,${T.esp},#3D2E22)`, borderRadius: 24, padding: "48px 24px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: `${T.gold}25`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 22 }}>✦</div>
          <p style={{ fontFamily: F.serif, fontSize: 20, fontStyle: "italic", color: "#fff", margin: "0 0 8px" }}>Cleo is preparing your briefing</p>
          <p style={{ fontFamily: F.sans, fontSize: 13, color: "rgba(255,255,255,0.5)", margin: "0 0 24px" }}>Reading your week...</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: T.gold, opacity: 0.6, animation: `breathe 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!briefing) return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="YOUR DAILY BRIEFING" title={getTimeWindow()==="morning"?"Good Morning":getTimeWindow()==="afternoon"?"Good Afternoon":"Good Evening"}/>
      <EmptyState
        icon="☀"
        title="No briefing just yet"
        body="Once there's a little of your day for me to read, I'll pull it together into one calm briefing. Tap below and I'll try now ✦"
        actionLabel="Prepare my briefing"
        onAction={generate}
      />
    </div>
  );

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
        <div>
          <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, letterSpacing:"0.16em", textTransform:"uppercase", color:T.taupe, margin:"0 0 2px" }}>YOUR DAILY BRIEFING</p>
          <p style={{ fontFamily:F.serif, fontSize:28, fontStyle:"italic", color:T.esp, margin:0, lineHeight:1.1 }}>Briefing</p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:4 }}>

  
        </div>
      </div>


      {/* ── MORNING TAB ─────────────────────────────────────────── */}


        {/* Focus Word Hero — per blueprint */}
        <div style={{ background:`linear-gradient(135deg,${toneColor},${T.esp})`, borderRadius:24, padding:"28px 24px", marginBottom:16, position:"relative", overflow:"hidden" }}>
          {weather && (
            <div style={{ position:"absolute", top:12, right:16, display:"flex", alignItems:"center", gap:5, background:"rgba(255,255,255,0.15)", borderRadius:20, padding:"4px 10px", backdropFilter:"blur(4px)" }}>
              <span style={{ fontSize:16 }}>{weather.icon}</span>
              <span style={{ fontFamily:F.sans, fontSize:12, fontWeight:600, color:"#fff" }}>{weather.temp}°{weather.unit}</span>
            </div>
          )}
          <div style={{ position:"absolute", top:-20, right:-20, fontSize:120, opacity:0.06, lineHeight:1 }}>{briefing.focusWord?.emoji}</div>
          <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, letterSpacing:"0.16em", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", margin:"0 0 8px" }}>TODAY'S FOCUS</p>
          <div style={{ display:"flex", alignItems:"baseline", gap:12, marginBottom:8 }}>
            <span style={{ fontFamily:F.serif, fontSize:52, color:"#fff", lineHeight:1, fontStyle:"italic" }}>{briefing.focusWord?.word}</span>
            <span style={{ fontSize:32 }}>{briefing.focusWord?.emoji}</span>
          </div>
          <p style={{ fontFamily:F.sans, fontSize:13, color:"rgba(255,255,255,0.75)", margin:"0 0 16px", lineHeight:1.5 }}>{briefing.focusWord?.why}</p>
          <p style={{ fontFamily:F.serif, fontSize:16, color:"rgba(255,255,255,0.9)", fontStyle:"italic", margin:0, lineHeight:1.5 }}>{briefing.greeting}</p>
        </div>

        {/* Priorities — per blueprint spec */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>PRIORITIES</p>
            <AIBadge label="Cross-module"/>
          </div>
          {(briefing.priorities||[]).map((p,i)=>(
            <div key={i} style={{ display:"flex", gap:12, padding:"12px 0", borderBottom:i<(briefing.priorities.length-1)?`1px solid ${T.linen}`:"none" }}>
              <div style={{ width:28, height:28, borderRadius:8, background:`${URGENCY_COLORS[p.urgency]||T.gold}15`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <span style={{ fontFamily:F.serif, fontSize:15, fontWeight:700, color:URGENCY_COLORS[p.urgency]||T.gold }}>{p.rank}</span>
              </div>
              <div style={{ flex:1 }}>
                <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:"0 0 2px", lineHeight:1.4 }}>{p.text}</p>
                <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:0 }}>
                  {SOURCE_EMOJIS[p.source]||"◦"} {p.whyToday}
                  {p.estimatedMinutes ? ` · ${p.estimatedMinutes}m` : ""}
                </p>
              </div>
              {p.urgency==="critical" && (
                <span style={{ background:"#dc262615", color:"#dc2626", fontFamily:F.sans, fontSize:9, fontWeight:700, padding:"3px 7px", borderRadius:10, textTransform:"uppercase", letterSpacing:"0.08em", alignSelf:"flex-start", flexShrink:0 }}>urgent</span>
              )}
            </div>
          ))}
        </Card>

        {/* Calendar section */}
        {briefing.calendar?.highlights?.length > 0 && (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>
              TODAY'S CALENDAR {ctx?.calendar.density==="heavy"||ctx?.calendar.density==="extreme" ? `· ${ctx.calendar.density.toUpperCase()}` : ""}
            </p>
            {briefing.calendar.densityNote && (
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.blush, margin:"0 0 10px" }}>{briefing.calendar.densityNote}</p>
            )}
            {briefing.calendar.highlights.map((h,i)=>(
              <div key={i} style={{ display:"flex", gap:12, padding:"8px 0", borderBottom:i<briefing.calendar.highlights.length-1?`1px solid ${T.linen}`:"none" }}>
                <span style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, width:50, flexShrink:0, paddingTop:2 }}>{h.time||"All day"}</span>
                <span style={{ fontSize:16, flexShrink:0 }}>{h.icon}</span>
                <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{h.title}</p>
              </div>
            ))}
            {briefing.calendar.conflicts?.map((c,i)=>(
              <div key={i} style={{ background:`${T.blush}10`, borderRadius:10, padding:"8px 12px", marginTop:8 }}>
                <p style={{ fontFamily:F.sans, fontSize:12, color:T.blush, margin:0 }}>⚡ Conflict: {c}</p>
              </div>
            ))}
          </Card>
        )}

        {/* Tasks insight */}
        {(briefing.tasks?.aiSuggestion || briefing.tasks?.completionNote) && (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 10px" }}>TASKS</p>
            {briefing.tasks.aiSuggestion && (
              <div style={{ display:"flex", gap:10, marginBottom:briefing.tasks.completionNote?10:0 }}>
                <span style={{ color:T.gold, flexShrink:0 }}>✦</span>
                <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0, lineHeight:1.5 }}>{briefing.tasks.aiSuggestion}</p>
              </div>
            )}
            {briefing.tasks.completionNote && (
              <div style={{ display:"flex", gap:10 }}>
                <span style={{ color:T.sage, flexShrink:0 }}>✓</span>
                <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0, lineHeight:1.5 }}>{briefing.tasks.completionNote}</p>
              </div>
            )}
          </Card>
        )}

        {/* Bills (replaced the Budget pulse, Oct 2026) */}
        {briefing.bills?.message && (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 10px" }}>BILLS</p>
            <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0, lineHeight:1.5 }}>{briefing.bills.message}</p>
          </Card>
        )}

        {/* Trip section — per blueprint */}
        {briefing.trips && ctx?.trips.next && (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.gold, margin:"0 0 10px" }}>✈ {ctx.trips.next.dest.toUpperCase()} · {ctx.trips.next.daysUntil} DAYS</p>
            <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:"0 0 8px", lineHeight:1.5 }}>{briefing.trips.statusMessage}</p>
            {briefing.trips.urgentActions?.filter(a=>a).map((a,i)=>(
              <div key={i} style={{ display:"flex", gap:10, padding:"5px 0" }}>
                <span style={{ color:T.gold, flexShrink:0 }}>◦</span>
                <p style={{ fontFamily:F.sans, fontSize:12, color:T.esp, margin:0 }}>{a}</p>
              </div>
            ))}
            {briefing.trips.packingStatus && (
              <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"8px 0 0" }}>🧳 {briefing.trips.packingStatus}</p>
            )}
            <p style={{ fontFamily:F.serif, fontSize:14, fontStyle:"italic", color:T.gold, margin:"10px 0 0" }}>{briefing.trips.excitementNote}</p>
          </Card>
        )}

        {/* Circle reminders — per blueprint */}
        {(briefing.circle?.checkinMessage || briefing.circle?.birthdayAlert) && (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 10px" }}>CIRCLE</p>
            {briefing.circle.birthdayAlert && (
              <div style={{ display:"flex", gap:10, marginBottom:8 }}>
                <span style={{ flexShrink:0 }}>🎂</span>
                <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{briefing.circle.birthdayAlert}</p>
              </div>
            )}
            {briefing.circle.checkinMessage && (
              <div style={{ display:"flex", gap:10 }}>
                <span style={{ flexShrink:0 }}>💌</span>
                <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{briefing.circle.checkinMessage}</p>
              </div>
            )}
          </Card>
        )}

        {/* Energy section — per blueprint spec */}
        {briefing.energy && (
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>ENERGY FORECAST</p>
              <span style={{ background:`${ENERGY_COLORS[briefing.energy.predictedLevel]||T.gold}20`, color:ENERGY_COLORS[briefing.energy.predictedLevel]||T.gold, fontFamily:F.sans, fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:10, textTransform:"uppercase" }}>
                {briefing.energy.predictedLevel}
              </span>
            </div>
            <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 8px" }}>{briefing.energy.predictionBasis}</p>
            <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:"0 0 6px", lineHeight:1.5 }}>{briefing.energy.tip}</p>
            <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0, lineHeight:1.5 }}>{briefing.energy.scheduleSuggestion}</p>
          </Card>
        )}

        {/* Affirmation — per blueprint, themed by tone */}
        {briefing.affirmation && (
          <div style={{ background:`linear-gradient(135deg,${toneColor}20,${T.esp}08)`, border:`1px solid ${toneColor}30`, borderRadius:20, padding:"20px 20px", marginBottom:12 }}>
            <p style={{ fontFamily:F.serif, fontSize:18, fontStyle:"italic", color:T.esp, margin:"0 0 8px", lineHeight:1.7 }}>{briefing.affirmation.text}</p>
            <p style={{ fontFamily:F.sans, fontSize:10, color:toneColor, margin:0, textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>— Cleo · {briefing.affirmation.theme}</p>
          </div>
        )}

        {/* Questions go to the Cleo tab (one chat, with its memory). */}
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 10px" }}>ASK CLEO</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {["What should I tackle first?","Which bills are due soon?","What's urgent?"].map(q=>(
              <button key={q} onClick={()=>openCleo(q)} style={{ padding:"8px 12px", borderRadius:20, border:`1px solid ${T.linen}`, background:"#fff", fontFamily:F.sans, fontSize:12, color:T.bark, cursor:"pointer", touchAction:"manipulation", minHeight:36 }}>{q}</button>
            ))}
            <button onClick={()=>openCleo()} style={{ padding:"8px 12px", borderRadius:20, border:"none", background:toneColor, fontFamily:F.sans, fontSize:12, fontWeight:700, color:"#fff", cursor:"pointer", touchAction:"manipulation", minHeight:36 }}>Open Cleo →</button>
          </div>
        </Card>


      {/* ── SUNDAY RESET TAB ──────────────────────────────────────── */}
      {(true) && (
        <>
      </>
      )}
      <div ref={bottomRef}/>
    </div>
  );
}
