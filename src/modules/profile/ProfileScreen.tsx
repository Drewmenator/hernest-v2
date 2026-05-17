import React, { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, HeroCard, Pill, Button, Input } from "../../shared/components";
import { saveData, loadData } from "../../core/firebase";
import { signOut, deleteUser } from "firebase/auth";
import { auth } from "../../core/firebase";
import { bus } from "../../core/events";
import { loadMemoryFacts, saveMemoryFacts, type MemoryFact } from "../../core/memory";
import toast from "react-hot-toast";

// ── Types per blueprint ────────────────────────────────────────────
interface Child { id: string; name: string; birthDate?: string; school?: string; allergies?: string[]; interests?: string[]; }
interface Parent { id: string; name: string; relationship: "mother"|"father"|"parent"; birthday?: string; }
interface Priority { rank: number; area: string; why: string; }

const PRIORITY_AREAS = ["Family","Career","Fitness","Travel","Finances","Self-care","Creativity","Community"];
const ENERGY_PATTERNS = [
  { value:"morning", label:"Morning person", emoji:"🌅" },
  { value:"evening", label:"Evening person", emoji:"🌙" },
  { value:"consistent", label:"Consistent",    emoji:"⚡" },
  { value:"variable",   label:"Variable",      emoji:"〰" },
];
const FITNESS_LEVELS = ["Beginner","Intermediate","Advanced"];
const FOCUS_THEMES = [
  { value:"strength", label:"Strength",  emoji:"💪" },
  { value:"calm",     label:"Calm",      emoji:"🕊" },
  { value:"growth",   label:"Growth",    emoji:"🌱" },
  { value:"joy",      label:"Joy",       emoji:"✨" },
  { value:"balance",  label:"Balance",   emoji:"⚖" },
];

const FACT_TYPES = [
  { id:"family",     label:"Family",     emoji:"👨‍👩‍👧", color:T.gold },
  { id:"health",     label:"Health",     emoji:"💊",    color:T.blush },
  { id:"preference", label:"Preference", emoji:"✨",    color:T.lav },
  { id:"goal",       label:"Goal",       emoji:"🎯",    color:T.teal },
  { id:"schedule",   label:"Schedule",   emoji:"📅",    color:T.sky },
  { id:"temporary",  label:"Temporary",  emoji:"⏳",    color:T.taupe },
];

const SECTIONS = ["personal","family","health","goals","memory"] as const;

