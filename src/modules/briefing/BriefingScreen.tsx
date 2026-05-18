import React, { useState, useEffect, useRef } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, Pill, AIBadge, Spinner } from "../../shared/components";
import { ai } from "../../core/ai";
import { db as localDb } from "../../core/db";
import { buildAppContext, buildBriefingPrompt, selectFocusWord, TONE_PROFILES, type AppContext } from "../../core/contextBuilder";
import toast from "react-hot-toast";
import { trackEvent } from "../../core/analytics";
import { getWeatherByLocation, type WeatherData } from "../../core/weather";

// ── Types per blueprint spec ───────────────────────────────────────
interface Briefing {
  focusWord:    { word: string; emoji: string; why: string };
  greeting:     string;
  priorities:   { rank: number; text: string; emoji: string; source: string; urgency: string; whyToday: string; estimatedMinutes?: number }[];
  calendar:     { highlights: { time: string; title: string; icon: string }[]; densityNote?: string; conflicts?: string[] };
  tasks:        { aiSuggestion: string; completionNote: string };
  budget:       { status: string; keyMessage: string; forecastMessage: string; categoryAlert?: string; savingsUpdate?: string };
  trips?:       { statusMessage: string; urgentActions: string[]; excitementNote: string; packingStatus?: string };
  circle:       { checkinMessage?: string; birthdayAlert?: string; communityNote?: string };
  energy:       { predictedLevel: string; predictionBasis: string; tip: string; scheduleSuggestion: string };
  affirmation:  { text: string; theme: string };
  travelBrief?: { urgentActions: string[]; packingTip: string; weatherHint: string; kidsTip?: string; excitement: string };
}

// ── Energy level display ───────────────────────────────────────────
const ENERGY_COLORS: Record<string,string> = {
  "high": T.sage, "medium": T.gold, "low": T.sky, "very-low": T.blush
};

const URGENCY_COLORS: Record<string,string> = {
  "critical": "#dc2626", "high": T.gold, "medium": T.esp, "low": T.taupe
};

