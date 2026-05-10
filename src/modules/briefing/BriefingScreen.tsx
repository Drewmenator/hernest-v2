import React, { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, HeroCard, Pill, AIBadge, Spinner } from "../../shared/components";
import { ai, aiJSON } from "../../core/ai";
import { db as localDb } from "../../core/db";

export function BriefingScreen() {
  const { user, profile } = useStore();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("morning");

  const generate = async () => {
    if (!data) setLoading(true);
    const name = profile?.name || "lovely";
    const sys = `You are Nora inside HerNest. Return ONLY valid JSON:
{"greeting":"","date":"","weatherNote":"","priorities":[{"text":"","tag":""}],"reminders":[""],"affirmation":"","focusWord":"","energyTip":""}
5 priorities, 3 reminders. Be warm and specific.`;
    const ctx = `Name: ${name}. Challenge: ${profile?.challenge||"mental load"}. Kids: ${profile?.kids?.map((k:any)=>k.name).join(",")||"none"}.`;
    const result = await aiJSON(sys, ctx, "morning_briefing", null);
    if (result) { setData(result); await localDb.cacheBriefing(result); }
    setLoading(false);
  };

  useEffect(() => {
    localDb.getTodayBriefing().then(cached => {
      if (cached && !cached.stale) { setData(cached.data); return; }
      generate();
    }).catch(() => generate());
  }, []);

  if (loading && !data) return (
    <div style={{animation:"fadeUp .45s ease both"}}>
      <PageTitle eyebrow="YOUR MORNING" title="Briefing"/>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {[1,2,3].map(i=><div key={i} style={{background:T.ivory,borderRadius:20,padding:"20px",border:`1px solid ${T.linen}`,animation:"breathe 2s ease-in-out infinite"}}><div style={{background:T.linen,borderRadius:8,height:12,width:`${60+i*15}%`,marginBottom:8}}/><div style={{background:T.linen,borderRadius:8,height:10,width:"80%"}}/></div>)}
      </div>
      <p style={{fontFamily:F.sans,fontSize:12,color:T.taupe,textAlign:"center",marginTop:16,fontStyle:"italic"}}>Nora is preparing your morning... ✦</p>
    </div>
  );

  return (
    <div style={{animation:"fadeUp .45s ease both"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <PageTitle eyebrow="YOUR MORNING" title="Briefing"/>
        <button onClick={generate} style={{background:"none",border:`1px solid ${T.linen}`,borderRadius:10,padding:"6px 12px",fontFamily:F.sans,fontSize:11,color:T.taupe,cursor:"pointer"}}>↻ Refresh</button>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {["morning","sunday"].map(t=><Pill key={t} label={t==="morning"?"☀ Morning":"🌿 Sunday Reset"} active={tab===t} onClick={()=>setTab(t)}/>)}
      </div>
      {data && <>
        <HeroCard eyebrow={data.date} title={data.greeting} subtitle={data.weatherNote}>
          <div style={{marginTop:12,display:"inline-flex",alignItems:"center",gap:6,background:"rgba(255,255,255,.15)",borderRadius:20,padding:"4px 12px"}}>
            <span style={{fontFamily:F.sans,fontSize:10,color:"rgba(255,255,255,.7)",letterSpacing:"0.1em",textTransform:"uppercase"}}>Focus word</span>
            <span style={{fontFamily:F.serif,fontSize:18,color:"#fff",fontStyle:"italic"}}>{data.focusWord}</span>
          </div>
        </HeroCard>
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <p style={{fontFamily:F.sans,fontSize:11,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:T.taupe,margin:0}}>PRIORITIES</p>
            <AIBadge/>
          </div>
          {data.priorities?.map((p:any,i:number)=>(
            <div key={i} style={{display:"flex",gap:12,padding:"8px 0",borderBottom:i<data.priorities.length-1?`1px solid ${T.linen}`:"none"}}>
              <span style={{fontFamily:F.serif,fontSize:18,color:T.gold,flexShrink:0}}>{i+1}</span>
              <div>
                <p style={{fontFamily:F.sans,fontSize:13,color:T.esp,margin:0}}>{p.text}</p>
                <span style={{fontFamily:F.sans,fontSize:10,color:T.taupe,textTransform:"uppercase",letterSpacing:"0.08em"}}>{p.tag}</span>
              </div>
            </div>
          ))}
        </Card>
        <Card>
          <p style={{fontFamily:F.sans,fontSize:11,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:T.taupe,margin:"0 0 10px"}}>REMINDERS</p>
          {data.reminders?.map((r:string,i:number)=>(
            <div key={i} style={{display:"flex",gap:10,padding:"6px 0"}}>
              <span style={{color:T.gold,flexShrink:0}}>◦</span>
              <p style={{fontFamily:F.sans,fontSize:13,color:T.esp,margin:0}}>{r}</p>
            </div>
          ))}
        </Card>
        <div style={{background:`linear-gradient(135deg,${T.gold}15,${T.esp}08)`,border:`1px solid ${T.gold}30`,borderRadius:16,padding:"16px 18px"}}>
          <p style={{fontFamily:F.serif,fontSize:16,fontStyle:"italic",color:T.esp,margin:0,lineHeight:1.6}}>{data.affirmation}</p>
        </div>
      </>}
    </div>
  );
}