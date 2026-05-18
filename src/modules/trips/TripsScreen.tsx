import React, { useState, useEffect } from "react";
import { trackEvent } from "../../core/analytics";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, HeroCard, Pill, Button, Input, AIBadge, Spinner, ProgressBar } from "../../shared/components";
import { saveData, loadData } from "../../core/firebase";
import { ai } from "../../core/ai";
import { bus } from "../../core/events";
import toast from "react-hot-toast";

// ── Types per blueprint ────────────────────────────────────────────
interface Traveller { name: string; age: number; type: "adult"|"child"|"infant"; }
interface BudgetBreakdown { flights: number; accommodation: number; food: number; activities: number; transport: number; contingency: number; }
interface Activity { time: string; title: string; type: string; location: string; duration: number; cost: number; bookingRequired: boolean; mumMoment?: string; }
interface ItineraryDay { day: number; date: string; theme: string; morning?: string; afternoon?: string; evening?: string; tip?: string; mumMoment?: string; activities?: any[]; meals?: { breakfast?: string; lunch?: string; dinner?: string }; tips?: string[]; }
interface PackingItem { name: string; quantity: number; essential: boolean; checked: boolean; custom: boolean; weatherDependent?: boolean; }
interface PackingSection { name: string; items: PackingItem[]; }
interface PreDepartureTask { task: string; deadline: string; completed: boolean; category: "booking"|"document"|"health"|"packing"|"home"|"notification"; }
interface Document { type: "passport"|"visa"|"insurance"|"booking"|"health"; status: "needed"|"ready"|"expired"; notes?: string; }

interface Trip {
  id: string; destination: string; country: string;
  departureDate: string; returnDate?: string; nights: number;
  travellers: Traveller[];
  budget: { total: number; currency: string; breakdown: BudgetBreakdown };
  status: "planning"|"booked"|"ready"|"departed"|"completed";
  itinerary: ItineraryDay[];
  packingList: PackingSection[];
  preDeparture: PreDepartureTask[];
  documents: Document[];
  createdAt: number;
}

const safeDate = (date: string) => { try { const d = new Date(date); return isNaN(d.getTime()) ? new Date() : d; } catch { return new Date(); } };
const DAYS_UNTIL = (date: string) => { try { return Math.ceil((safeDate(date).getTime() - Date.now()) / (1000*60*60*24)); } catch { return 0; } };

const PRE_DEPARTURE_TASKS = (nights: number): Omit<PreDepartureTask,"completed">[] => [
  { task:"Check passport expiry dates",       deadline:"60-days", category:"document" },
  { task:"Book flights & accommodation",       deadline:"90-days", category:"booking" },
  { task:"Arrange travel insurance",           deadline:"30-days", category:"document" },
  { task:"Check visa requirements",            deadline:"60-days", category:"document" },
  { task:"Notify bank of travel",              deadline:"7-days",  category:"notification" },
  { task:"Arrange pet / house care",           deadline:"14-days", category:"home" },
  { task:"Download offline maps",              deadline:"3-days",  category:"packing" },
  { task:"Pack snacks for journey",            deadline:"1-day",   category:"packing" },
  { task:"Charge all devices",                 deadline:"1-day",   category:"packing" },
  { task:"Online check-in",                    deadline:"1-day",   category:"booking" },
];

function resolveDeadline(departure: string, deadline: string): string {
  const dep = new Date(departure);
  const days = parseInt(deadline);
  dep.setDate(dep.getDate() - days);
  return dep.toISOString().split("T")[0];
}

function estimateBudgetBreakdown(total: number): BudgetBreakdown {
  return {
    flights:       Math.round(total * 0.25),
    accommodation: Math.round(total * 0.30),
    food:          Math.round(total * 0.20),
    activities:    Math.round(total * 0.15),
    transport:     Math.round(total * 0.05),
    contingency:   Math.round(total * 0.05),
  };
}


// ── Expandable Day Card ───────────────────────────────────────────
function ExpandableDay({ day, currency }: { day: any; currency: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ marginBottom: 8 }}>
      <div onClick={() => setOpen(!open)} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 16px", background:T.ivory, borderRadius: open ? "16px 16px 0 0" : 16, border:`1.5px solid ${open ? T.gold : T.linen}`, cursor:"pointer" }}>
        <div>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.gold, margin:0 }}>DAY {day.day} · {day.theme}</p>
          <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"2px 0 0" }}>{safeDate(day.date).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</p>
        </div>
        <span style={{ color:T.taupe, fontSize:16 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ background:"#fff", border:`1.5px solid ${T.gold}`, borderTop:"none", borderRadius:"0 0 16px 16px", padding:"14px 16px" }}>
          {day.morning && (
            <div style={{ display:"flex", gap:12, padding:"8px 0", borderBottom:`1px solid ${T.linen}` }}>
              <span style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, color:T.sky, width:72, flexShrink:0, paddingTop:2 }}>MORNING</span>
              <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0, lineHeight:1.5 }}>{day.morning}</p>
            </div>
          )}
          {day.afternoon && (
            <div style={{ display:"flex", gap:12, padding:"8px 0", borderBottom:`1px solid ${T.linen}` }}>
              <span style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, color:T.gold, width:72, flexShrink:0, paddingTop:2 }}>AFTERNOON</span>
              <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0, lineHeight:1.5 }}>{day.afternoon}</p>
            </div>
          )}
          {day.evening && (
            <div style={{ display:"flex", gap:12, padding:"8px 0", borderBottom:`1px solid ${T.linen}` }}>
              <span style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, color:T.esp, width:72, flexShrink:0, paddingTop:2 }}>EVENING</span>
              <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0, lineHeight:1.5 }}>{day.evening}</p>
            </div>
          )}
          {day.mumMoment && (
            <div style={{ background:`${T.gold}10`, borderRadius:10, padding:"10px 12px", marginTop:8 }}>
              <p style={{ fontFamily:F.serif, fontSize:13, fontStyle:"italic", color:T.gold, margin:0 }}>✦ Mum Moment: {day.mumMoment}</p>
            </div>
          )}
          {day.tip && (
            <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"8px 0 0", fontStyle:"italic" }}>💡 {day.tip}</p>
          )}
        </div>
      )}
    </div>
  );
}