const SOURCE_EMOJIS: Record<string,string> = {
  task:"✓", calendar:"◈", school:"◆", budget:"◎", trip:"→", circle:"✦", health:"◦"
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
  const [askInput, setAskInput] = useState("");
  const [askResp, setAskResp]   = useState("");
  const [asking, setAsking]     = useState(false);
  const [sunLoading, setSunLoading] = useState(false);
  const [weather, setWeather] = useState<WeatherData|null>(null);
  const [travelLoading, setTravelLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasFetched = React.useRef(false);
  useEffect(() => {
    if (!user?.uid || !profile || hasFetched.current) return;
    hasFetched.current = true;
    generate();
    getWeatherByLocation().then(w => { if (w) setWeather(w); });
  }, [user?.uid, profile?.name]);

  // ── Generate full cross-module briefing ───────────────────────────
  const generate = async () => {
    if (!user?.uid) { setLoading(false); return; }
    // Reset hasFetched so manual retry always works
    hasFetched.current = false;
    if (!briefing) setLoading(true);

    try {
      const appCtx = await buildAppContext(user.uid, profile as any).catch(() => ({} as any));
      setCtx(appCtx);
      const window = getTimeWindow();
      const weatherStr = weather ? `Current weather: ${weather.temp}°${weather.unit} ${weather.condition} ${weather.icon}, feels like ${weather.feelsLike}°${weather.unit}, humidity ${weather.humidity}%, wind ${weather.windSpeed}mph.` : "";
      const windowPrompt = window === "morning"
        ? "Generate a warm, energizing morning briefing. Focus on today\'s priorities, schedule, and what matters most today."
        : window === "afternoon"
        ? "Generate a midday check-in briefing. Focus on progress made, what\'s still pending, energy levels, and afternoon priorities."
        : "Generate a gentle evening wind-down briefing. Focus on what was accomplished today, tomorrow\'s prep, family time, and self-care.";
      const contextStr = appCtx ? `${buildBriefingPrompt(appCtx)}\n\nTime of day: ${window}. ${windowPrompt}` : windowPrompt;
      const focusData  = selectFocusWord(appCtx.tone);

      const familyRoster = familyMembers.length > 0
        ? "Family: " + familyMembers.map(m => `${m.name} (${m.role}${m.age ? ", age " + m.age : ""}${m.notes ? ", " + m.notes : ""})` ).join("; ")
        : "";

      const date = new Date().toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });

      const sys = `You are Nora, ${appCtx?.name || profile?.name || "her"}'s AI chief of staff inside HerNest.
Generate her Morning Briefing as a warm, intelligent, SPECIFIC summary.

${familyRoster ? familyRoster + "\n" : ""}TONE: ${appCtx?.tone || "steady"} (${appCtx?.toneConfig?.label || "Steady"})
RULES:
- Be SPECIFIC — use real names, amounts, dates from the data
- Be CONCISE — every word earns its place
- Be WARM — this is the first thing she reads
- Be ACTIONABLE — every priority needs a clear next step
- NEVER invent facts not in the data
- If tone is tired/struggling: reduce demands, increase compassion
- If tone is thriving: energise and celebrate

Return ONLY valid JSON:
{
  "focusWord": {"word":"${focusData.word}","emoji":"${focusData.emoji}","why":"one personal sentence why this word today"},
  "greeting": "warm personal greeting using her name and today ${date}",
  "priorities": [{"rank":1,"text":"specific action","emoji":"emoji","source":"task|calendar|school|budget|trip|circle","urgency":"critical|high|medium|low","whyToday":"why now","estimatedMinutes":5}],
  "calendar": {"highlights":[{"time":"","title":"","icon":""}],"densityNote":"optional note if heavy","conflicts":[]},
  "tasks": {"aiSuggestion":"one specific task suggestion","completionNote":"encouraging note on completion rate"},
  "budget": {"status":"healthy|watch|warning|critical","keyMessage":"specific message with numbers","forecastMessage":"month end forecast","categoryAlert":"optional","savingsUpdate":"optional"},
  "trips": {"statusMessage":"","urgentActions":[""],"excitementNote":"","packingStatus":""},
  "circle": {"checkinMessage":"optional","birthdayAlert":"optional","communityNote":"optional"},
  "energy": {"predictedLevel":"high|medium|low|very-low","predictionBasis":"based on X sleep + Y mood","tip":"specific energy tip","scheduleSuggestion":"when to tackle what"},
  "affirmation": {"text":"warm personal affirmation","theme":"${appCtx.toneConfig.affirmationTheme}"},
  "travelBrief": ${appCtx?.trips?.isClose ? '{"urgentActions":[""],"packingTip":"","weatherHint":"","kidsTip":"","excitement":""}' : 'null'}
}
Return exactly 5 priorities. Include trips/travelBrief only if data exists.`;

      const result = await ai(sys, contextStr, "morning_briefing");
      if (result.error) { console.error("[Briefing] AI error:", result.error); setLoading(false); return; }

      const rawText = result.text;
        const jsonStart = rawText.indexOf("{");
        const jsonEnd = rawText.lastIndexOf("}");
        if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON in briefing response");
        const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1)) as Briefing;
        if (!parsed.priorities) parsed.priorities = [];
        if (!parsed.calendar) parsed.calendar = { highlights: [] };
        if (!parsed.tasks) parsed.tasks = { aiSuggestion: "", completionNote: "" };
        if (!parsed.budget) parsed.budget = { status: "healthy", keyMessage: "", forecastMessage: "" };
        if (!parsed.energy) parsed.energy = { predictedLevel: "medium", predictionBasis: "", tip: "", scheduleSuggestion: "" };
        if (!parsed.affirmation) parsed.affirmation = { text: "", theme: "" };
        if (!parsed.circle) parsed.circle = {};
        if (!parsed.focusWord) parsed.focusWord = { word: "Today", emoji: "✦", why: "Focus on what matters most." };
        if (!parsed.greeting) parsed.greeting = "Good morning.";
      setBriefing(parsed);
      trackEvent("briefing_generated");
      await localDb.cacheBriefing(parsed as any);


    } catch(e) {
      console.error("[Briefing] catch error:", e);
      toast.error("Briefing failed — tap ↻ to retry");
    }
    setLoading(false);
  };

  // ── Ask Nora ──────────────────────────────────────────────────────
  const askNora = async () => {
    if (!askInput.trim() || asking) return;
    setAsking(true);
    const ctxStr = ctx ? `Today's tone: ${ctx.tone}. Focus: ${briefing?.focusWord?.word}. Tasks: ${ctx.tasks.total} pending. Budget: ${ctx.budget?.status}.` : "";
    const result = await ai(`You are Nora. ${ctxStr} Answer in 2-3 warm, specific sentences. Never generic.`, askInput, "briefing_ask");
    if (!result.error) setAskResp(result.text);
    setAsking(false);
  };

  // ── Tabs ──────────────────────────────────────────────────────────
  const tabs = [

    ...(ctx?.trips?.isClose && ctx?.trips?.next ? [{ id:"travel", label:`✈ ${ctx.trips.next.dest}` }] : []),
  ];

  // ── Tone color ────────────────────────────────────────────────────
  const toneColor = ctx ? ctx.toneConfig.color : T.esp;

  // ── Loading skeleton ──────────────────────────────────────────────
  if (loading && !briefing) return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="YOUR DAILY BRIEFING" title={getTimeWindow()==="morning"?"Good Morning":getTimeWindow()==="afternoon"?"Good Afternoon":"Good Evening"}/>
      <div style={{ background:`linear-gradient(135deg,${T.esp},#3D2E22)`, borderRadius:24, padding:"24px 20px", marginBottom:16, textAlign:"center" }}>
        <div style={{ fontFamily:F.serif, fontSize:48, color:T.gold, lineHeight:1, marginBottom:12 }}>✦</div>
        <p style={{ fontFamily:F.sans, fontSize:13, color:"rgba(255,255,255,0.6)", fontStyle:"italic" }}>Nora is reading your week...</p>
        <div style={{ marginTop:16 }}><Spinner size={20} color="rgba(255,255,255,0.4)"/></div>
      </div>
      {[1,2,3].map(i=>(
        <div key={i} style={{ background:T.ivory, borderRadius:20, padding:"20px", border:`1px solid ${T.linen}`, marginBottom:10, animation:"breathe 2s ease-in-out infinite" }}>
          <div style={{ background:T.linen, borderRadius:8, height:11, width:`${50+i*15}%`, marginBottom:8 }}/>
          <div style={{ background:T.linen, borderRadius:8, height:9, width:"75%" }}/>
        </div>
      ))}
    </div>
  );

  if (!briefing) return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="YOUR DAILY BRIEFING" title={getTimeWindow()==="morning"?"Good Morning":getTimeWindow()==="afternoon"?"Good Afternoon":"Good Evening"}/>
      <div style={{ background:T.ivory, borderRadius:24, padding:"32px 24px", textAlign:"center", border:`1px solid ${T.linen}` }}>
        <p style={{ fontFamily:F.serif, fontSize:20, fontStyle:"italic", color:T.esp, margin:"0 0 8px" }}>
  {getTimeWindow()==="morning"?"Good morning ✦":getTimeWindow()==="afternoon"?"Good afternoon ✦":"Good evening ✦"}
