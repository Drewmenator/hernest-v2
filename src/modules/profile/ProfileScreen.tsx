import React, { useState, useEffect } from "react";
import { T, F, S, TYPE, alpha } from "../../config/theme";
import { currencySymbol, getCurrency } from "../../shared/utils/money";
import { useStore } from "../../core/store";
import { Card, PageTitle, ListRow, Button, Input, Pill, Segmented, GlowCard, Headline, Detail, Emoji } from "../../shared/components";
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
    toast.success("Profile saved");
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

  const label = (t: string, hint?: string) => (
    <div style={{ marginBottom: S.md }}>
      <p style={{ fontFamily:F.sans, fontSize:TYPE.card, fontWeight:600, color:T.text, margin:0 }}>{t}</p>
      {hint && <p style={{ fontFamily:F.sans, fontSize:TYPE.support, color:T.text2, margin:"2px 0 0", lineHeight:1.4 }}>{hint}</p>}
    </div>
  );
  const chips: React.CSSProperties = { display:"flex", flexWrap:"wrap", gap:S.sm };
  const saveBtn = (text: string) => (
    <Button onClick={save} variant="primary" disabled={saving}>{saving ? "Saving..." : text}</Button>
  );

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="Your account" title="Profile"/>

      {/* Avatar + name */}
      <GlowCard tint="personal" style={{ marginBottom: S.lg }}>
        <div style={{ display:"flex", alignItems:"center", gap:S.lg }}>
          <div style={{ width:64, height:64, flexShrink:0, borderRadius:"50%", background:`linear-gradient(135deg,${T.action},${T.actionPress})`, display:"flex", alignItems:"center", justifyContent:"center", color:T.onAction }}>
            {name.trim()
              ? <span aria-hidden="true" style={{ fontFamily:F.display, fontSize:28, fontWeight:500, color:T.onAction }}>{name.trim().charAt(0).toUpperCase()}</span>
              : <Emoji e="👩" size={30} color={T.onAction} />}
          </div>
          <div style={{ minWidth:0 }}>
            <Headline size={26}>{name||"Your name"}</Headline>
            <Detail style={{ overflowWrap:"anywhere" }}>{user?.email}</Detail>
          </div>
        </div>
      </GlowCard>

      {/* Sections */}
      <Segmented label="Profile sections" value={section} onChange={setSection}
        options={SECTIONS.map(s => ({ id: s, label: s.charAt(0).toUpperCase()+s.slice(1) }))} />

      {/* ── PERSONAL ──────────────────────────────────────────────── */}
      {section==="personal" && <>
        <Card>
          {label("Personal details")}
          <div style={{ display:"flex", flexDirection:"column", gap:S.md }}>
            <Input label="First name" value={name} onChange={setName} placeholder="Your first name"/>
            <Input label="Role or job title" value={role} onChange={setRole} placeholder="Your role / job title"/>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:S.md }}>
              <Input label="City" value={city} onChange={setCity} placeholder="City"/>
              <Input label="Country" value={country} onChange={setCountry} placeholder="Country"/>
            </div>
            <Input label="Phone, optional" value={phone} onChange={setPhone} placeholder="Phone (optional)"/>
            <Input label="Biggest challenge right now" value={challenge} onChange={setChallenge} placeholder="Biggest challenge right now"/>
          </div>
        </Card>

        {/* Focus word theme per blueprint */}
        <Card>
          {label("Focus word theme", "Cleo uses this to personalize your morning focus word")}
          <div style={chips}>
            {FOCUS_THEMES.map(t=>(
              <Pill key={t.value} label={t.label} active={focusTheme===t.value} onClick={()=>setFocusTheme(t.value)} />
            ))}
          </div>
        </Card>

        {/* Priorities per blueprint with ranking */}
        <Card>
          {label("Life priorities, up to 5", "Cleo uses this to understand what matters most to you")}
          <div style={chips}>
            {PRIORITY_AREAS.map(area=>{
              const rank = priorities.find(p=>p.area===area)?.rank;
              return (
                <span key={area} style={{ position:"relative", display:"inline-flex" }}>
                  <Pill label={area} active={priorities.some(p=>p.area===area)} onClick={()=>togglePriority(area)} />
                  {rank && <span aria-hidden="true" style={{ position:"absolute", top:-6, right:-4, minWidth:18, height:18, borderRadius:9, background:T.surface, color:T.action, border:`1.5px solid ${T.action}`, fontFamily:F.sans, fontSize:TYPE.meta, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, pointerEvents:"none" }}>{rank}</span>}
                </span>
              );
            })}
          </div>
        </Card>

        {/* Family people live in one place now */}
        <Card>
          <ListRow divider={false}
            leading={<Emoji e="💛" tile size={18} />}
            title="Your family"
            detail="Partner, kids, grandparents and friends, with birthdays and school details"
            trailing={<Button size="sm" variant="gentle" onClick={()=>setActiveTab("family")} style={{ width:"auto", flexShrink:0 }}>Open</Button>} />
        </Card>

        {saveBtn("Save personal")}
      </>}

      {/* ── HEALTH per blueprint ───────────────────────────────────── */}
      {section==="health" && <>
        <Card>
          {label("Energy pattern")}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:S.sm }}>
            {ENERGY_PATTERNS.map(e=>{
              const on = energyPattern===e.value;
              return (
                <button key={e.value} onClick={()=>setEnergyPattern(e.value)} aria-pressed={on} style={{ padding:"10px", borderRadius:14, border:`1.5px solid ${on?T.action:T.divider}`, background:on?alpha(T.action, 0.12):T.surface, color:on?T.action:T.text, fontFamily:F.sans, fontSize:TYPE.support, fontWeight:on?600:500, cursor:"pointer", touchAction:"manipulation", minHeight:48, display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                  <Emoji e={e.emoji} size={16} /> {e.label}
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          {label("Fitness level")}
          <div style={chips}>
            {FITNESS_LEVELS.map(f=>(
              <Pill key={f} label={f} active={fitnessLevel===f} onClick={()=>setFitnessLevel(f)} />
            ))}
          </div>
        </Card>

        <Card>
          {label("Daily goals")}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:S.md, marginBottom:S.lg }}>
            <div>
              <p style={{ fontFamily:F.sans, fontSize:TYPE.support, fontWeight:600, color:T.text, margin:`0 0 ${S.sm}px` }}>Sleep goal, hours</p>
              <div style={{ display:"flex", gap:S.xs }}>
                {[6,7,8,9].map(h=>(
                  <button key={h} onClick={()=>setSleepGoal(h)} aria-pressed={sleepGoal===h} style={{ flex:1, minHeight:44, padding:"8px 0", borderRadius:10, border:`1.5px solid ${sleepGoal===h?T.action:T.divider}`, background:sleepGoal===h?T.action:T.surface, color:sleepGoal===h?T.onAction:T.text, fontFamily:F.sans, fontSize:TYPE.body, fontWeight:600, cursor:"pointer", touchAction:"manipulation" }}>{h}</button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontFamily:F.sans, fontSize:TYPE.support, fontWeight:600, color:T.text, margin:`0 0 ${S.sm}px` }}>Water goal, glasses</p>
              <div style={{ display:"flex", gap:S.xs }}>
                {[6,8,10,12].map(w=>(
                  <button key={w} onClick={()=>setWaterGoal(w)} aria-pressed={waterGoal===w} style={{ flex:1, minHeight:44, padding:"8px 0", borderRadius:10, border:`1.5px solid ${waterGoal===w?T.action:T.divider}`, background:waterGoal===w?T.action:T.surface, color:waterGoal===w?T.onAction:T.text, fontFamily:F.sans, fontSize:TYPE.body, fontWeight:600, cursor:"pointer", touchAction:"manipulation" }}>{w}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:S.md }}>
            <Input label="Fitness goal" value={fitnessGoal} onChange={setFitnessGoal} placeholder="Fitness goal (e.g. run 5k, yoga daily)"/>
            <Input label="Allergies and medications, separated by commas" value={allergies} onChange={setAllergies} placeholder="Allergies / medications (comma separated)"/>
          </div>
        </Card>

        <Card>
          {label("Dietary preferences")}
          <div style={chips}>
            {["Vegetarian","Vegan","Gluten-free","Dairy-free","Halal","Kosher","Pescatarian","No restrictions"].map(d=>(
              <Pill key={d} label={d} active={diet.includes(d)} onClick={()=>setDiet(p=>p.includes(d)?p.filter(x=>x!==d):[...p,d])} />
            ))}
          </div>
        </Card>

        {saveBtn("Save health")}
      </>}

      {/* ── GOALS per blueprint ────────────────────────────────────── */}
      {section==="goals" && <>
        <Card>
          {label("Your goals")}
          <div style={{ display:"flex", flexDirection:"column", gap:S.md }}>
            <Input label="Biggest challenge right now" value={biggestChallenge} onChange={setBiggestChallenge} placeholder="Biggest challenge right now"/>
            <Input label="Next trip goal" value={nextTrip} onChange={setNextTrip} placeholder="Next trip goal (e.g. Bali in December)"/>
            <Input label="Fitness goal" value={fitnessGoal} onChange={setFitnessGoal} placeholder="Fitness goal"/>
            <Input label="Savings goal" value={savingsGoal} onChange={setSavingsGoal} placeholder={`Savings goal (e.g. Emergency fund ${currencySymbol(getCurrency())}10k)`}/>
          </div>
        </Card>

        <Card>
          {label("Active goals")}
          <div style={chips}>
            {["Get promoted","Run 5k",`Save ${currencySymbol(getCurrency())}5k`,"Travel more","Read 12 books","Learn to cook","Better sleep","More self-care","Make new friends","Work-life balance"].map(g=>(
              <Pill key={g} label={g} active={activeGoals.includes(g)} onClick={()=>setActiveGoals(p=>p.includes(g)?p.filter(x=>x!==g):[...p,g])} />
            ))}
          </div>
        </Card>

        {saveBtn("Save goals")}
      </>}

      {/* ── MEMORY: one place to manage it now (What Cleo knows) ─────── */}
      {section==="memory" && (
        <Card>
          <ListRow divider={false}
            leading={<Emoji e="🧠" tile size={18} />}
            title="What Cleo knows"
            detail="Everything Cleo remembers is in one place now: see it, add to it, or ask her to forget something." />
          <div style={{ marginTop: S.md }}>
            <Button onClick={() => setActiveTab("memory")} variant="secondary">Open What Cleo knows</Button>
          </div>
        </Card>
      )}

      {/* Sign out */}
      <Button variant="secondary" style={{ marginTop: S.sm }} onClick={async()=>{ const { signOutCompletely } = await import("../../core/signOut"); await signOutCompletely(); }}>
        Sign out
      </Button>
    </div>
  );
}
