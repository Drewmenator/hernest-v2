import React, { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { currencySymbol, getCurrency } from "../../shared/utils/money";
import { useStore } from "../../core/store";
import { Card, PageTitle, Button, Input } from "../../shared/components";
import { saveData, loadData } from "../../core/firebase";
import { bus } from "../../core/events";
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

const SECTIONS = ["personal","health","goals","memory"] as const;

export function ProfileScreen() {
  const { user, updateProfile, setActiveTab } = useStore();
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

  // Family — edited in "Your family" now; kept here only so saving the
  // profile doesn't wipe these older fields (other features still read them).
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

  // ── Priority management per blueprint ─────────────────────────────
  const togglePriority = (area: string) => {
    const existing = priorities.find(p=>p.area===area);
    if (existing) {
      setPriorities(p => p.filter(pr=>pr.area!==area));
    } else if (priorities.length < 5) {
      setPriorities(p => [...p, { rank:p.length+1, area, why:"" }]);
    }
  };

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="Your account" title="Profile"/>

      {/* Avatar + name */}
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20 }}>
        <div style={{ width:64, height:64, borderRadius:"50%", background:`linear-gradient(135deg,${T.gold},#5E4A8C)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30 }}>👩</div>
        <div>
          <h2 style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize:22, color:T.esp, margin:0 }}>{name||"Your name"}</h2>
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
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 12px" }}>Personal details</p>
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
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 12px" }}>Focus word theme</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 10px" }}>Cleo uses this to personalize your morning focus word</p>
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
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 6px" }}>LIFE PRIORITIES (up to 5)</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 10px" }}>Cleo uses this to understand what matters most to you</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
            {PRIORITY_AREAS.map(area=>{
              const isSelected = priorities.some(p=>p.area===area);
              const rank = priorities.find(p=>p.area===area)?.rank;
              return (
                <button key={area} onClick={()=>togglePriority(area)} style={{ padding:"7px 14px", borderRadius:20, border:`1.5px solid ${isSelected?T.esp:T.linen}`, background:isSelected?T.esp:"#fff", color:isSelected?"#fff":T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation", position:"relative" }}>
                  {rank && <span style={{ position:"absolute", top:-6, right:-6, width:16, height:16, borderRadius:"50%", background:T.gold, color:"#fff", fontFamily:F.sans, fontSize: 12, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>{rank}</span>}
                  {area}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Family people live in one place now */}
        <Card>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontSize:22 }}>💛</span>
            <div style={{ flex:1 }}>
              <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:700, color:T.esp, margin:0 }}>Your family</p>
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"2px 0 0" }}>Partner, kids, grandparents and friends, with birthdays and school details</p>
            </div>
            <button onClick={()=>setActiveTab("family")} style={{ background:T.goldP, border:`1px solid ${T.gold}40`, borderRadius:10, padding:"8px 12px", fontFamily:F.sans, fontSize:12, color:T.gold, cursor:"pointer", minHeight:36, flexShrink:0 }}>Open ›</button>
          </div>
        </Card>

        <Button onClick={save} variant="gold" disabled={saving}>{saving?"Saving...":"Save Personal"}</Button>
      </>}

      {/* ── HEALTH per blueprint ───────────────────────────────────── */}
      {section==="health" && <>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 12px" }}>Energy pattern</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {ENERGY_PATTERNS.map(e=>(
              <button key={e.value} onClick={()=>setEnergyPattern(e.value)} style={{ padding:"10px", borderRadius:14, border:`2px solid ${energyPattern===e.value?T.sky:T.linen}`, background:energyPattern===e.value?T.skyP:"#fff", color:energyPattern===e.value?T.sky:T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation", minHeight:48 }}>
                {e.emoji} {e.label}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 12px" }}>Fitness level</p>
          <div style={{ display:"flex", gap:6 }}>
            {FITNESS_LEVELS.map(f=>(
              <button key={f} onClick={()=>setFitnessLevel(f)} style={{ flex:1, padding:"10px", borderRadius:12, border:`1.5px solid ${fitnessLevel===f?T.sage:T.linen}`, background:fitnessLevel===f?`${T.sage}15`:"#fff", color:fitnessLevel===f?T.sage:T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation" }}>{f}</button>
            ))}
          </div>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 12px" }}>Daily goals</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
            <div>
              <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"0 0 6px" }}>Sleep goal (hours)</p>
              <div style={{ display:"flex", gap:4 }}>
                {[6,7,8,9].map(h=>(
                  <button key={h} onClick={()=>setSleepGoal(h)} style={{ flex:1, padding:"8px", borderRadius:10, border:`1.5px solid ${sleepGoal===h?T.sky:T.linen}`, background:sleepGoal===h?T.skyP:"#fff", color:sleepGoal===h?T.sky:T.bark, fontFamily:F.sans, fontSize:14, fontWeight:700, cursor:"pointer", touchAction:"manipulation" }}>{h}</button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"0 0 6px" }}>Water goal (glasses)</p>
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
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 12px" }}>Dietary preferences</p>
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
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 12px" }}>Your goals</p>
          <Input value={biggestChallenge} onChange={setBiggestChallenge} placeholder="Biggest challenge right now" style={{ marginBottom:8 }}/>
          <Input value={nextTrip} onChange={setNextTrip} placeholder="Next trip goal (e.g. Bali in December)" style={{ marginBottom:8 }}/>
          <Input value={fitnessGoal} onChange={setFitnessGoal} placeholder="Fitness goal" style={{ marginBottom:8 }}/>
          <Input value={savingsGoal} onChange={setSavingsGoal} placeholder={`Savings goal (e.g. Emergency fund ${currencySymbol(getCurrency())}10k)`}/>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 12px" }}>Active goals</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
            {["Get promoted","Run 5k",`Save ${currencySymbol(getCurrency())}5k`,"Travel more","Read 12 books","Learn to cook","Better sleep","More self-care","Make new friends","Work-life balance"].map(g=>(
              <button key={g} onClick={()=>setActiveGoals(p=>p.includes(g)?p.filter(x=>x!==g):[...p,g])} style={{ padding:"7px 12px", borderRadius:20, border:`1.5px solid ${activeGoals.includes(g)?T.esp:T.linen}`, background:activeGoals.includes(g)?T.esp:"#fff", color:activeGoals.includes(g)?"#fff":T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation" }}>{g}</button>
            ))}
          </div>
        </Card>

        <Button onClick={save} variant="gold" disabled={saving}>{saving?"Saving...":"Save Goals"}</Button>
      </>}

      {/* ── MEMORY: one place to manage it now (What Cleo knows) ─────── */}
      {section==="memory" && (
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:14, color:T.bark, margin:"0 0 12px", lineHeight:1.6 }}>
            Everything Cleo remembers is in one place now: see it, add to it, or ask her to forget something.
          </p>
          <Button onClick={() => setActiveTab("memory")} variant="secondary">Open What Cleo knows</Button>
        </Card>
      )}

      {/* Sign out */}
      <button onClick={async()=>{ const { signOutCompletely } = await import("../../core/signOut"); await signOutCompletely(); }} style={{ width:"100%", padding:"12px", background:"none", border:`1px solid ${T.linen}`, borderRadius:14, fontFamily:F.sans, fontSize:13, color:T.taupe, cursor:"pointer", marginTop:8, minHeight:44 }}>
        Sign out
      </button>
    </div>
  );
}