</p>
        <p style={{ fontFamily:F.sans, fontSize:13, color:T.taupe, margin:"0 0 20px" }}>Nora couldn't prepare your briefing. She's probably still waking up.</p>
        <button onClick={generate} style={{ background:T.esp, color:"#fff", border:"none", borderRadius:14, padding:"12px 24px", fontFamily:F.sans, fontSize:14, fontWeight:600, cursor:"pointer", minHeight:48 }}>Try Again</button>
      </div>
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

        {/* Budget pulse — per blueprint */}
        {briefing.budget && (
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>BUDGET PULSE</p>
              <span style={{ background:briefing.budget.status==="critical"?"#dc262615":briefing.budget.status==="warning"?`${T.gold}20`:`${T.sage}20`, color:briefing.budget.status==="critical"?"#dc2626":briefing.budget.status==="warning"?T.gold:T.sage, fontFamily:F.sans, fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:10, textTransform:"uppercase" }}>
                {briefing.budget.status}
              </span>
            </div>
            <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:"0 0 6px", lineHeight:1.5 }}>{briefing.budget.keyMessage}</p>
            <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0, lineHeight:1.5 }}>{briefing.budget.forecastMessage}</p>
            {briefing.budget.categoryAlert && (
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.blush, margin:"8px 0 0", padding:"8px 12px", background:`${T.blush}10`, borderRadius:10 }}>⚠ {briefing.budget.categoryAlert}</p>
            )}
            {briefing.budget.savingsUpdate && (
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.sage, margin:"8px 0 0" }}>✦ {briefing.budget.savingsUpdate}</p>
            )}
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
            <p style={{ fontFamily:F.sans, fontSize:10, color:toneColor, margin:0, textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>— Nora · {briefing.affirmation.theme}</p>
          </div>
        )}

        {/* Ask Nora */}
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 10px" }}>ASK NORA</p>
          {askResp && (
            <div style={{ background:T.sand, borderRadius:12, padding:"12px 14px", marginBottom:10, border:`1px solid ${T.linen}` }}>
              <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0, lineHeight:1.6 }}>{askResp}</p>
            </div>
          )}
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
            {["What should I tackle first?","How's my budget?","What's urgent?"].map(q=>(
              <button key={q} onClick={()=>setAskInput(q)} style={{ padding:"5px 10px", borderRadius:20, border:`1px solid ${T.linen}`, background:"#fff", fontFamily:F.sans, fontSize:11, color:T.bark, cursor:"pointer", touchAction:"manipulation" }}>{q}</button>
            ))}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <input value={askInput} onChange={e=>setAskInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&askNora()} placeholder="Ask Nora anything about your day..." style={{ flex:1, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"11px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", minHeight:44 }}/>
            <button onClick={askNora} disabled={!askInput.trim()||asking} style={{ width:44, height:44, borderRadius:12, background:askInput.trim()?toneColor:T.linen, border:"none", color:"#fff", fontSize:16, cursor:askInput.trim()?"pointer":"not-allowed", flexShrink:0, touchAction:"manipulation" }}>
              {asking?<Spinner size={14} color="#fff"/>:"→"}
            </button>
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
