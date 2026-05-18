import React, { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, Pill, AIBadge, Spinner, ProgressBar, Button } from "../../shared/components";
import { saveData, loadData } from "../../core/firebase";
import { ai } from "../../core/ai";
import { bus } from "../../core/events";
import { analyzeScenario, buildHouseholdSnapshot } from "../../core/household";
import toast from "react-hot-toast";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type TripState =
  | "dreaming" | "evaluating" | "booking" | "preparing"
  | "countdown" | "travel_day" | "in_trip" | "returning"
  | "recovery" | "completed";

interface Traveller {
  id: string;
  name: string;
  age: number;
  type: "adult" | "child" | "infant";
  role?: "partner" | "kid" | "parent" | "friend" | "other";
  fromProfile?: boolean;
}

interface BudgetBreakdown {
  flights: number;
  accommodation: number;
  food: number;
  activities: number;
  transport: number;
  contingency: number;
}

interface ItineraryDay {
  day: number;
  date: string;
  theme: string;
  morning: string;
  afternoon: string;
  evening: string;
  tip: string;
  mumMoment: string;
}

interface PackingItem {
  name: string;
  quantity: number;
  essential: boolean;
  checked: boolean;
  custom: boolean;
  weatherDependent?: boolean;
  assignedTo?: string;
}

interface PackingSection {
  name: string;
  items: PackingItem[];
}

interface PreDepartureTask {
  task: string;
  deadline: string;
  completed: boolean;
  category: "booking" | "document" | "health" | "packing" | "home" | "notification";
  assignedTo?: string;
}

interface TripDocument {
  type: "passport" | "visa" | "insurance" | "booking" | "health";
  status: "needed" | "ready" | "expired";
  traveller?: string;
  notes?: string;
}

interface ReadinessScore {
  overall: number;
  documents: number;
  budget: number;
  packing: number;
  booking: number;
  tasks: number;
}