// ── Country list ──────────────────────────────────────────────────
const COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Argentina","Armenia","Australia","Austria","Azerbaijan",
  "Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia",
  "Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada",
  "Cape Verde","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica","Croatia",
  "Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Dominican Republic","Ecuador","Egypt","El Salvador","Estonia",
  "Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece",
  "Guatemala","Guinea","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq",
  "Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kosovo","Kuwait",
  "Kyrgyzstan","Laos","Latvia","Lebanon","Libya","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia",
  "Maldives","Mali","Malta","Mauritius","Mexico","Moldova","Monaco","Mongolia","Montenegro","Morocco",
  "Mozambique","Myanmar","Namibia","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea",
  "North Macedonia","Norway","Oman","Pakistan","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines",
  "Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saudi Arabia","Senegal","Serbia","Sierra Leone",
  "Singapore","Slovakia","Slovenia","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan",
  "Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Togo","Trinidad and Tobago","Tunisia",
  "Turkey","Turkmenistan","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan",
  "Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
  // Cities
  "New York","Los Angeles","London","Paris","Tokyo","Dubai","Singapore","Barcelona","Rome","Amsterdam",
  "Prague","Vienna","Budapest","Lisbon","Athens","Istanbul","Bangkok","Bali","Maldives","Santorini",
  "Mallorca","Ibiza","Mykonos","Amalfi Coast","Tuscany","Provence","Marrakech","Cape Town","Nairobi","Zanzibar",
];

function CountryInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [focused, setFocused] = React.useState(false);

  const handleChange = (v: string) => {
    onChange(v);
    if (v.length >= 2) {
      const matches = COUNTRIES.filter(c => c.toLowerCase().startsWith(v.toLowerCase())).slice(0, 5);
      setSuggestions(matches);
    } else {
      setSuggestions([]);
    }
  };

  const select = (country: string) => {
    onChange(country);
    setSuggestions([]);
  };

  return (
    <div style={{ position:"relative" }}>
      <input
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder || "Destination or country"}
        style={{ width:"100%", background:"#FCFAF5", border:`1.5px solid ${focused?"#C9A961":"#E8DFD0"}`, borderRadius:12, padding:"12px 14px", fontFamily:"'DM Sans', sans-serif", fontSize:16, color:"#2A1F18", outline:"none", boxSizing:"border-box" as const, marginBottom: suggestions.length > 0 ? 0 : 8 }}
      />
      {suggestions.length > 0 && focused && (
        <div style={{ position:"absolute", top:"100%", left:0, right:0, background:"#fff", border:"1.5px solid #E8DFD0", borderTop:"none", borderRadius:"0 0 12px 12px", zIndex:100, overflow:"hidden" }}>
          {suggestions.map(s => (
            <div key={s} onClick={() => select(s)} style={{ padding:"10px 14px", fontFamily:"'DM Sans', sans-serif", fontSize:14, color:"#2A1F18", cursor:"pointer", borderBottom:"1px solid #E8DFD0" }}
              onMouseEnter={e => (e.currentTarget.style.background="#F0E8D8")}
              onMouseLeave={e => (e.currentTarget.style.background="transparent")}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TripsScreen() {
  const { user, profile } = useStore();
  const [trips, setTrips]       = useState<Trip[]>([]);
  const [activeTrip, setActiveTrip] = useState<Trip|null>(null);
  const [detailTab, setDetailTab]   = useState("overview");
  const [showAdd, setShowAdd]   = useState(false);
  const [planning, setPlanning] = useState(false);
  const [packingLoading, setPackingLoading] = useState(false);

  // Add trip form
  const [dest, setDest]         = useState("");
  const [depDate, setDepDate]   = useState("");
  const [retDate, setRetDate]   = useState("");
  const [budget, setBudget]     = useState("");
  const [currency, setCurrency] = useState("USD");
  const [travellers, setTravellers] = useState<Traveller[]>([{ name: (profile as any)?.name || "Me", age: 35, type: "adult" }]);

  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "trips").then(d => { if(d?.trips) setTrips((d.trips as Trip[]).map(normTrip)); });
  }, [user?.uid]);

  const persist = async (updated: Trip[]) => {
    setTrips(updated);
    if (user?.uid) await saveData(user.uid, "trips", { trips: updated });
  };

  // ── Add traveller ─────────────────────────────────────────────────
  const addTraveller = () => setTravellers(p => [...p, { name: "", age: 5, type: "child" }]);
  const updateTraveller = (i: number, field: keyof Traveller, val: any) =>
    setTravellers(p => p.map((t, ti) => ti===i ? { ...t, [field]: val } : t));

  // ── Create trip per blueprint ─────────────────────────────────────
  const addTrip = async () => {
    if (!dest || !depDate) return;
    const dep = new Date(depDate);
    const ret = retDate ? new Date(retDate) : null;
    const nights = ret ? Math.ceil((ret.getTime()-dep.getTime())/(1000*60*60*24)) : 7;
    const totalBudget = parseFloat(budget) || 0;
    const preDep = PRE_DEPARTURE_TASKS(nights).map(t => ({
      ...t,
      deadline: resolveDeadline(depDate, t.deadline.replace("-days","").replace("-day","")),
      completed: false,
    }));
    const docs: Document[] = [
      ...travellers.map(() => ({ type:"passport" as const, status:"needed" as const })),
      { type:"insurance", status:"needed" },
      { type:"booking", status:"needed" },
    ];

    const trip: Trip = {
      id: crypto.randomUUID(),
      destination: dest, country: dest.split(",").pop()?.trim() || dest,
      departureDate: depDate, returnDate: retDate || undefined, nights,
      travellers,
      budget: { total: totalBudget, currency, breakdown: estimateBudgetBreakdown(totalBudget) },
      status: "planning",
      itinerary: [], packingList: [], preDeparture: preDep, documents: docs,
      createdAt: Date.now(),
    };

    const updated = [trip, ...trips];
    await persist(updated);
    setActiveTrip(normTrip(trip));
    setDest(""); setDepDate(""); setRetDate(""); setBudget(""); setShowAdd(false);

    // Link to budget per blueprint
    if (user?.uid) {
      await bus.publish("trips.trip.created", trip, { userId: user.uid, source: "trips" });
      if (totalBudget > 0) toast(`Trip added! Go to Budget → Goals to save for ${dest} 💛`, { duration: 4000 });
    }
  };

  // ── Generate itinerary per blueprint (with mum moment) ────────────
  const generateItinerary = async (trip: Trip) => {
    setPlanning(true);
    const kids = trip.travellers.filter(t=>t.type==="child");
    const adults = trip.travellers.filter(t=>t.type==="adult");

    const sys = `You are Nora, a travel planner. Return ONLY valid JSON with NO extra text:
{"days":[{"day":1,"date":"YYYY-MM-DD","theme":"string","morning":"activity idea","afternoon":"activity idea","evening":"dinner spot","tip":"one local tip","mumMoment":"something special for her"}]}
Keep each field under 8 words. Generate exactly ${Math.min(trip.nights,3)} days.`;

    const prompt = `${trip.nights} nights in ${trip.destination}. Party: ${(trip.travellers||[]).map(t=>`${t.name} (${t.age}y ${t.type})`).join(", ")}. Budget: ${trip.budget?.currency??'USD'}${trip.budget.total}.`;
    console.log("[Trips] calling AI for:", trip.destination);
    const result = await ai(sys, prompt, "trip_planner");
    console.log("[Trips] result:", result.error || result.text?.slice(0,100));

    if (!result.error) {
      try {
        const s=result.text.indexOf("{"); const e=result.text.lastIndexOf("}"); if(s===-1||e===-1) throw new Error("No JSON"); const parsed = JSON.parse(result.text.slice(s,e+1));
        const updated = trips.map(t => t.id===trip.id ? { ...t, itinerary:parsed.days } : t);
        await persist(updated);
        setActiveTrip(normTrip({ ...trip, itinerary:parsed.days }));
        trackEvent("itinerary_generated", { destination: trip.destination });
        toast.success("Itinerary ready ✦");
      } catch(e) { console.error("[Trips] parse error:", e); toast.error("Couldn't generate itinerary — tap Redo to try again"); }
    }
    setPlanning(false);
  };

  // ── Generate packing list per blueprint (Mum/Kids/Everyone/Documents/Tech) ──
  const generatePackingList = async (trip: Trip) => {
    setPackingLoading(true);
    const kids = trip.travellers.filter(t=>t.type==="child");

    const sys = `You are Nora. Generate a smart packing list. Return ONLY valid JSON:
{"sections":[
  {"name":"Mum","items":[{"name":"string","quantity":1,"essential":true,"weatherDependent":false}]},
  {"name":"Kids","items":[{"name":"string","quantity":1,"essential":true,"weatherDependent":false}]},
  {"name":"Everyone","items":[{"name":"string","quantity":1,"essential":true,"weatherDependent":false}]},
  {"name":"Documents","items":[{"name":"string","quantity":1,"essential":true,"weatherDependent":false}]},
  {"name":"Tech","items":[{"name":"string","quantity":1,"essential":false,"weatherDependent":false}]}
]}
${kids.length===0?"Skip Kids section.":""}
Personalise quantities to ${trip.nights} nights. Include weather-appropriate items.`;

    const prompt = `${trip.nights} nights in ${trip.destination}. Travellers: ${(trip.travellers||[]).map(t=>`${t.name} (${t.age}y)`).join(", ")}.`;
    console.log("[Trips] calling AI for:", trip.destination);
    const result = await ai(sys, prompt, "trip_planner");
    console.log("[Trips] result:", result.error || result.text?.slice(0,100));

    if (!result.error) {
      try {
        const cleanText = result.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const s=cleanText.indexOf("{"); const e=cleanText.lastIndexOf("}"); if(s===-1||e===-1) throw new Error("No JSON"); const parsed = JSON.parse(cleanText.slice(s,e+1));
        const sections: PackingSection[] = parsed.sections
          .filter((s:any) => s.items?.length > 0)
          .map((s:any) => ({
            name: s.name,
            items: s.items.map((i:any) => ({ ...i, checked:false, custom:false }))
          }));
        const updated = trips.map(t => t.id===trip.id ? { ...t, packingList:sections } : t);
        await persist(updated);
        console.log('[Trips] packing sections:', sections.length, sections.map(s=>s.name));
        setActiveTrip(normTrip({ ...trip, packingList:sections }));
        toast.success(`${(sections||[]).reduce((a,s)=>a+(s.items||[]).length,0)} items packed ✦`);
      } catch { toast.error("Couldn't generate packing list"); }
    }
    setPackingLoading(false);
  };

  // ── Toggle packing item ───────────────────────────────────────────
  const togglePacking = async (secIdx: number, itemIdx: number) => {
    if (!activeTrip) return;
    const updated_sections = activeTrip.packingList.map((s,si) =>
      si===secIdx ? { ...s, items:s.items.map((item,ii) => ii===itemIdx ? { ...item, checked:!item.checked } : item) } : s
    );
    const updated = { ...activeTrip, packingList:updated_sections };
    setActiveTrip(updated);
    const allTrips = trips.map(t => t.id===activeTrip.id ? updated : t);
    await persist(allTrips);
  };

  // ── Toggle pre-departure task ─────────────────────────────────────
  const togglePreDep = async (idx: number) => {
    if (!activeTrip) return;
    const updated = { ...activeTrip, preDeparture: activeTrip.preDeparture.map((t,i) => i===idx ? { ...t, completed:!t.completed } : t) };
    setActiveTrip(updated);
    await persist(trips.map(t => t.id===activeTrip.id ? updated : t));
  };

  // ── Toggle document status ────────────────────────────────────────
  const toggleDoc = async (idx: number) => {
    if (!activeTrip) return;
    const statuses: Document["status"][] = ["needed","ready","expired"];
    const doc = activeTrip.documents[idx];
    const nextStatus = statuses[(statuses.indexOf(doc.status)+1) % statuses.length];
    const updated = { ...activeTrip, documents: activeTrip.documents.map((d,i) => i===idx ? { ...d, status:nextStatus } : d) };
    setActiveTrip(updated);
    await persist(trips.map(t => t.id===activeTrip.id ? updated : t));
  };

  // ── Detail view ───────────────────────────────────────────────────
  const normTrip = (t: any): Trip => ({
    ...t,
    // Handle old field names
    destination: t.destination || t.dest || "Unknown destination",
    nights:      t.nights || 0,
    status:      t.status || "planning",
    travellers:   Array.isArray(t.travellers)   ? t.travellers   : [],
    itinerary:    Array.isArray(t.itinerary)    ? t.itinerary    : [],
    packingList:  Array.isArray(t.packingList)  ? t.packingList  : [],
    preDeparture: Array.isArray(t.preDeparture) ? t.preDeparture : [],
    documents:    Array.isArray(t.documents)    ? t.documents    : [],
    budget: {
      total:     typeof t.budget?.total    === "number" ? t.budget.total    : 0,
      currency:  typeof t.budget?.currency === "string" ? t.budget.currency : "GBP",
      breakdown: t.budget?.breakdown ?? { flights:0, accommodation:0, food:0, activities:0, transport:0, contingency:0 },
    },
  });

  if (activeTrip) {
    const trip = trips.find(t=>t.id===activeTrip.id) || activeTrip;
    const du = DAYS_UNTIL(trip.departureDate);
    const totalItems = (trip.packingList||[]).reduce((a,s)=>a+(s?.items||[]).length,0);
    const checkedItems = (trip.packingList||[]).reduce((a,s)=>a+(s?.items||[]).filter(i=>i?.checked).length,0);
    const completedPreDep = (trip.preDeparture||[]).filter(t=>t?.completed).length;
    const docsReady = (trip.documents||[]).filter(d=>d?.status==="ready").length;

    const STATUS_COLORS: Record<string,string> = { needed:T.blush, ready:T.sage, expired:"#dc2626" };
    const CAT_COLORS: Record<string,string> = { booking:T.gold, document:T.blush, health:T.sage, packing:T.sky, home:T.lav, notification:T.taupe };

    return (
      <div style={{ animation:"fadeUp .45s ease both" }}>
        <button onClick={()=>{ setActiveTrip(null); setDetailTab("overview"); }} style={{ background:"none", border:"none", fontFamily:F.sans, fontSize:13, color:T.taupe, cursor:"pointer", marginBottom:12, padding:"8px 0", minHeight:44, touchAction:"manipulation" }}>← All trips</button>

        <HeroCard
          eyebrow={du>0?`${du} DAYS AWAY`:"DEPARTING TODAY!"}
          title={trip.destination}
          subtitle={`${trip.nights} nights · ${safeDate(trip.departureDate).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}`}
          color={du<=7?"#dc2626":du<=30?T.gold:T.esp}
        />

        {/* Tabs */}
        <div style={{ display:"flex", gap:6, marginBottom:16, overflowX:"auto", paddingBottom:4 }}>
          {["overview","itinerary","packing","checklist","budget","edit"].map(t=>(
            <Pill key={t} label={
              t==="overview"?"Overview":
              t==="itinerary"?"📅 Itinerary":
              t==="packing"?`🧳 Packing${totalItems>0?` (${checkedItems}/${totalItems})`:""}`:
              t==="checklist"?`✓ Pre-Dep${completedPreDep>0?` (${completedPreDep}/${trip.preDeparture.length})`:""}`:
              "💰 Budget"
            } active={detailTab===t} onClick={()=>setDetailTab(t)}/>
          ))}
        </div>

        {/* ── OVERVIEW ──────────────────────────────────────────────── */}
        {detailTab==="overview" && <>
          {/* Travellers per blueprint */}
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>TRAVELLERS</p>
            {(trip.travellers||[]).map((t,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 0", borderBottom:`1px solid ${T.linen}` }}>
                <span style={{ fontSize:20 }}>{t.type==="adult"?"👩":t.age<3?"👶":"🧒"}</span>
                <div>
                  <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>{t.name}</p>
                  <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:0 }}>{t.age} years · {t.type}</p>
                </div>
              </div>
            ))}
          </Card>

          {/* Quick stats */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
            {[
              { label:"Nights",        value:trip.nights },
              { label:"Travellers",    value:trip.travellers.length },
              { label:"Packing",       value:totalItems>0?`${checkedItems}/${totalItems}`:"Not started" },
              { label:"Docs Ready",    value:`${docsReady}/${trip.documents.length}` },
            ].map(s=>(
              <div key={s.label} style={{ background:T.ivory, borderRadius:16, padding:"14px 16px", border:`1px solid ${T.linen}` }}>
                <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 4px" }}>{s.label}</p>
                <p style={{ fontFamily:F.serif, fontSize:22, fontWeight:700, color:T.esp, margin:0 }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Packing progress */}
          {totalItems>0 && <Card>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>PACKING PROGRESS</p>
              <span style={{ fontFamily:F.sans, fontSize:11, color:T.gold }}>{checkedItems}/{totalItems}</span>
            </div>
            <ProgressBar value={checkedItems} max={totalItems} color={T.gold}/>
          </Card>}

          {/* Documents per blueprint */}
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>DOCUMENTS</p>
            {(trip.documents||[]).map((doc,i)=>(
              <div key={i} onClick={()=>toggleDoc(i)} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:`1px solid ${T.linen}`, cursor:"pointer" }}>
                <span style={{ fontSize:20 }}>{doc.type==="passport"?"◈":doc.type==="insurance"?"◉":doc.type==="visa"?"◎":"◦"}</span>
                <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0, flex:1, textTransform:"capitalize" }}>{doc.type}{doc.notes?` — ${doc.notes}`:""}</p>
                <span style={{ background:`${STATUS_COLORS[doc.status]}20`, color:STATUS_COLORS[doc.status], fontFamily:F.sans, fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:20, textTransform:"capitalize" }}>{doc.status}</span>
              </div>
            ))}
            <p style={{ fontFamily:F.sans, fontSize:10, color:T.taupe, margin:"8px 0 0", textAlign:"center" }}>Tap to cycle status</p>
          </Card>

          {!trip.itinerary.length && <Button onClick={()=>generateItinerary(trip)} disabled={planning} variant="gold">{planning?<span>✦ Planning...</span>:"✦ Generate Itinerary"}</Button>}
          {!trip.packingList.length && <Button onClick={()=>generatePackingList(trip)} disabled={packingLoading} variant="secondary" style={{ marginTop:8 }}>{packingLoading?"✦ Generating...":"✦ Generate Packing List"}</Button>}
        </>}

        {/* ── ITINERARY per blueprint with mum moment ───────────────── */}
        {detailTab==="itinerary" && <>
          {(trip.itinerary||[]).length ? (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <AIBadge label="Planned by Nora"/>
                <button onClick={()=>generateItinerary(trip)} style={{ background:"none", border:`1px solid ${T.linen}`, borderRadius:10, padding:"6px 12px", fontFamily:F.sans, fontSize:11, color:T.taupe, cursor:"pointer" }}>↻ Redo</button>
              </div>
              {trip.itinerary.map((day,di)=>(
                <ExpandableDay key={di} day={day} currency={trip.budget?.currency??'USD'} />
              ))}

            </>
          ) : (
            <Card>
              <p style={{ fontFamily:F.sans, fontSize:14, color:T.taupe, textAlign:"center", padding:"20px 0", lineHeight:1.6 }}>No itinerary yet — generate one in Overview.</p>
            </Card>
          )}
        </>}

        {/* ── PACKING LIST per blueprint sections ───────────────────── */}
        {detailTab==="packing" && <>
          {trip.packingList.length ? (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <AIBadge label="Packed by Nora"/>
                <button onClick={()=>generatePackingList(trip)} style={{ background:"none", border:`1px solid ${T.linen}`, borderRadius:10, padding:"6px 12px", fontFamily:F.sans, fontSize:11, color:T.taupe, cursor:"pointer" }}>↻ Redo</button>
              </div>
              {trip.packingList.map((sec,si)=>{
                const secChecked = sec.items.filter(i=>i.checked).length;
                const secIcons: Record<string,string> = { Mum:"✦", Kids:"◆", Everyone:"◈", Documents:"◎", Tech:"◉" };
                return (
                  <Card key={si}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                      <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>
                        {secIcons[sec.name]||"◦"} {sec.name}
                      </p>
                      <span style={{ fontFamily:F.sans, fontSize:11, color:T.gold }}>{secChecked}/{sec.items.length}</span>
                    </div>
                    <ProgressBar value={secChecked} max={sec.items.length} color={T.gold} height={4}/>
                    <div style={{ marginTop:12 }}>
                      {sec.items.map((item,ii)=>(
                        <div key={ii} onClick={()=>togglePacking(si,ii)} style={{ display:"flex", alignItems:"center", gap:12, padding:"9px 0", borderBottom:`1px solid ${T.linen}`, cursor:"pointer", touchAction:"manipulation" }}>
                          <div style={{ width:22, height:22, borderRadius:7, border:`2px solid ${item.checked?T.sage:item.essential?"#dc2626":T.linen}`, background:item.checked?T.sage:"transparent", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:13 }}>{item.checked?"✓":""}</div>
                          <div style={{ flex:1 }}>
                            <p style={{ fontFamily:F.sans, fontSize:13, color:item.checked?T.taupe:T.esp, margin:0, textDecoration:item.checked?"line-through":"none" }}>
                              {item.quantity>1?`${item.quantity}x `:""}{item.name}
                            </p>
                          </div>
                          {item.essential && !item.checked && <span style={{ fontFamily:F.sans, fontSize:9, color:"#dc2626", textTransform:"uppercase", letterSpacing:"0.08em" }}>essential</span>}
                          {item.weatherDependent && <span style={{ fontSize:12 }}>🌤</span>}
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </>
          ) : (
            <Button onClick={()=>generatePackingList(trip)} disabled={packingLoading} variant="gold">
              {packingLoading?"✦ Generating...":"✦ Generate Packing List"}
            </Button>
          )}
        </>}

        {/* ── PRE-DEPARTURE CHECKLIST per blueprint ─────────────────── */}
        {detailTab==="checklist" && <>
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>PRE-DEPARTURE TASKS</p>
              <span style={{ fontFamily:F.sans, fontSize:11, color:T.gold }}>{completedPreDep}/{trip.preDeparture.length}</span>
            </div>
            <ProgressBar value={completedPreDep} max={trip.preDeparture.length} color={T.sage}/>
          </Card>
          {(trip.preDeparture||[]).map((task,i)=>{
            const daysLeft = Math.ceil((safeDate(task.deadline).getTime()-Date.now())/(1000*60*60*24));
            const isOverdue = daysLeft < 0 && !task.completed;
            return (
              <div key={i} onClick={()=>togglePreDep(i)} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", background:task.completed?T.ivory:isOverdue?`${T.blush}10`:T.ivory, borderRadius:16, border:`1.5px solid ${task.completed?T.linen:isOverdue?T.blush:T.linen}`, marginBottom:8, cursor:"pointer", touchAction:"manipulation" }}>
                <div style={{ width:24, height:24, borderRadius:8, border:`2px solid ${task.completed?T.sage:isOverdue?"#dc2626":CAT_COLORS[task.category]||T.linen}`, background:task.completed?T.sage:"transparent", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:14 }}>{task.completed?"✓":""}</div>
                <div style={{ flex:1 }}>
                  <p style={{ fontFamily:F.sans, fontSize:13, color:task.completed?T.taupe:T.esp, margin:0, textDecoration:task.completed?"line-through":"none" }}>{task.task}</p>
                  <p style={{ fontFamily:F.sans, fontSize:11, color:isOverdue?"#dc2626":T.taupe, margin:"2px 0 0" }}>
                    {isOverdue?"⚠ Overdue — ":`By `}{safeDate(task.deadline).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                    {" · "}<span style={{ color:CAT_COLORS[task.category]||T.taupe }}>{task.category}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </>}

        {/* ── BUDGET per blueprint breakdown ────────────────────────── */}
        {detailTab==="edit" && <>
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>EDIT TRIP</p>
            <CountryInput value={dest} onChange={setDest} placeholder="City or country (e.g. Mallorca, Japan)" />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
              <div>
                <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 4px" }}>Departure</p>
                <input type="date" value={depDate} onChange={e=>setDepDate(e.target.value)} style={{ width:"100%", background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"11px 12px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", boxSizing:"border-box" as any, minHeight:44 }}/>
              </div>
              <div>
                <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 4px" }}>Return</p>
                <input type="date" value={retDate} onChange={e=>setRetDate(e.target.value)} style={{ width:"100%", background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"11px 12px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", boxSizing:"border-box" as any, minHeight:44 }}/>
              </div>
            </div>
            <Input value={budget} onChange={setBudget} placeholder="Total budget" style={{ marginBottom:8 }}/>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 8px" }}>TRAVELLERS</p>
            {travellers.map((t,i)=>(
              <div key={i} style={{ display:"flex", gap:6, marginBottom:6, alignItems:"center" }}>
                <input value={t.name} onChange={e=>updateTraveller(i,"name",e.target.value)} placeholder="Name" style={{ flex:2, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:10, padding:"8px 10px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", minHeight:40 }}/>
                <input value={t.age} onChange={e=>updateTraveller(i,"age",parseInt(e.target.value)||0)} type="number" placeholder="Age" style={{ flex:1, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:10, padding:"8px 10px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", minHeight:40 }}/>
                <select value={t.type} onChange={e=>updateTraveller(i,"type",e.target.value as any)} style={{ flex:1, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:10, padding:"8px 6px", fontFamily:F.sans, fontSize:12, color:T.esp, outline:"none", minHeight:40 }}>
                  <option value="adult">Adult</option>
                  <option value="child">Child</option>
                  <option value="infant">Infant</option>
                </select>
              </div>
            ))}
            <button onClick={addTraveller} style={{ background:"none", border:`1px dashed ${T.linen}`, borderRadius:10, padding:"8px", width:"100%", fontFamily:F.sans, fontSize:12, color:T.taupe, cursor:"pointer", marginBottom:12, minHeight:36 }}>+ Add traveller</button>
            <Button onClick={async () => {
              if (!dest || !depDate) return;
              const dep = new Date(depDate);
              const ret = retDate ? new Date(retDate) : null;
              const nights = ret ? Math.ceil((ret.getTime()-dep.getTime())/(1000*60*60*24)) : trip.nights;
              const updated = { ...trip, destination:dest, departureDate:depDate, returnDate:retDate||undefined, nights, travellers, budget:{ ...trip.budget, total:parseFloat(budget)||trip.budget.total } };
              const allTrips = trips.map(t => t.id===trip.id ? updated : t);
              await persist(allTrips);
              setActiveTrip(normTrip(updated));
              setDetailTab("overview");
              toast.success("Trip updated ✓");
            }} variant="gold">Save Changes</Button>
          </Card>
        </>}

        {detailTab==="budget" && <>
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>TRIP BUDGET</p>
              <p style={{ fontFamily:F.serif, fontSize:24, fontWeight:700, color:T.esp, margin:0 }}>{trip.budget?.currency??'USD'}{(trip.budget?.total??0).toLocaleString()}</p>
            </div>
            {Object.entries(trip.budget.breakdown).map(([cat,amount])=>(
              <div key={cat} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:`1px solid ${T.linen}` }}>
                <span style={{ fontFamily:F.sans, fontSize:13, color:T.esp, textTransform:"capitalize" }}>{cat}</span>
                <span style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp }}>{trip.budget?.currency??'USD'}{amount}</span>
              </div>
            ))}
          </Card>
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:13, color:T.taupe, textAlign:"center", padding:"8px 0", lineHeight:1.6 }}>
              Set up a savings goal in Budget → Goals to track your {trip.destination} savings 💛
            </p>
          </Card>
        </>}
      </div>
    );
  }

  // ── Trip list view ────────────────────────────────────────────────
  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="ADVENTURES" title="Trips"/>

      {trips.length>0 && (() => {
        const next = trips.filter(t=>DAYS_UNTIL(t.departureDate)>0).sort((a,b)=>DAYS_UNTIL(a.departureDate)-DAYS_UNTIL(b.departureDate))[0];
        if (!next) return null;
        return (
          <HeroCard
            eyebrow="NEXT TRIP"
            title={next.destination}
            subtitle={`${DAYS_UNTIL(next.departureDate)} days away · ${next.nights} nights · ${next.travellers.length} traveller${next.travellers.length>1?"s":""}`}
            color={T.esp}
          />
        );
      })()}

      <Button onClick={()=>setShowAdd(!showAdd)} variant="gold" style={{ marginBottom:16 }}>+ Plan a New Trip</Button>

      {showAdd && <Card>
        <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>NEW TRIP</p>
        <CountryInput value={dest} onChange={setDest} placeholder="City or country (e.g. Mallorca, Japan)" />
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
          <div>
            <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 4px" }}>Departure</p>
            <input type="date" value={depDate} onChange={e=>setDepDate(e.target.value)} style={{ width:"100%", background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"11px 12px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", boxSizing:"border-box", minHeight:44 }}/>
          </div>
          <div>
            <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 4px" }}>Return</p>
            <input type="date" value={retDate} onChange={e=>setRetDate(e.target.value)} style={{ width:"100%", background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"11px 12px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", boxSizing:"border-box", minHeight:44 }}/>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:12 }}>
          <div style={{ flex:2 }}>
            <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 4px" }}>Budget</p>
            <Input value={budget} onChange={setBudget} placeholder="Total budget" type="number"/>
          </div>
          <div style={{ flex:1 }}>
            <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 4px" }}>Currency</p>
            <select value={currency} onChange={e=>setCurrency(e.target.value)} style={{ width:"100%", background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"11px 12px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", minHeight:44 }}>
              {["GBP","USD","EUR","AUD","CAD"].map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Travellers per blueprint */}
        <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 8px" }}>TRAVELLERS</p>
        {travellers.map((t,i)=>(
          <div key={i} style={{ background:T.sand, borderRadius:12, padding:"10px 12px", marginBottom:8, border:`1px solid ${T.linen}` }}>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <input value={t.name} onChange={e=>updateTraveller(i,"name",e.target.value)} placeholder="Name" style={{ flex:1, background:"#fff", border:`1.5px solid ${T.linen}`, borderRadius:8, padding:"8px 10px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", minHeight:38 }}/>
              {travellers.length>1 && <button onClick={()=>setTravellers(p=>p.filter((_,ti)=>ti!==i))} style={{ background:"none", border:"none", color:T.taupe, cursor:"pointer", fontSize:18, padding:"0 4px", flexShrink:0 }}>×</button>}
            </div>
            <div style={{ display:"flex", gap:6, marginTop:6 }}>
              <input value={t.age} onChange={e=>updateTraveller(i,"age",parseInt(e.target.value)||0)} type="number" placeholder="Age" style={{ width:70, background:"#fff", border:`1.5px solid ${T.linen}`, borderRadius:8, padding:"6px 10px", fontFamily:F.sans, fontSize:14, color:T.esp, outline:"none", minHeight:36 }}/>
              <select value={t.type} onChange={e=>updateTraveller(i,"type",e.target.value as any)} style={{ flex:1, background:"#fff", border:`1.5px solid ${T.linen}`, borderRadius:8, padding:"6px 10px", fontFamily:F.sans, fontSize:13, color:T.esp, outline:"none", minHeight:36 }}>
                <option value="adult">Adult</option>
                <option value="child">Child</option>
                <option value="infant">Infant</option>
              </select>
            </div>
          </div>
        ))}
        <button onClick={addTraveller} style={{ background:"none", border:`1px dashed ${T.linen}`, borderRadius:10, padding:"8px", width:"100%", fontFamily:F.sans, fontSize:12, color:T.taupe, cursor:"pointer", marginBottom:12, minHeight:36 }}>+ Add traveller</button>

        <div style={{ display:"flex", gap:8 }}>
          <Button onClick={addTrip} disabled={!dest||!depDate} variant="gold" style={{ flex:1 }}>Add Trip</Button>
          <Button onClick={()=>setShowAdd(false)} variant="ghost" style={{ flex:1 }}>Cancel</Button>
        </div>
      </Card>}

      {trips.length===0 && !showAdd && (
        <Card><p style={{ fontFamily:F.sans, fontSize:14, color:T.taupe, textAlign:"center", padding:"20px 0", lineHeight:1.6 }}>No trips planned yet.<br/>Add your next adventure above!</p></Card>
      )}

      {trips.map(t=>{
        const du = DAYS_UNTIL(t.departureDate);
        return (
          <div key={t.id} onClick={()=>{ 
                const nt = normTrip(t); 
                setActiveTrip(nt); 
                setDetailTab("overview");
                setDest(nt.destination||"");
                setDepDate(nt.departureDate||"");
                setRetDate(nt.returnDate||"");
                setBudget(String(nt.budget?.total||""));
                setTravellers(nt.travellers.length ? nt.travellers : [{ name:"", age:30, type:"adult" as const }]);
              }} style={{ display:"flex", gap:14, padding:"16px", background:T.ivory, borderRadius:20, border:`1px solid ${T.linen}`, marginBottom:10, cursor:"pointer", touchAction:"manipulation" }}>
            <div style={{ width:52, height:52, borderRadius:14, background:`linear-gradient(135deg,${du<=7?"#dc2626":du<=30?T.gold:T.esp},${du<=7?"#991b1b":du<=30?"#8B6914":"#3D2E22"})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>✈️</div>
            <div style={{ flex:1 }}>
              <p style={{ fontFamily:F.serif, fontSize:18, fontStyle:"italic", color:T.esp, margin:"0 0 4px" }}>{t.destination}</p>
              <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:0 }}>
                {t.nights} nights · {t.travellers.length} traveller{t.travellers.length>1?"s":""} · {safeDate(t.departureDate).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
              </p>
            </div>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
              <span style={{ background:du<=7?`#dc262615`:du<=30?T.goldP:T.sand, color:du<=7?"#dc2626":du<=30?T.gold:T.taupe, fontFamily:F.sans, fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:20 }}>{du>0?`${du}d`:"Now"}</span>
              <span style={{ fontFamily:F.sans, fontSize:10, color:T.taupe, textTransform:"capitalize" }}>{t.status}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