export function ProfileScreen() {
  const { user, profile, updateProfile, reset } = useStore();
  const [section, setSection] = useState<string>("personal");
  const [saving, setSaving]   = useState(false);

  // Personal
  const [name, setName]             = useState("");
  const [city, setCity]             = useState("");
  const [country, setCountry]       = useState("");
  const [timezone, setTimezone]     = useState("");
  const [phone, setPhone]           = useState("");
  const [focusTheme, setFocusTheme] = useState("");
  const [role, setRole]             = useState("");
  const [challenge, setChallenge]   = useState("");

  // Family
  const [children, setChildren]     = useState<Child[]>([]);
  const [parents, setParents]       = useState<Parent[]>([]);
  const [inlaws, setInlaws]         = useState<Parent[]>([]);
  const [partnerName, setPartnerName] = useState("");
  const [partnerBirthday, setPartnerBirthday] = useState("");

  // Health per blueprint
  const [diet, setDiet]                   = useState<string[]>([]);
  const [fitnessLevel, setFitnessLevel]   = useState("Beginner");
  const [energyPattern, setEnergyPattern] = useState("morning");
  const [sleepGoal, setSleepGoal]         = useState(8);
  const [waterGoal, setWaterGoal]         = useState(8);
  const [allergies, setAllergies]         = useState("");
  const [fitnessGoal, setFitnessGoal]     = useState("");

  // Goals per blueprint
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [activeGoals, setActiveGoals] = useState<string[]>([]);
  const [biggestChallenge, setBiggestChallenge] = useState("");
  const [nextTrip, setNextTrip]     = useState("");
  const [savingsGoal, setSavingsGoal] = useState("");

  // Memory
  const [memories, setMemories]     = useState<MemoryFact[]>([]);
  const [newFact, setNewFact]       = useState("");
  const [factType, setFactType]     = useState<MemoryFact["type"]>("preference");
  const [memFilter, setMemFilter]   = useState("all");

  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "profile").then(d => {
      if (!d) return;
      const p = d as any;
      setName(p.name||""); setCity(p.city||""); setCountry(p.country||"");
      setTimezone(p.timezone||""); setPhone(p.phone||"");
      setFocusTheme(p.focusWordTheme||""); setRole(p.role||""); setChallenge(p.challenge||"");
      setPartnerName(p.partner?.name||"");
      setPartnerBirthday(p.partner?.birthday||"");
      setChildren(p.kids||p.children||[]);
      setParents(p.parents||[]);
      setInlaws(p.inlaws||[]);
      setDiet(p.diet||[]); setFitnessLevel(p.fitnessLevel||"Beginner");
      setEnergyPattern(p.energyPattern||"morning");
      setSleepGoal(p.sleepGoal||8); setWaterGoal(p.waterGoal||8);
      setAllergies(p.allergies?.join(", ")||"");
      setFitnessGoal(p.fitnessGoal||"");
      setPriorities(p.priorities||[]);
      setActiveGoals(p.activeGoals||[]);
      setBiggestChallenge(p.biggestChallenge||p.challenge||"");
      setNextTrip(p.nextTrip||p.tripGoal||"");
      setSavingsGoal(p.savingsGoal||"");
    });
    loadMemoryFacts(user.uid).then(setMemories);
  }, [user?.uid]);

  // ── Save helpers ──────────────────────────────────────────────────
  const buildProfile = () => ({
    uid: user?.uid||"", email: user?.email||"",
    name, city, country, timezone, phone, role, challenge,
    focusWordTheme: focusTheme,
    partner: partnerName ? { name:partnerName, birthday:partnerBirthday||undefined, shareAccess:false, sharedCategories:[] } : undefined,
    children, kids:children, parents, inlaws,
    diet, fitnessLevel, energyPattern, sleepGoal, waterGoal,
    allergies: allergies.split(",").map(a=>a.trim()).filter(Boolean),
    fitnessGoal, priorities, activeGoals, biggestChallenge,
    nextTrip, tripGoal:nextTrip, savingsGoal,
  });

  const save = async () => {
    setSaving(true);
    const updated = buildProfile();
    updateProfile(updated as any);
    if (user?.uid) {
      await saveData(user.uid, "profile", updated);
      await bus.publish("profile.updated", updated, { userId: user.uid, source: "profile" });
    }
    setSaving(false);
    toast.success("Profile saved ✓");
  };

  // ── Memory ────────────────────────────────────────────────────────
  const addFact = async () => {
    if (!newFact.trim() || !user?.uid) return;
    const fact: MemoryFact = {
      id: crypto.randomUUID(), statement: newFact.trim(), type: factType,
      source: "user-stated", confidence: 1.0, createdAt: Date.now(),
      expiresAt: factType==="temporary" ? Date.now() + 7*24*60*60*1000 : undefined,
    };
    const updated = [fact, ...memories];
    setMemories(updated);
    setNewFact("");
    await saveMemoryFacts(user.uid, [fact]);
    await bus.publish("nora.memory.updated", { fact }, { userId: user.uid, source: "profile" });
    toast.success("Nora will remember that ✦");
  };

  const deleteFact = async (id: string) => {
    const updated = memories.filter(f=>f.id!==id);
    setMemories(updated);
    if (user?.uid) await saveData(user.uid, "nora_memory", { facts: updated });
  };

  // ── Family helpers ────────────────────────────────────────────────
  const addChild = () => setChildren(p => [...p, { id:crypto.randomUUID(), name:"", birthDate:"" }]);
  const updateChild = (i: number, field: keyof Child, val: any) =>
    setChildren(p => p.map((c,ci) => ci===i ? { ...c, [field]:val } : c));

  const addParent = (type: "parents"|"inlaws") => {
    const setter = type==="parents" ? setParents : setInlaws;
    setter(p => [...p, { id:crypto.randomUUID(), name:"", relationship:"parent" }]);
  };

  // ── Priority management per blueprint ─────────────────────────────
  const togglePriority = (area: string) => {
    const existing = priorities.find(p=>p.area===area);
    if (existing) {
      setPriorities(p => p.filter(pr=>pr.area!==area));
    } else if (priorities.length < 5) {
      setPriorities(p => [...p, { rank:p.length+1, area, why:"" }]);
    }
  };

  const filteredMemories = memFilter==="all" ? memories : memories.filter(f=>f.type===memFilter);

  // ── Memory pattern summary ────────────────────────────────────────
  const byType = memories.reduce((acc,f) => ({ ...acc, [f.type]:(acc[f.type]||0)+1 }), {} as Record<string,number>);

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="YOUR ACCOUNT" title="Profile"/>

      {/* Avatar + name */}
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20 }}>
        <div style={{ width:64, height:64, borderRadius:"50%", background:`linear-gradient(135deg,${T.gold},#8B6914)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30 }}>👩</div>
        <div>
          <h2 style={{ fontFamily:F.serif, fontSize:22, fontStyle:"italic", color:T.esp, margin:0 }}>{name||"Your name"}</h2>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"2px 0 0" }}>{user?.email}</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:4, marginBottom:16 }}>
        {SECTIONS.map(s=>(
          <button key={s} onClick={()=>setSection(s)} style={{ padding:"8px 14px", borderRadius:20, border:`1.5px solid ${section===s?T.esp:T.linen}`, background:section===s?T.esp:"#fff", color:section===s?"#fff":T.bark, fontFamily:F.sans, fontSize:12, fontWeight:section===s?700:400, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0, touchAction:"manipulation", minHeight:36 }}>
            {s.charAt(0).toUpperCase()+s.slice(1)}
          </button>
        ))}
      </div>

      {/* ── PERSONAL ──────────────────────────────────────────────── */}
      {section==="personal" && <>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>PERSONAL DETAILS</p>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <Input value={name} onChange={setName} placeholder="Your first name"/>
            <Input value={role} onChange={setRole} placeholder="Your role / job title"/>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              <Input value={city} onChange={setCity} placeholder="City"/>
              <Input value={country} onChange={setCountry} placeholder="Country"/>
            </div>
            <Input value={phone} onChange={setPhone} placeholder="Phone (optional)"/>
            <Input value={challenge} onChange={setChallenge} placeholder="Biggest challenge right now"/>
          </div>
        </Card>

        {/* Focus word theme per blueprint */}
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>FOCUS WORD THEME</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 10px" }}>Nora uses this to personalise your morning focus word</p>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {FOCUS_THEMES.map(t=>(
              <button key={t.value} onClick={()=>setFocusTheme(t.value)} style={{ padding:"8px 14px", borderRadius:20, border:`1.5px solid ${focusTheme===t.value?T.gold:T.linen}`, background:focusTheme===t.value?T.goldP:"#fff", color:focusTheme===t.value?T.gold:T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation" }}>
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </Card>

        {/* Priorities per blueprint with ranking */}
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 6px" }}>LIFE PRIORITIES (up to 5)</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 10px" }}>Nora uses this to understand what matters most to you</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
            {PRIORITY_AREAS.map(area=>{
              const isSelected = priorities.some(p=>p.area===area);
              const rank = priorities.find(p=>p.area===area)?.rank;
              return (
                <button key={area} onClick={()=>togglePriority(area)} style={{ padding:"7px 14px", borderRadius:20, border:`1.5px solid ${isSelected?T.esp:T.linen}`, background:isSelected?T.esp:"#fff", color:isSelected?"#fff":T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation", position:"relative" }}>
                  {rank && <span style={{ position:"absolute", top:-6, right:-6, width:16, height:16, borderRadius:"50%", background:T.gold, color:"#fff", fontFamily:F.sans, fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>{rank}</span>}
                  {area}
                </button>
              );
            })}
          </div>
        </Card>

        <Button onClick={save} variant="gold" disabled={saving}>{saving?"Saving...":"Save Personal"}</Button>
      </>}

      {/* ── FAMILY per blueprint full family tree ─────────────────── */}
      {section==="family" && <>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>PARTNER</p>
          <div style={{ display:"flex", gap:8 }}>
            <Input value={partnerName} onChange={setPartnerName} placeholder="Partner's name (optional)" style={{ flex:2 }}/>
            <input type="date" value={partnerBirthday} onChange={e=>setPartnerBirthday(e.target.value)}
              style={{ flex:1, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"10px 12px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none" }}/>
          </div>
        </Card>

        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>CHILDREN</p>
            <button onClick={addChild} style={{ background:T.goldP, border:`1px solid ${T.gold}40`, borderRadius:10, padding:"5px 12px", fontFamily:F.sans, fontSize:11, color:T.gold, cursor:"pointer", minHeight:30 }}>+ Add</button>
          </div>
          {children.map((k,i)=>(
            <div key={k.id} style={{ padding:"12px 0", borderBottom:`1px solid ${T.linen}` }}>
              <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                <span style={{ fontSize:22, flexShrink:0 }}>🧒</span>
                <Input value={k.name} onChange={v=>updateChild(i,"name",v)} placeholder="Name" style={{ flex:2 }}/>
                <input type="date" value={k.birthDate||""} onChange={e=>updateChild(i,"birthDate",e.target.value)} style={{ flex:1, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"10px 8px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", minHeight:44 }}/>
                <button onClick={()=>setChildren(p=>p.filter((_,ci)=>ci!==i))} style={{ background:"none", border:"none", color:T.taupe, cursor:"pointer", fontSize:18, minHeight:44 }}>×</button>
              </div>
              <div style={{ display:"flex", gap:8, paddingLeft:30 }}>
                <Input value={k.school||""} onChange={v=>updateChild(i,"school",v)} placeholder="School (optional)" style={{ flex:1 }}/>
                <Input value={(k.allergies||[]).join(", ")} onChange={v=>updateChild(i,"allergies",v.split(",").map((a:string)=>a.trim()).filter(Boolean))} placeholder="Allergies" style={{ flex:1 }}/>
              </div>
            </div>
          ))}
          {children.length===0 && <p style={{ fontFamily:F.sans, fontSize:13, color:T.taupe }}>No children added yet</p>}
        </Card>

        {/* Parents per blueprint */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>YOUR PARENTS</p>
            <button onClick={()=>addParent("parents")} style={{ background:T.goldP, border:`1px solid ${T.gold}40`, borderRadius:10, padding:"5px 12px", fontFamily:F.sans, fontSize:11, color:T.gold, cursor:"pointer", minHeight:30 }}>+ Add</button>
          </div>
          {parents.map((p,i)=>(
            <div key={p.id} style={{ display:"flex", gap:8, marginBottom:8 }}>
              <span style={{ fontSize:22, flexShrink:0 }}>👩</span>
              <Input value={p.name} onChange={v=>setParents(prev=>prev.map((pa,pi)=>pi===i?{...pa,name:v}:pa))} placeholder="Name" style={{ flex:2 }}/>
              <input type="date" value={p.birthday||""} onChange={e=>setParents(prev=>prev.map((pa,pi)=>pi===i?{...pa,birthday:e.target.value}:pa))} placeholder="Birthday" style={{ flex:1, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"10px 8px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", minHeight:44 }}/>
              <button onClick={()=>setParents(p=>p.filter((_,pi)=>pi!==i))} style={{ background:"none", border:"none", color:T.taupe, cursor:"pointer", fontSize:18, minHeight:44 }}>×</button>
            </div>
          ))}
          {parents.length===0 && <p style={{ fontFamily:F.sans, fontSize:13, color:T.taupe }}>No parents added yet</p>}
        </Card>

        {/* In-laws per blueprint */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>IN-LAWS</p>
            <button onClick={()=>addParent("inlaws")} style={{ background:T.goldP, border:`1px solid ${T.gold}40`, borderRadius:10, padding:"5px 12px", fontFamily:F.sans, fontSize:11, color:T.gold, cursor:"pointer", minHeight:30 }}>+ Add</button>
          </div>
          {inlaws.map((p,i)=>(
            <div key={p.id} style={{ display:"flex", gap:8, marginBottom:8 }}>
              <span style={{ fontSize:22, flexShrink:0 }}>👩</span>
              <Input value={p.name} onChange={v=>setInlaws(prev=>prev.map((pa,pi)=>pi===i?{...pa,name:v}:pa))} placeholder="Name" style={{ flex:2 }}/>
              <input type="date" value={p.birthday||""} onChange={e=>setInlaws(prev=>prev.map((pa,pi)=>pi===i?{...pa,birthday:e.target.value}:pa))} placeholder="Birthday" style={{ flex:1, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"10px 8px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", minHeight:44 }}/>
              <button onClick={()=>setInlaws(p=>p.filter((_,pi)=>pi!==i))} style={{ background:"none", border:"none", color:T.taupe, cursor:"pointer", fontSize:18, minHeight:44 }}>×</button>
            </div>
          ))}
          {inlaws.length===0 && <p style={{ fontFamily:F.sans, fontSize:13, color:T.taupe }}>No in-laws added yet</p>}
        </Card>

        <Button onClick={save} variant="gold" disabled={saving}>{saving?"Saving...":"Save Family"}</Button>
      </>}

      {/* ── HEALTH per blueprint ───────────────────────────────────── */}
      {section==="health" && <>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>ENERGY PATTERN</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {ENERGY_PATTERNS.map(e=>(
              <button key={e.value} onClick={()=>setEnergyPattern(e.value)} style={{ padding:"10px", borderRadius:14, border:`2px solid ${energyPattern===e.value?T.sky:T.linen}`, background:energyPattern===e.value?T.skyP:"#fff", color:energyPattern===e.value?T.sky:T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation", minHeight:48 }}>
                {e.emoji} {e.label}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>FITNESS LEVEL</p>
          <div style={{ display:"flex", gap:6 }}>
            {FITNESS_LEVELS.map(f=>(
              <button key={f} onClick={()=>setFitnessLevel(f)} style={{ flex:1, padding:"10px", borderRadius:12, border:`1.5px solid ${fitnessLevel===f?T.sage:T.linen}`, background:fitnessLevel===f?`${T.sage}15`:"#fff", color:fitnessLevel===f?T.sage:T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation" }}>{f}</button>
            ))}
          </div>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>DAILY GOALS</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
            <div>
              <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 6px" }}>Sleep goal (hours)</p>
              <div style={{ display:"flex", gap:4 }}>
                {[6,7,8,9].map(h=>(
                  <button key={h} onClick={()=>setSleepGoal(h)} style={{ flex:1, padding:"8px", borderRadius:10, border:`1.5px solid ${sleepGoal===h?T.sky:T.linen}`, background:sleepGoal===h?T.skyP:"#fff", color:sleepGoal===h?T.sky:T.bark, fontFamily:F.sans, fontSize:14, fontWeight:700, cursor:"pointer", touchAction:"manipulation" }}>{h}</button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 6px" }}>Water goal (glasses)</p>
              <div style={{ display:"flex", gap:4 }}>
                {[6,8,10,12].map(w=>(
                  <button key={w} onClick={()=>setWaterGoal(w)} style={{ flex:1, padding:"8px", borderRadius:10, border:`1.5px solid ${waterGoal===w?T.sky:T.linen}`, background:waterGoal===w?T.skyP:"#fff", color:waterGoal===w?T.sky:T.bark, fontFamily:F.sans, fontSize:14, fontWeight:700, cursor:"pointer", touchAction:"manipulation" }}>{w}</button>
                ))}
              </div>
            </div>
          </div>
          <Input value={fitnessGoal} onChange={setFitnessGoal} placeholder="Fitness goal (e.g. run 5k, yoga daily)" style={{ marginBottom:8 }}/>
          <Input value={allergies} onChange={setAllergies} placeholder="Allergies / medications (comma separated)"/>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>DIETARY PREFERENCES</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {["Vegetarian","Vegan","Gluten-free","Dairy-free","Halal","Kosher","Pescatarian","No restrictions"].map(d=>(
              <button key={d} onClick={()=>setDiet(p=>p.includes(d)?p.filter(x=>x!==d):[...p,d])} style={{ padding:"7px 12px", borderRadius:20, border:`1.5px solid ${diet.includes(d)?T.sage:T.linen}`, background:diet.includes(d)?`${T.sage}15`:"#fff", color:diet.includes(d)?T.sage:T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation" }}>{d}</button>
            ))}
          </div>
        </Card>

        <Button onClick={save} variant="gold" disabled={saving}>{saving?"Saving...":"Save Health"}</Button>
      </>}

      {/* ── GOALS per blueprint ────────────────────────────────────── */}
      {section==="goals" && <>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>YOUR GOALS</p>
          <Input value={biggestChallenge} onChange={setBiggestChallenge} placeholder="Biggest challenge right now" style={{ marginBottom:8 }}/>
          <Input value={nextTrip} onChange={setNextTrip} placeholder="Next trip goal (e.g. Bali in December)" style={{ marginBottom:8 }}/>
          <Input value={fitnessGoal} onChange={setFitnessGoal} placeholder="Fitness goal" style={{ marginBottom:8 }}/>
          <Input value={savingsGoal} onChange={setSavingsGoal} placeholder="Savings goal (e.g. Emergency fund £10k)"/>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>ACTIVE GOALS</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
            {["Get promoted","Run 5k","Save £5k","Travel more","Read 12 books","Learn to cook","Better sleep","More self-care","Make new friends","Work-life balance"].map(g=>(
              <button key={g} onClick={()=>setActiveGoals(p=>p.includes(g)?p.filter(x=>x!==g):[...p,g])} style={{ padding:"7px 12px", borderRadius:20, border:`1.5px solid ${activeGoals.includes(g)?T.esp:T.linen}`, background:activeGoals.includes(g)?T.esp:"#fff", color:activeGoals.includes(g)?"#fff":T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation" }}>{g}</button>
            ))}
          </div>
        </Card>

        <Button onClick={save} variant="gold" disabled={saving}>{saving?"Saving...":"Save Goals"}</Button>
      </>}

      {/* ── MEMORY per blueprint ───────────────────────────────────── */}
      {section==="memory" && <>
        <HeroCard eyebrow="NORA'S BRAIN" title="What Nora knows" subtitle={`${memories.length} facts · Updated from conversations`} color={T.esp}/>

        {/* Memory type breakdown per blueprint */}
        {memories.length > 0 && (
          <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:4, marginBottom:12 }}>
            {Object.entries(byType).map(([type,count])=>{
              const meta = FACT_TYPES.find(t=>t.id===type);
              return (
                <button key={type} onClick={()=>setMemFilter(memFilter===type?"all":type)} style={{ display:"flex", alignItems:"center", gap:4, padding:"5px 12px", borderRadius:20, flexShrink:0, border:`1.5px solid ${memFilter===type?meta?.color||T.esp:T.linen}`, background:memFilter===type?`${meta?.color||T.esp}15`:"#fff", color:memFilter===type?meta?.color||T.esp:T.taupe, fontFamily:F.sans, fontSize:11, cursor:"pointer" }}>
                  <span>{meta?.emoji}</span><span>{meta?.label} ({count})</span>
                </button>
              );
            })}
          </div>
        )}

        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>TELL NORA SOMETHING</p>
          <Input value={newFact} onChange={setNewFact} placeholder="e.g. Maya is allergic to nuts" style={{ marginBottom:10 }}/>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
            {FACT_TYPES.map(t=>(
              <button key={t.id} onClick={()=>setFactType(t.id as any)} style={{ padding:"5px 12px", borderRadius:20, border:`1.5px solid ${factType===t.id?t.color:T.linen}`, background:factType===t.id?`${t.color}15`:"#fff", color:factType===t.id?t.color:T.bark, fontFamily:F.sans, fontSize:11, cursor:"pointer" }}>
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
          <Button onClick={addFact} disabled={!newFact.trim()} variant="secondary">Tell Nora ✦</Button>
        </Card>

        {filteredMemories.length > 0 && (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>NORA KNOWS ({filteredMemories.length})</p>
            {filteredMemories.map(f=>{
              const meta = FACT_TYPES.find(t=>t.id===f.type);
              const isExpiring = f.expiresAt && f.expiresAt - Date.now() < 24*60*60*1000;
              return (
                <div key={f.id} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"10px 0", borderBottom:`1px solid ${T.linen}` }}>
                  <span style={{ fontSize:18, flexShrink:0 }}>{meta?.emoji}</span>
                  <div style={{ flex:1 }}>
                    <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{f.statement}</p>
                    <p style={{ fontFamily:F.sans, fontSize:10, color:T.taupe, margin:"2px 0 0", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                      {f.source} · {meta?.label}
                      {f.confidence < 1 ? ` · ${Math.round(f.confidence*100)}% confident` : ""}
                      {isExpiring ? " · expiring soon" : ""}
                    </p>
                  </div>
                  <button onClick={()=>deleteFact(f.id)} style={{ background:"none", border:"none", color:T.taupe, cursor:"pointer", fontSize:18, flexShrink:0, minHeight:36 }}>×</button>
                </div>
              );
            })}
          </Card>
        )}

        {memories.length === 0 && (
          <Card><p style={{ fontFamily:F.sans, fontSize:14, color:T.taupe, textAlign:"center", padding:"20px 0", lineHeight:1.6 }}>Nora's memory is empty.<br/>Chat with Nora or add facts above to help her know you better.</p></Card>
        )}
      </>}

      {/* Sign out */}
      <button onClick={async()=>{ await signOut(auth); reset(); }} style={{ width:"100%", padding:"12px", background:"none", border:`1px solid ${T.linen}`, borderRadius:14, fontFamily:F.sans, fontSize:13, color:T.taupe, cursor:"pointer", marginTop:8, minHeight:44 }}>
        Sign out
      </button>
    </div>
  );
}