interface Trip {
  id: string;
  destination: string;
  country: string;
  departureDate: string;
  returnDate?: string;
  nights: number;
  state: TripState;
  travellers: Traveller[];
  budget: { total: number; currency: string; breakdown: BudgetBreakdown; spent?: number };
  itinerary: ItineraryDay[];
  packingList: PackingSection[];
  preDeparture: PreDepartureTask[];
  documents: TripDocument[];
  stressLevel?: "low" | "moderate" | "high";
  householdImpact?: string;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

const safeDate = (d: string) => { try { const dt = new Date(d); return isNaN(dt.getTime()) ? new Date() : dt; } catch { return new Date(); } };
const daysUntil = (d: string) => Math.ceil((safeDate(d).getTime() - Date.now()) / 86400000);

function computeTripState(trip: Trip): TripState {
  const du = daysUntil(trip.departureDate);
  if ((trip.state as string) === "completed" || (trip.state as string) === "recovery") return trip.state;
  if (du < 0) {
    const returnDu = trip.returnDate ? daysUntil(trip.returnDate) : -1;
    if (returnDu > 0) return "in_trip";
    if (returnDu > -3) return "returning";
    return trip.state === "recovery" ? "recovery" : "completed";
  }
  if (du === 0) return "travel_day";
  if (du <= 7) return "countdown";
  if (du <= 30) return "preparing";
  if (trip.state === "evaluating") return "evaluating";
  return "booking";
}

function computeReadiness(trip: Trip): ReadinessScore {
  const docs = trip.documents.length > 0
    ? Math.round((trip.documents.filter(d => d.status === "ready").length / trip.documents.length) * 100) : 0;
  const budget = trip.budget.total > 0 ? 100 : 0;
  const packing = trip.packingList.length > 0
    ? Math.round((trip.packingList.flatMap(s => s.items).filter(i => i.checked).length / Math.max(1, trip.packingList.flatMap(s => s.items).length)) * 100) : 0;
  const booking = trip.documents.find(d => d.type === "booking")?.status === "ready" ? 100 : 0;
  const tasks = trip.preDeparture.length > 0
    ? Math.round((trip.preDeparture.filter(t => t.completed).length / trip.preDeparture.length) * 100) : 0;
  const overall = Math.round((docs + budget + packing + booking + tasks) / 5);
  return { overall, documents: docs, budget, packing, booking, tasks };
}

function estimateBudgetBreakdown(total: number): BudgetBreakdown {
  return {
    flights: Math.round(total * 0.35),
    accommodation: Math.round(total * 0.30),
    food: Math.round(total * 0.15),
    activities: Math.round(total * 0.10),
    transport: Math.round(total * 0.05),
    contingency: Math.round(total * 0.05),
  };
}

const STATE_CONFIG: Record<TripState, { label: string; color: string; emoji: string; description: string }> = {
  dreaming:   { label: "Dreaming",    color: T.lav,   emoji: "✦",  description: "Explore the idea" },
  evaluating: { label: "Evaluating",  color: T.sky,   emoji: "◎",  description: "Checking affordability" },
  booking:    { label: "Booking",     color: T.teal,  emoji: "◈",  description: "Securing reservations" },
  preparing:  { label: "Preparing",   color: T.gold,  emoji: "◆",  description: "Getting ready" },
  countdown:  { label: "Countdown",   color: T.sage,  emoji: "✓",  description: "Almost there" },
  travel_day: { label: "Travel Day",  color: "#dc2626", emoji: "✈", description: "Today's the day" },
  in_trip:    { label: "In Trip",     color: T.teal,  emoji: "☀",  description: "Enjoy every moment" },
  returning:  { label: "Returning",   color: T.gold,  emoji: "→",  description: "Heading home" },
  recovery:   { label: "Recovery",    color: T.sage,  emoji: "◦",  description: "Settling back in" },
  completed:  { label: "Completed",   color: T.taupe, emoji: "✦",  description: "A trip to remember" },
};

const PRE_DEPARTURE_TASKS: Omit<PreDepartureTask, "completed">[] = [
  { task: "Check passport expiry dates",    deadline: "60 days before", category: "document" },
  { task: "Book flights & accommodation",   deadline: "90 days before", category: "booking" },
  { task: "Arrange travel insurance",       deadline: "30 days before", category: "document" },
  { task: "Check visa requirements",        deadline: "60 days before", category: "document" },
  { task: "Notify bank of travel dates",    deadline: "7 days before",  category: "notification" },
  { task: "Arrange pet / house care",       deadline: "14 days before", category: "home" },
  { task: "Complete online check-in",       deadline: "1 day before",   category: "booking" },
  { task: "Download offline maps",          deadline: "3 days before",  category: "packing" },
  { task: "Charge all devices",             deadline: "1 day before",   category: "packing" },
  { task: "Pack medications & first aid",   deadline: "2 days before",  category: "health" },
];

function normTrip(t: any): Trip {
  return {
    ...t,
    travellers:   Array.isArray(t.travellers)   ? t.travellers   : [],
    itinerary:    Array.isArray(t.itinerary)    ? t.itinerary    : [],
    packingList:  Array.isArray(t.packingList)  ? t.packingList  : [],
    preDeparture: Array.isArray(t.preDeparture) ? t.preDeparture : [],
    documents:    Array.isArray(t.documents)    ? t.documents    : [],
    state: t.state || computeTripState(t),
  };
}

// ═══════════════════════════════════════════════════════════════════
// READINESS RING COMPONENT
// ═══════════════════════════════════════════════════════════════════

function ReadinessRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const color = score >= 80 ? T.sage : score >= 50 ? T.gold : T.blush;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.linen} strokeWidth={6} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: F.serif, fontSize: size * 0.22, fontWeight: 700, color, lineHeight: 1 }}>{score}%</span>
        <span style={{ fontFamily: F.sans, fontSize: size * 0.10, color: T.taupe, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ready</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function TripsScreen() {
  const { user, profile, familyMembers, householdSnapshot, setHouseholdSnapshot } = useStore();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "itinerary" | "packing" | "checklist" | "budget" | "ask">("overview");
  const [showAdd, setShowAdd] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [packingLoading, setPackingLoading] = useState(false);
  const [cfoLoading, setCfoLoading] = useState(false);
  const [cfoResult, setCfoResult] = useState<any>(null);

  // ── Add trip form state ──────────────────────────────────────────
  const [dest, setDest] = useState("");
  const [depDate, setDepDate] = useState("");
  const [retDate, setRetDate] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [travellers, setTravellers] = useState<Traveller[]>([]);

  // ── Load data ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "trips").then(d => {
      if (d?.trips) setTrips((d.trips as Trip[]).map(normTrip));
    });
  }, [user?.uid]);

  // ── Pre-populate travellers from profile ─────────────────────────
  useEffect(() => {
    if (!showAdd) return;
    const defaultTravellers: Traveller[] = [];

    // Add self
    defaultTravellers.push({
      id: "self",
      name: (profile as any)?.name || "Me",
      age: 35,
      type: "adult",
      role: "other",
      fromProfile: true,
    });

    // Add partner from family members
    const partner = familyMembers.find((m: any) => m.role === "partner" || m.role === "spouse");
    if (partner) {
      defaultTravellers.push({
        id: partner.id || "partner",
        name: partner.name,
        age: partner.age || 35,
        type: "adult",
        role: "partner",
        fromProfile: true,
      });
    }

    // Add kids from profile
    const kids = (profile as any)?.kids || [];
    kids.forEach((k: any, i: number) => {
      defaultTravellers.push({
        id: `kid_${i}`,
        name: k.name,
        age: k.age || 8,
        type: k.age < 2 ? "infant" : "child",
        role: "kid",
        fromProfile: true,
      });
    });

    // Also check familyMembers for children
    familyMembers.filter((m: any) => m.role === "child").forEach((m: any) => {
      if (!defaultTravellers.find(t => t.name === m.name)) {
        defaultTravellers.push({
          id: m.id || m.name,
          name: m.name,
          age: m.age || 8,
          type: m.age < 2 ? "infant" : "child",
          role: "kid",
          fromProfile: true,
        });
      }
    });

    setTravellers(defaultTravellers);
  }, [showAdd, profile, familyMembers]);

  const persist = async (updated: Trip[]) => {
    setTrips(updated);
    if (user?.uid) await saveData(user.uid, "trips", { trips: updated });
  };

  // ── Create trip ──────────────────────────────────────────────────
  const addTrip = async () => {
    if (!dest || !depDate) return;
    const dep = new Date(depDate);
    const ret = retDate ? new Date(retDate) : null;
    const nights = ret ? Math.ceil((ret.getTime() - dep.getTime()) / 86400000) : 7;
    const totalBudget = parseFloat(budget) || 0;

    const docs: TripDocument[] = [
      ...travellers.filter(t => t.type !== "infant").map(t => ({
        type: "passport" as const, status: "needed" as const, traveller: t.name,
      })),
      { type: "insurance", status: "needed" },
      { type: "booking", status: "needed" },
    ];

    const trip: Trip = {
      id: crypto.randomUUID(),
      destination: dest,
      country: dest.split(",").pop()?.trim() || dest,
      departureDate: depDate,
      returnDate: retDate || undefined,
      nights,
      state: daysUntil(depDate) > 30 ? "booking" : "preparing",
      travellers: travellers.filter(t => t.name.trim()),
      budget: { total: totalBudget, currency, breakdown: estimateBudgetBreakdown(totalBudget), spent: 0 },
      itinerary: [],
      packingList: [],
      preDeparture: PRE_DEPARTURE_TASKS.map(t => ({ ...t, completed: false })),
      documents: docs,
      createdAt: Date.now(),
    };

    const updated = [trip, ...trips];
    await persist(updated);
    setActiveTrip(normTrip(trip));
    setDest(""); setDepDate(""); setRetDate(""); setBudget(""); setShowAdd(false);
    setDetailTab("overview");

    if (user?.uid) {
      await bus.publish("trips.trip.created", trip, { userId: user.uid, source: "trips" });
      if (totalBudget > 0) toast(`Trip to ${dest} added! ✦`, { duration: 3000 });
    }
  };

  // ── Generate itinerary (up to 7 days) ────────────────────────────
  const generateItinerary = async (trip: Trip) => {
    setPlanning(true);
    const kids = trip.travellers.filter(t => t.type === "child");
    const adults = trip.travellers.filter(t => t.type === "adult");
    const days = Math.min(trip.nights, 7);

    const sys = `You are Nora, a family travel planner. Return ONLY valid JSON:
{"days":[{"day":1,"date":"YYYY-MM-DD","theme":"string","morning":"activity","afternoon":"activity","evening":"dinner spot","tip":"local tip","mumMoment":"something special just for her — rest, beauty, joy"}]}
Generate exactly ${days} days. Keep each field under 12 words. Make it feel achievable not exhausting.`;

    const prompt = `${days} nights in ${trip.destination}.
Party: ${adults.map(a => a.name).join(", ")} (adults)${kids.length ? `, ${kids.map(k => `${k.name} age ${k.age}`).join(", ")} (kids)` : ""}.
Budget: ${trip.budget.currency}${trip.budget.total}.
Make it family-friendly but include a mum moment each day.`;

    const result = await ai(sys, prompt, "trip_planner");
    if (!result.error) {
      try {
        const clean = result.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const s = clean.indexOf("{"); const e = clean.lastIndexOf("}");
        if (s === -1 || e === -1) throw new Error("No JSON");
        const parsed = JSON.parse(clean.slice(s, e + 1));
        const updated = trips.map(t => t.id === trip.id ? { ...t, itinerary: parsed.days } : t);
        await persist(updated);
        setActiveTrip(normTrip({ ...trip, itinerary: parsed.days }));
        toast.success(`${days}-day itinerary ready ✦`);
      } catch { toast.error("Itinerary generation failed — try again"); }
    }
    setPlanning(false);
  };

  // ── Generate packing list ────────────────────────────────────────
  const generatePackingList = async (trip: Trip) => {
    setPackingLoading(true);
    const kids = trip.travellers.filter(t => t.type === "child");
    const hasKids = kids.length > 0;

    const sys = `You are Nora. Generate a smart family packing list. Return ONLY valid JSON:
{"sections":[{"name":"Mum","items":[{"name":"Underwear","quantity":7,"essential":true,"weatherDependent":false}]},{"name":"${hasKids ? "Kids" : "Partner"}","items":[]},{"name":"Everyone","items":[]},{"name":"Documents","items":[]},{"name":"Tech","items":[]}]}
Each item: name, quantity (number), essential (bool), weatherDependent (bool). Max 12 items per section.`;

    const prompt = `Trip to ${trip.destination}, ${trip.nights} nights.
${hasKids ? `Kids: ${kids.map(k => `${k.name} age ${k.age}`).join(", ")}.` : "Adults only."}
Weather: pack for typical ${trip.destination} conditions.`;

    const result = await ai(sys, prompt, "trip_planner");
    if (!result.error) {
      try {
        const clean = result.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const s = clean.indexOf("{"); const e = clean.lastIndexOf("}");
        if (s === -1 || e === -1) throw new Error("No JSON");
        const parsed = JSON.parse(clean.slice(s, e + 1));
        const sections: PackingSection[] = parsed.sections
          .filter((s: any) => s.items?.length > 0)
          .map((s: any) => ({
            name: s.name,
            items: s.items.map((i: any) => ({ ...i, checked: false, custom: false })),
          }));
        console.log("[Trips] packing sections:", sections.length, sections.map(s => s.name));
        const updated = trips.map(t => t.id === trip.id ? { ...t, packingList: sections } : t);
        await persist(updated);
        setActiveTrip(normTrip({ ...trip, packingList: sections }));
        toast.success(`${sections.flatMap(s => s.items).length} items packed ✦`);
      } catch { toast.error("Packing list failed — try again"); }
    }
    setPackingLoading(false);
  };

  // ── Toggle packing item ──────────────────────────────────────────
  const togglePacking = async (si: number, ii: number) => {
    if (!activeTrip) return;
    const updated_sections = activeTrip.packingList.map((s, sIdx) =>
      sIdx !== si ? s : { ...s, items: s.items.map((item, iIdx) => iIdx !== ii ? item : { ...item, checked: !item.checked }) }
    );
    const updated = { ...activeTrip, packingList: updated_sections };
    const all = trips.map(t => t.id === updated.id ? updated : t);
    await persist(all);
    setActiveTrip(normTrip(updated));
  };

  // ── Toggle pre-departure task ────────────────────────────────────
  const toggleTask = async (i: number) => {
    if (!activeTrip) return;
    const tasks = activeTrip.preDeparture.map((t, ti) => ti !== i ? t : { ...t, completed: !t.completed });
    const updated = { ...activeTrip, preDeparture: tasks };
    const all = trips.map(t => t.id === updated.id ? updated : t);
    await persist(all);
    setActiveTrip(normTrip(updated));
  };

  // ── Toggle document ──────────────────────────────────────────────
  const toggleDoc = async (i: number) => {
    if (!activeTrip) return;
    const cycle: TripDocument["status"][] = ["needed", "ready", "expired"];
    const docs = activeTrip.documents.map((d, di) =>
      di !== i ? d : { ...d, status: cycle[(cycle.indexOf(d.status) + 1) % 3] }
    );
    const updated = { ...activeTrip, documents: docs };
    const all = trips.map(t => t.id === updated.id ? updated : t);
    await persist(all);
    setActiveTrip(normTrip(updated));
  };

  // ── Ask CFO about trip ───────────────────────────────────────────
  const askCFO = async (question: string) => {
    if (!user?.uid) return;
    setCfoLoading(true);
    try {
      let snap = householdSnapshot;
      if (!snap) {
        snap = await buildHouseholdSnapshot(user.uid);
        setHouseholdSnapshot(snap);
      }
      const { result } = await analyzeScenario(question, snap, user.uid, (profile as any)?.name);
      setCfoResult(result);
    } catch { toast.error("CFO analysis failed"); }
    setCfoLoading(false);
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDER: TRIP LIST
  // ═══════════════════════════════════════════════════════════════════

  if (!activeTrip) {
    const upcoming = trips.filter(t => daysUntil(t.departureDate) >= -7 && t.state !== "completed");
    const past = trips.filter(t => t.state === "completed" || daysUntil(t.departureDate) < -7);

    return (
      <div style={{ animation: "fadeUp .45s ease both" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <PageTitle title="Trips">Trips</PageTitle>
          <button onClick={() => setShowAdd(!showAdd)}
            style={{ background: showAdd ? T.linen : T.esp, color: showAdd ? T.bark : "#fff", border: "none", borderRadius: 12, padding: "8px 16px", fontFamily: F.sans, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {showAdd ? "Cancel" : "+ Plan Trip"}
          </button>
        </div>

        {/* ── ADD TRIP FORM ────────────────────────────────────────── */}
        {showAdd && (
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 16px" }}>NEW TRIP</p>

            <input value={dest} onChange={e => setDest(e.target.value)}
              placeholder="Where to? (e.g. Lagos, Nigeria)"
              style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "12px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 12, boxSizing: "border-box" }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: T.taupe, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Departure</p>
                <input type="date" value={depDate} onChange={e => setDepDate(e.target.value)}
                  style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "10px 12px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: T.taupe, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Return</p>
                <input type="date" value={retDate} onChange={e => setRetDate(e.target.value)}
                  style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "10px 12px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 16 }}>
              <div>
                <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: T.taupe, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Currency</p>
                <select value={currency} onChange={e => setCurrency(e.target.value)}
                  style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "10px 12px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none" }}>
                  {["USD","GBP","EUR","NGN","CAD","AUD","ZAR"].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: T.taupe, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Budget</p>
                <input type="number" value={budget} onChange={e => setBudget(e.target.value)}
                  placeholder="e.g. 5000"
                  style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "10px 12px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>

            {/* Travellers — pre-populated from profile */}
            <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" }}>WHO'S COMING</p>
            <div style={{ marginBottom: 12 }}>
              {travellers.map((t, i) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.linen}` }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{t.type === "adult" ? "👩" : t.age < 2 ? "👶" : "🧒"}</span>
                  <input value={t.name} onChange={e => setTravellers(prev => prev.map((tt, ti) => ti === i ? { ...tt, name: e.target.value } : tt))}
                    placeholder="Name"
                    style={{ flex: 1, background: "none", border: "none", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none", minWidth: 0 }} />
                  <select value={t.type} onChange={e => setTravellers(prev => prev.map((tt, ti) => ti === i ? { ...tt, type: e.target.value as any } : tt))}
                    style={{ background: T.sand, border: `1px solid ${T.linen}`, borderRadius: 8, padding: "4px 8px", fontFamily: F.sans, fontSize: 11, color: T.taupe }}>
                    <option value="adult">Adult</option>
                    <option value="child">Child</option>
                    <option value="infant">Infant</option>
                  </select>
                  {!t.fromProfile && (
                    <button onClick={() => setTravellers(prev => prev.filter((_, ti) => ti !== i))}
                      style={{ background: "none", border: "none", color: T.taupe, cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[
                { label: "+ Partner", role: "partner", type: "adult" as const },
                { label: "+ Parent", role: "parent", type: "adult" as const },
                { label: "+ Friend", role: "friend", type: "adult" as const },
                { label: "+ Child", role: "kid", type: "child" as const },
              ].map(btn => (
                <button key={btn.label} onClick={() => setTravellers(prev => [...prev, {
                  id: crypto.randomUUID(), name: "", age: btn.type === "child" ? 8 : 35,
                  type: btn.type, role: btn.role as any, fromProfile: false,
                }])}
                  style={{ padding: "6px 12px", background: T.sand, border: `1px solid ${T.linen}`, borderRadius: 20, fontFamily: F.sans, fontSize: 11, color: T.bark, cursor: "pointer" }}>
                  {btn.label}
                </button>
              ))}
            </div>

            <button onClick={addTrip} disabled={!dest || !depDate}
              style={{ width: "100%", padding: "14px", background: dest && depDate ? T.esp : T.linen, color: "#fff", border: "none", borderRadius: 14, fontFamily: F.sans, fontSize: 14, fontWeight: 600, cursor: dest && depDate ? "pointer" : "not-allowed" }}>
              Add Trip ✦
            </button>
          </Card>
        )}

        {/* ── UPCOMING TRIPS ───────────────────────────────────────── */}
        {upcoming.length > 0 && (
          <>
            <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "20px 0 10px" }}>UPCOMING</p>
            {upcoming.map(trip => {
              const du = daysUntil(trip.departureDate);
              const state = computeTripState(trip);
              const cfg = STATE_CONFIG[state];
              const readiness = computeReadiness(trip);
              return (
                <div key={trip.id} onClick={() => { setActiveTrip(normTrip(trip)); setDetailTab("overview"); }}
                  style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: cfg.color, background: `${cfg.color}15`, padding: "2px 10px", borderRadius: 20 }}>
                          {cfg.emoji} {cfg.label}
                        </span>
                      </div>
                      <p style={{ fontFamily: F.serif, fontSize: 22, fontStyle: "italic", color: T.esp, margin: "0 0 2px", fontWeight: 500 }}>{trip.destination}</p>
                      <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: 0 }}>
                        {trip.nights} nights · {safeDate(trip.departureDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                    <ReadinessRing score={readiness.overall} size={64} />
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {trip.travellers.slice(0, 4).map((t, i) => (
                      <span key={i} style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, background: T.sand, padding: "3px 8px", borderRadius: 20 }}>
                        {t.type === "adult" ? "👩" : "🧒"} {t.name.split(" ")[0]}
                      </span>
                    ))}
                    {trip.travellers.length > 4 && (
                      <span style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe }}>+{trip.travellers.length - 4}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* ── PAST TRIPS ───────────────────────────────────────────── */}
        {past.length > 0 && (
          <>
            <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "20px 0 10px" }}>PAST</p>
            {past.map(trip => (
              <div key={trip.id} onClick={() => { setActiveTrip(normTrip(trip)); setDetailTab("overview"); }}
                style={{ background: T.sand, border: `1px solid ${T.linen}`, borderRadius: 16, padding: "14px 16px", marginBottom: 8, cursor: "pointer", opacity: 0.85 }}>
                <p style={{ fontFamily: F.serif, fontSize: 16, fontStyle: "italic", color: T.esp, margin: "0 0 2px" }}>{trip.destination}</p>
                <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>
                  {trip.nights} nights · {safeDate(trip.departureDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                </p>
              </div>
            ))}
          </>
        )}

        {trips.length === 0 && !showAdd && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <p style={{ fontSize: 48, marginBottom: 12 }}>✈</p>
            <p style={{ fontFamily: F.serif, fontSize: 22, fontStyle: "italic", color: T.esp, margin: "0 0 8px" }}>Where next?</p>
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: "0 0 20px" }}>Plan a trip and Nora will help reduce the stress of every step.</p>
            <button onClick={() => setShowAdd(true)}
              style={{ background: T.esp, color: "#fff", border: "none", borderRadius: 14, padding: "12px 24px", fontFamily: F.sans, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Plan a trip ✦
            </button>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDER: TRIP DETAIL
  // ═══════════════════════════════════════════════════════════════════

  const trip = activeTrip;
  const du = daysUntil(trip.departureDate);
  const state = computeTripState(trip);
  const cfg = STATE_CONFIG[state];
  const readiness = computeReadiness(trip);
  const totalItems = trip.packingList.flatMap(s => s.items).length;
  const checkedItems = trip.packingList.flatMap(s => s.items).filter(i => i.checked).length;
  const completedTasks = trip.preDeparture.filter(t => t.completed).length;
  const docsReady = trip.documents.filter(d => d.status === "ready").length;

  const CATEGORY_ICONS: Record<string, string> = {
    booking: "◈", document: "◎", health: "◦", packing: "🧳", home: "◉", notification: "◆",
  };

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <button onClick={() => { setActiveTrip(null); setCfoResult(null); }}
        style={{ background: "none", border: "none", fontFamily: F.sans, fontSize: 13, color: T.taupe, cursor: "pointer", marginBottom: 12, padding: "8px 0", minHeight: 44, touchAction: "manipulation" }}>
        ← All trips
      </button>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <div style={{ background: `linear-gradient(135deg, ${T.esp}, #3D2E22)`, borderRadius: 20, padding: "20px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: cfg.color, background: `${cfg.color}25`, padding: "3px 10px", borderRadius: 20 }}>
              {cfg.emoji} {cfg.label}
            </span>
            <p style={{ fontFamily: F.serif, fontSize: 28, fontStyle: "italic", color: "#fff", margin: "8px 0 4px", fontWeight: 500 }}>{trip.destination}</p>
            <p style={{ fontFamily: F.sans, fontSize: 12, color: "rgba(255,255,255,0.6)", margin: 0 }}>
              {trip.nights} nights · {safeDate(trip.departureDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
            {du > 0 && (
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.gold, margin: "6px 0 0", fontWeight: 600 }}>
                {du === 1 ? "Tomorrow!" : `${du} days away`}
              </p>
            )}
            {du === 0 && (
              <p style={{ fontFamily: F.sans, fontSize: 14, color: "#dc2626", margin: "6px 0 0", fontWeight: 700 }}>✈ TRAVEL DAY</p>
            )}
          </div>
          <ReadinessRing score={readiness.overall} size={80} />
        </div>
      </div>

      {/* ── TABS ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
        {(["overview", "itinerary", "packing", "checklist", "budget", "ask"] as const).map(t => (
          <Pill key={t} active={detailTab === t} onClick={() => setDetailTab(t)}
            label={
              t === "overview" ? "Overview" :
              t === "itinerary" ? "📅 Itinerary" :
              t === "packing" ? `🧳 Pack${totalItems > 0 ? ` ${checkedItems}/${totalItems}` : ""}` :
              t === "checklist" ? `✓ Prep${completedTasks > 0 ? ` ${completedTasks}/${trip.preDeparture.length}` : ""}` :
              t === "budget" ? "💰 Budget" : "✦ Ask CFO"
            } />
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          TAB: OVERVIEW
      ══════════════════════════════════════════════════════════════ */}
      {detailTab === "overview" && (
        <>
          {/* Readiness breakdown */}
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>TRIP READINESS</p>
            {[
              { label: "Documents",  value: readiness.documents, icon: "◎" },
              { label: "Budget set", value: readiness.budget,    icon: "💰" },
              { label: "Packing",    value: readiness.packing,   icon: "🧳" },
              { label: "Booking",    value: readiness.booking,   icon: "◈" },
              { label: "Prep tasks", value: readiness.tasks,     icon: "✓" },
            ].map(r => (
              <div key={r.label} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontFamily: F.sans, fontSize: 12, color: T.bark }}>{r.icon} {r.label}</span>
                  <span style={{ fontFamily: F.sans, fontSize: 12, color: r.value >= 80 ? T.sage : r.value >= 40 ? T.gold : T.blush, fontWeight: 600 }}>{r.value}%</span>
                </div>
                <ProgressBar value={r.value} max={100} color={r.value >= 80 ? T.sage : r.value >= 40 ? T.gold : T.blush} height={4} />
              </div>
            ))}
          </Card>

          {/* Travellers */}
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>TRAVELLERS</p>
            {trip.travellers.map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: `1px solid ${T.linen}` }}>
                <span style={{ fontSize: 20 }}>{t.type === "adult" ? "👩" : t.age < 2 ? "👶" : "🧒"}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>{t.name}</p>
                  <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0, textTransform: "capitalize" }}>{t.role || t.type} · {t.age}y</p>
                </div>
              </div>
            ))}
          </Card>

          {/* Documents */}
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>DOCUMENTS</p>
            {trip.documents.map((doc, i) => {
              const statusColor = { needed: T.blush, ready: T.sage, expired: "#dc2626" }[doc.status];
              return (
                <div key={i} onClick={() => toggleDoc(i)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.linen}`, cursor: "pointer" }}>
                  <span style={{ fontSize: 18 }}>{doc.type === "passport" ? "◈" : doc.type === "insurance" ? "◉" : "◎"}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0, textTransform: "capitalize" }}>
                      {doc.type}{doc.traveller ? ` — ${doc.traveller}` : ""}
                    </p>
                  </div>
                  <span style={{ background: `${statusColor}20`, color: statusColor, fontFamily: F.sans, fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, textTransform: "capitalize" }}>
                    {doc.status}
                  </span>
                </div>
              );
            })}
            <p style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, margin: "8px 0 0", textAlign: "center" }}>Tap to update status</p>
          </Card>

          {/* Generate buttons */}
          {!trip.itinerary.length && (
            <Button onClick={() => generateItinerary(trip)} disabled={planning} variant="gold">
              {planning ? "✦ Planning itinerary..." : "✦ Generate Itinerary"}
            </Button>
          )}
          {!trip.packingList.length && (
            <Button onClick={() => generatePackingList(trip)} disabled={packingLoading} variant="secondary" style={{ marginTop: 8 }}>
              {packingLoading ? "✦ Building packing list..." : "✦ Generate Packing List"}
            </Button>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB: ITINERARY
      ══════════════════════════════════════════════════════════════ */}
      {detailTab === "itinerary" && (
        <>
          {trip.itinerary.length ? trip.itinerary.map((day, i) => (
            <Card key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 2px" }}>DAY {day.day}</p>
                  <p style={{ fontFamily: F.serif, fontSize: 16, fontStyle: "italic", color: T.esp, margin: 0 }}>{day.theme}</p>
                </div>
                <span style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe }}>{day.date}</span>
              </div>
              {[
                { label: "Morning",   value: day.morning,   icon: "☀" },
                { label: "Afternoon", value: day.afternoon, icon: "◎" },
                { label: "Evening",   value: day.evening,   icon: "✦" },
              ].map(slot => (
                <div key={slot.label} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.linen}` }}>
                  <span style={{ fontSize: 14, width: 20, flexShrink: 0 }}>{slot.icon}</span>
                  <div>
                    <p style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{slot.label}</p>
                    <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0, lineHeight: 1.5 }}>{slot.value}</p>
                  </div>
                </div>
              ))}
              {day.mumMoment && (
                <div style={{ marginTop: 10, padding: "10px 12px", background: `${T.gold}10`, borderRadius: 10, borderLeft: `3px solid ${T.gold}` }}>
                  <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: T.gold, margin: "0 0 3px", textTransform: "uppercase", letterSpacing: "0.08em" }}>✦ MUM MOMENT</p>
                  <p style={{ fontFamily: F.sans, fontSize: 12, color: T.bark, margin: 0, lineHeight: 1.5 }}>{day.mumMoment}</p>
                </div>
              )}
              {day.tip && (
                <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "10px 0 0", fontStyle: "italic" }}>💡 {day.tip}</p>
              )}
            </Card>
          )) : (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, marginBottom: 16 }}>No itinerary yet — let Nora plan your days.</p>
              <Button onClick={() => generateItinerary(trip)} disabled={planning} variant="gold">
                {planning ? "Planning..." : "✦ Generate Itinerary"}
              </Button>
            </div>
          )}
          {trip.itinerary.length > 0 && (
            <button onClick={() => generateItinerary(trip)} disabled={planning}
              style={{ width: "100%", marginTop: 8, padding: "10px", background: "none", border: `1px solid ${T.linen}`, borderRadius: 12, fontFamily: F.sans, fontSize: 12, color: T.taupe, cursor: "pointer" }}>
              {planning ? "Regenerating..." : "↻ Regenerate itinerary"}
            </button>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB: PACKING
      ══════════════════════════════════════════════════════════════ */}
      {detailTab === "packing" && (
        <>
          {trip.packingList.length ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <AIBadge label="Packed by Nora" />
                <button onClick={() => generatePackingList(trip)} disabled={packingLoading}
                  style={{ background: "none", border: `1px solid ${T.linen}`, borderRadius: 10, padding: "6px 12px", fontFamily: F.sans, fontSize: 11, color: T.taupe, cursor: "pointer" }}>
                  {packingLoading ? "..." : "↻ Redo"}
                </button>
              </div>
              {trip.packingList.map((sec, si) => {
                const secChecked = sec.items.filter(i => i.checked).length;
                return (
                  <Card key={si}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: 0 }}>
                        {sec.name}
                      </p>
                      <span style={{ fontFamily: F.sans, fontSize: 11, color: T.gold }}>{secChecked}/{sec.items.length}</span>
                    </div>
                    <ProgressBar value={secChecked} max={sec.items.length} color={T.gold} height={4} />
                    <div style={{ marginTop: 10 }}>
                      {sec.items.map((item, ii) => (
                        <div key={ii} onClick={() => togglePacking(si, ii)}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: `1px solid ${T.linen}`, cursor: "pointer", touchAction: "manipulation" }}>
                          <div style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${item.checked ? T.sage : item.essential ? "#dc2626" : T.linen}`, background: item.checked ? T.sage : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13 }}>
                            {item.checked ? "✓" : ""}
                          </div>
                          <p style={{ fontFamily: F.sans, fontSize: 13, color: item.checked ? T.taupe : T.esp, margin: 0, flex: 1, textDecoration: item.checked ? "line-through" : "none" }}>
                            {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}
                          </p>
                          {item.essential && !item.checked && <span style={{ fontFamily: F.sans, fontSize: 9, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.08em" }}>essential</span>}
                          {item.weatherDependent && <span style={{ fontSize: 12 }}>🌤</span>}
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, marginBottom: 16 }}>Nora will build a smart packing list for your family.</p>
              <Button onClick={() => generatePackingList(trip)} disabled={packingLoading} variant="gold">
                {packingLoading ? "Building list..." : "✦ Generate Packing List"}
              </Button>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB: CHECKLIST
      ══════════════════════════════════════════════════════════════ */}
      {detailTab === "checklist" && (
        <Card>
          <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 4px" }}>PRE-DEPARTURE</p>
          <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 16px" }}>{completedTasks} of {trip.preDeparture.length} complete</p>
          <ProgressBar value={completedTasks} max={trip.preDeparture.length} color={T.sage} height={6} />
          <div style={{ marginTop: 16 }}>
            {trip.preDeparture.map((task, i) => (
              <div key={i} onClick={() => toggleTask(i)}
                style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.linen}`, cursor: "pointer", touchAction: "manipulation" }}>
                <div style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${task.completed ? T.sage : T.linen}`, background: task.completed ? T.sage : "transparent", flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13 }}>
                  {task.completed ? "✓" : ""}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: F.sans, fontSize: 13, color: task.completed ? T.taupe : T.esp, margin: "0 0 2px", textDecoration: task.completed ? "line-through" : "none" }}>{task.task}</p>
                  <p style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, margin: 0 }}>{CATEGORY_ICONS[task.category]} {task.deadline}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB: BUDGET
      ══════════════════════════════════════════════════════════════ */}
      {detailTab === "budget" && (
        <>
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>TRIP BUDGET</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 16 }}>
              <span style={{ fontFamily: F.serif, fontSize: 34, fontWeight: 700, color: T.esp }}>{trip.budget.currency}{trip.budget.total.toLocaleString()}</span>
              <span style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe }}>total</span>
            </div>
            {Object.entries(trip.budget.breakdown).map(([key, val]) => {
              const pct = trip.budget.total > 0 ? Math.round((val / trip.budget.total) * 100) : 0;
              return (
                <div key={key} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontFamily: F.sans, fontSize: 12, color: T.bark, textTransform: "capitalize" }}>{key}</span>
                    <span style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, fontWeight: 600 }}>{trip.budget.currency}{val.toLocaleString()} · {pct}%</span>
                  </div>
                  <ProgressBar value={pct} max={100} color={T.gold} height={4} />
                </div>
              );
            })}
          </Card>
          <button onClick={() => askCFO(`Can we afford a ${trip.nights}-night trip to ${trip.destination} costing ${trip.budget.currency}${trip.budget.total}?`)}
            style={{ width: "100%", padding: "12px", background: T.esp, color: "#fff", border: "none", borderRadius: 14, fontFamily: F.sans, fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8 }}>
            ✦ Ask CFO: Can we afford this?
          </button>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          TAB: ASK CFO
      ══════════════════════════════════════════════════════════════ */}
      {detailTab === "ask" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {[
              `Can we afford this ${trip.destination} trip?`,
              `What's the impact on our emergency fund?`,
              `Should we delay or book now?`,
              `How does this affect our savings goals?`,
            ].map((q, i) => (
              <button key={i} onClick={() => askCFO(q)} disabled={cfoLoading}
                style={{ textAlign: "left", padding: "12px 14px", background: T.sand, border: `1px solid ${T.linen}`, borderRadius: 12, fontFamily: F.sans, fontSize: 13, color: T.esp, cursor: "pointer", lineHeight: 1.4 }}>
                {q} →
              </button>
            ))}
          </div>

          {cfoLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px" }}>
              <Spinner size={16} />
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0 }}>Analyzing household finances...</p>
            </div>
          )}

          {cfoResult && !cfoLoading && (
            <Card>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: `${cfoResult.riskLevel === "low" ? T.sage : cfoResult.riskLevel === "high" ? T.blush : T.gold}20`, color: cfoResult.riskLevel === "low" ? T.sage : cfoResult.riskLevel === "high" ? T.blush : T.gold, textTransform: "uppercase" }}>
                  {cfoResult.riskLevel} risk
                </span>
                <span style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: `${T.gold}15`, color: T.gold, textTransform: "uppercase" }}>
                  {cfoResult.confidence} confidence
                </span>
              </div>
              <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.esp, margin: "0 0 10px", lineHeight: 1.6 }}>{cfoResult.summary}</p>
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.bark, margin: "0 0 8px", lineHeight: 1.6 }}>{cfoResult.observation}</p>
              {cfoResult.tradeoffs?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {cfoResult.tradeoffs.map((t: string, i: number) => (
                    <p key={i} style={{ fontFamily: F.sans, fontSize: 12, color: T.bark, margin: "0 0 4px", paddingLeft: 10, borderLeft: `2px solid ${T.linen}` }}>{t}</p>
                  ))}
                </div>
              )}
              <div style={{ padding: "10px 12px", background: `${T.esp}08`, borderRadius: 10, borderLeft: `3px solid ${T.esp}` }}>
                <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: T.taupe, margin: "0 0 4px" }}>RECOMMENDATION</p>
                <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>✦ {cfoResult.recommendedAction}</p>
              </div>
              <button onClick={() => setCfoResult(null)} style={{ marginTop: 10, background: "none", border: "none", fontFamily: F.sans, fontSize: 11, color: T.taupe, cursor: "pointer" }}>Ask another →</button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
