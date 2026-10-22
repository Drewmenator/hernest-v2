import React, { useState, useEffect, useRef } from "react";
import { T, F, alpha } from "../../config/theme";
import { useStore } from "../../core/store";
import { openCleo } from "../../shared/utils/openCleo";
import { Card, PageTitle, Pill, AIBadge, Spinner, EmptyState, Emoji } from "../../shared/components";
import { TONE_PROFILES, type AppContext } from "../../core/contextBuilder";
import toast from "react-hot-toast";
import { getWeatherByLocation, type WeatherData } from "../../core/weather";
import { cachedBriefing, generateBriefing, type Briefing } from "./generateBriefing";

// ── Energy level display ───────────────────────────────────────────
const ENERGY_COLORS: Record<string,string> = {
  "high": T.sage, "medium": T.gold, "low": T.sky, "very-low": T.blush
};

const URGENCY_COLORS: Record<string,string> = {
  "critical": T.danger, "high": T.gold, "medium": T.esp, "low": T.taupe
};

// Look for a newer briefing when the app comes back to the front, at most this often.
const RESUME_GAP_MS = 5 * 60 * 1000;

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

  const showCachedOrWrite = async (isAlive: () => boolean) => {
    const cached = await cachedBriefing();
    if (!isAlive()) return;
    if (cached) { setBriefing(cached); setLoading(false); return; }
    generate();
  };

  // ── Generate full cross-module briefing ───────────────────────────
  const generate = async () => {
    if (!user?.uid) { setLoading(false); return; }
    if (!briefing) setLoading(true);

    try {
      const { briefing: parsed, ctx: appCtx } = await generateBriefing({ uid: user.uid, profile, familyMembers, weather });
      setCtx(appCtx);
      setBriefing(parsed);
    } catch(e) {
      console.error("[Briefing] catch error:", e);
      toast.error("Cleo couldn't write your briefing. Tap Prepare my briefing to try again.");
    }
    setLoading(false);
  };

  // Effects call this through a ref so they use the latest weather and briefing.
  const showRef = useRef(showCachedOrWrite);
  useEffect(() => { showRef.current = showCachedOrWrite; });
  const uid = user?.uid;
  const hasProfile = !!profile;

  // Same path as Today: one briefing per day, from the shared cache. A new
  // one is written only when there is none for today (first open of the day,
  // or the cache was cleared because her data changed).
  useEffect(() => {
    if (!uid || !hasProfile) return;
    let alive = true;
    getWeatherByLocation().then(w => { if (alive && w) setWeather(w); });
    showRef.current(() => alive);
    return () => { alive = false; };
  }, [uid, hasProfile]);

  // Coming back to the front (at most every 5 minutes): pick up a briefing
  // Today wrote meanwhile, or write one if the cache was cleared.
  useEffect(() => {
    if (!uid || !hasProfile) return;
    let alive = true;
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < RESUME_GAP_MS) return;
      last = Date.now();
      showRef.current(() => alive);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVisible); };
  }, [uid, hasProfile]);

  // ── Tabs ──────────────────────────────────────────────────────────
  const tabs = [

    ...(ctx?.trips?.isClose && ctx?.trips?.next ? [{ id:"travel", label:<><Emoji e="✈" size={14} /> {ctx.trips.next.dest}</> }] : []),
  ];

  // ── Tone color ────────────────────────────────────────────────────
  const toneColor = ctx ? ctx.toneConfig.color : T.esp;

  // ── Loading state ─────────────────────────────────────────────────
  if (loading && !briefing) {
    return (
      <div style={{ animation: "fadeUp .45s ease both" }}>
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.taupe, margin: "0 0 2px" }}>Your daily briefing</p>
          <p style={{ fontFamily: F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize: 28, color: T.esp, margin: 0 }}>Briefing</p>
        </div>
        <div role="status" style={{ background: T.cleoBg, borderRadius: 24, padding: "40px 24px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 16, background: T.glassStrong, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 22, color: T.action }}><Emoji e="✦" size={22} /></div>
          <p style={{ fontFamily: F.sans, fontWeight: 700, fontSize: 20, color: T.text, margin: "0 0 6px" }}>Cleo is preparing your briefing</p>
          <p style={{ fontFamily: F.sans, fontSize: 15, color: T.text2, margin: "0 0 20px" }}>Reading your week…</p>
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
      <PageTitle eyebrow="Your daily briefing" title={getTimeWindow()==="morning"?"Good Morning":getTimeWindow()==="afternoon"?"Good Afternoon":"Good Evening"}/>
      <EmptyState
        icon={<Emoji e="☀" size={24} />}
        title="No briefing just yet"
        body="Once there's a little of your day for me to read, I'll pull it together into one calm briefing. Tap below and I'll try now"
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
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 2px" }}>Your daily briefing</p>
          <p style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize:28, color:T.esp, margin:0, lineHeight:1.1 }}>Briefing</p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:4 }}>

  
        </div>
      </div>


      {/* ── MORNING TAB ─────────────────────────────────────────── */}


        {/* Focus Word Hero — per blueprint */}
        <div style={{ background:T.cleoBg, borderRadius:24, padding:"28px 24px", marginBottom:16, position:"relative", overflow:"hidden" }}>
          {weather && (
            <div style={{ position:"absolute", top:12, right:16, display:"flex", alignItems:"center", gap:5, background:T.glassStrong, borderRadius:20, padding:"4px 10px", backdropFilter:"blur(4px)" }}>
              <Emoji e={weather.icon} size={18} />
              <span style={{ fontFamily:F.sans, fontSize:12, fontWeight:600, color:T.text }}>{weather.temp}°{weather.unit}</span>
            </div>
          )}
          <div style={{ position:"absolute", top:-20, right:-20, fontSize:120, opacity:0.06, lineHeight:1 }}><Emoji e={briefing.focusWord?.emoji} size={110} strokeWidth={1.2} /></div>
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.action, margin:"0 0 8px" }}>Today's focus</p>
          <div style={{ display:"flex", alignItems:"baseline", gap:12, marginBottom:8 }}>
            <span style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize:44, color:T.text, lineHeight:1, }}>{briefing.focusWord?.word}</span>
            <span style={{ fontSize:32 }}>{briefing.focusWord?.emoji}</span>
          </div>
          <p style={{ fontFamily:F.sans, fontSize:15, color:T.text2, margin:"0 0 16px", lineHeight:1.5 }}>{briefing.focusWord?.why}</p>
          <p style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize:16, color:T.text, margin:0, lineHeight:1.5 }}>{briefing.greeting}</p>
        </div>

        {/* Priorities — per blueprint spec */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:0 }}>Priorities</p>
            <AIBadge label="Cross-module"/>
          </div>
          {(briefing.priorities||[]).map((p,i)=>(
            <div key={i} style={{ display:"flex", gap:12, padding:"12px 0", borderBottom:i<(briefing.priorities.length-1)?`1px solid ${T.linen}`:"none" }}>
              <div style={{ width:28, height:28, borderRadius:8, background:`${alpha(URGENCY_COLORS[p.urgency]||T.gold, 0.08)}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <span style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontSize:15, fontWeight:700, color:URGENCY_COLORS[p.urgency]||T.gold }}>{p.rank}</span>
              </div>
              <div style={{ flex:1 }}>
                <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:"0 0 2px", lineHeight:1.4 }}>{p.text}</p>
                <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:0 }}>
                  <Emoji e={SOURCE_EMOJIS[p.source]||"◦"} size={13} /> {p.whyToday}
                  {p.estimatedMinutes ? ` · ${p.estimatedMinutes}m` : ""}
                </p>
              </div>
              {p.urgency==="critical" && (
                <span style={{ background:alpha(T.danger, 0.08), color:T.danger, fontFamily:F.sans, fontSize: 14, fontWeight: 600, padding:"3px 7px", borderRadius:10, alignSelf:"flex-start", flexShrink:0 }}>urgent</span>
              )}
            </div>
          ))}
        </Card>

        {/* Calendar section */}
        {briefing.calendar?.highlights?.length > 0 && (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 12px" }}>
              TODAY'S CALENDAR {ctx?.calendar.density==="heavy"||ctx?.calendar.density==="extreme" ? `· ${ctx.calendar.density.toUpperCase()}` : ""}
            </p>
            {briefing.calendar.densityNote && (
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.blush, margin:"0 0 10px" }}>{briefing.calendar.densityNote}</p>
            )}
            {briefing.calendar.highlights.map((h,i)=>(
              <div key={i} style={{ display:"flex", gap:12, padding:"8px 0", borderBottom:i<briefing.calendar.highlights.length-1?`1px solid ${T.linen}`:"none" }}>
                <span style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, width:50, flexShrink:0, paddingTop:2 }}>{h.time||"All day"}</span>
                <span style={{ fontSize:16, flexShrink:0 }}>{h.icon}</span>
                <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{h.title}</p>
              </div>
            ))}
            {briefing.calendar.conflicts?.map((c,i)=>(
              <div key={i} style={{ background:`${alpha(T.blush, 0.06)}`, borderRadius:10, padding:"8px 12px", marginTop:8 }}>
                <p style={{ fontFamily:F.sans, fontSize:12, color:T.blush, margin:0 }}><Emoji e="⚡" size={13} /> Conflict: {c}</p>
              </div>
            ))}
          </Card>
        )}

        {/* Tasks insight */}
        {(briefing.tasks?.aiSuggestion || briefing.tasks?.completionNote) && (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 10px" }}>Tasks</p>
            {briefing.tasks.aiSuggestion && (
              <div style={{ display:"flex", gap:10, marginBottom:briefing.tasks.completionNote?10:0 }}>
                <span style={{ color:T.gold, flexShrink:0 }}><Emoji e="✦" size={13} /></span>
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
            <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 10px" }}>Bills</p>
            <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0, lineHeight:1.5 }}>{briefing.bills.message}</p>
          </Card>
        )}

        {/* Trip section — per blueprint */}
        {briefing.trips && ctx?.trips.next && (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.gold, margin:"0 0 10px" }}><Emoji e="✈" size={14} /> {ctx.trips.next.dest.toUpperCase()} · {ctx.trips.next.daysUntil} DAYS</p>
            <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:"0 0 8px", lineHeight:1.5 }}>{briefing.trips.statusMessage}</p>
            {briefing.trips.urgentActions?.filter(a=>a).map((a,i)=>(
              <div key={i} style={{ display:"flex", gap:10, padding:"5px 0" }}>
                <span style={{ color:T.gold, flexShrink:0 }}>◦</span>
                <p style={{ fontFamily:F.sans, fontSize:12, color:T.esp, margin:0 }}>{a}</p>
              </div>
            ))}
            {briefing.trips.packingStatus && (
              <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"8px 0 0" }}><Emoji e="🧳" size={13} /> {briefing.trips.packingStatus}</p>
            )}
            <p style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize:14, color:T.gold, margin:"10px 0 0" }}>{briefing.trips.excitementNote}</p>
          </Card>
        )}

        {/* Circle reminders — per blueprint */}
        {(briefing.circle?.checkinMessage || briefing.circle?.birthdayAlert) && (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 10px" }}>Circle</p>
            {briefing.circle.birthdayAlert && (
              <div style={{ display:"flex", gap:10, marginBottom:8 }}>
                <span style={{ flexShrink:0 }}><Emoji e="🎂" size={18} /></span>
                <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{briefing.circle.birthdayAlert}</p>
              </div>
            )}
            {briefing.circle.checkinMessage && (
              <div style={{ display:"flex", gap:10 }}>
                <span style={{ flexShrink:0 }}><Emoji e="💌" size={18} /></span>
                <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{briefing.circle.checkinMessage}</p>
              </div>
            )}
          </Card>
        )}

        {/* Energy section — per blueprint spec */}
        {briefing.energy && (
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:0 }}>Energy forecast</p>
              <span style={{ background:`${alpha(ENERGY_COLORS[briefing.energy.predictedLevel]||T.gold, 0.13)}`, color:ENERGY_COLORS[briefing.energy.predictedLevel]||T.gold, fontFamily:F.sans, fontSize: 14, fontWeight: 600, padding:"3px 8px", borderRadius:10 }}>
                {briefing.energy.predictedLevel}
              </span>
            </div>
            <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"0 0 8px" }}>{briefing.energy.predictionBasis}</p>
            <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:"0 0 6px", lineHeight:1.5 }}>{briefing.energy.tip}</p>
            <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0, lineHeight:1.5 }}>{briefing.energy.scheduleSuggestion}</p>
          </Card>
        )}

        {/* Affirmation — per blueprint, themed by tone */}
        {briefing.affirmation && (
          <div style={{ background:`linear-gradient(135deg,${alpha(toneColor, 0.13)},${alpha(T.esp, 0.03)})`, border:`1px solid ${alpha(toneColor, 0.19)}`, borderRadius:20, padding:"20px 20px", marginBottom:12 }}>
            <p style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize:18, color:T.esp, margin:"0 0 8px", lineHeight:1.7 }}>{briefing.affirmation.text}</p>
            <p style={{ fontFamily:F.sans, fontSize: 14, color:toneColor, margin:0, fontWeight: 600 }}>— Cleo · {briefing.affirmation.theme}</p>
          </div>
        )}

        {/* Questions go to the Cleo tab (one chat, with its memory). */}
        <Card>
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 10px" }}>Ask cleo</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {["What should I tackle first?","Which bills are due soon?","What's urgent?"].map(q=>(
              <button key={q} onClick={()=>openCleo(q)} style={{ padding:"8px 12px", borderRadius:20, border:`1px solid ${T.linen}`, background:T.surface, fontFamily:F.sans, fontSize:12, color:T.bark, cursor:"pointer", touchAction:"manipulation", minHeight:36 }}>{q}</button>
            ))}
            <button onClick={()=>openCleo()} style={{ padding:"8px 12px", borderRadius:20, border:"none", background:toneColor, fontFamily:F.sans, fontSize:12, fontWeight:700, color:T.onAction, cursor:"pointer", touchAction:"manipulation", minHeight:36 }}>Open Cleo →</button>
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
