import React, { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { saveData, loadData } from "../../core/firebase";
import { ai } from "../../core/ai";
import { bus } from "../../core/events";
import { analyzeScenario, buildHouseholdSnapshot } from "../../core/household";
import toast from "react-hot-toast";
import {
  safeDate, daysUntil, computeTripState, computeReadiness,
  estimateBudgetBreakdown, normTrip, STATE_CONFIG, PRE_DEPARTURE_TASKS,
} from "./tripsShared";
import type { Trip, Traveller, TripDocument, PackingSection } from "./tripsShared";
import { ReadinessRing } from "./ReadinessRing";
import { TripListView } from "./TripListView";
import { TripDetailTabs } from "./TripDetailTabs";

export type { TripState } from "./tripsShared";

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function TripsScreen() {
  const { user, profile, familyMembers, householdSnapshot, setHouseholdSnapshot } = useStore();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "itinerary" | "packing" | "checklist" | "budget" | "ask" | "edit">("overview");
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
      travellers: travellers.filter(t => t.name.trim() && (t as any).selected !== false),
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

    const sys = `You are Cleo, a family travel planner. Return ONLY valid JSON:
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

    const sys = `You are Cleo. Generate a smart family packing list. Return ONLY valid JSON:
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
    return (
      <TripListView
        trips={trips} householdSnapshot={householdSnapshot}
        showAdd={showAdd} setShowAdd={setShowAdd}
        dest={dest} setDest={setDest}
        depDate={depDate} setDepDate={setDepDate}
        retDate={retDate} setRetDate={setRetDate}
        budget={budget} setBudget={setBudget}
        currency={currency} setCurrency={setCurrency}
        travellers={travellers} setTravellers={setTravellers}
        addTrip={addTrip}
        setActiveTrip={setActiveTrip} setDetailTab={setDetailTab}
      />
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 16 }}>
        {([
          { id: "overview",  label: "Overview" },
          { id: "itinerary", label: "📅 Itinerary" },
          { id: "packing",   label: `🧳 Pack${totalItems > 0 ? ` ${checkedItems}/${totalItems}` : ""}` },
          { id: "checklist", label: `✓ Prep${completedTasks > 0 ? ` ${completedTasks}/${trip.preDeparture.length}` : ""}` },
          { id: "budget",    label: "💰 Budget" },
          { id: "ask",       label: "✦ Ask CFO" },
          { id: "edit",      label: "✎ Edit" },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setDetailTab(t.id as any)}
            style={{ padding: "8px 4px", borderRadius: 10, border: `1.5px solid ${detailTab === t.id ? T.esp : T.linen}`, background: detailTab === t.id ? T.esp : "#fff", fontFamily: F.sans, fontSize: 11, fontWeight: detailTab === t.id ? 700 : 400, color: detailTab === t.id ? "#fff" : T.taupe, cursor: "pointer", textAlign: "center" }}>
            {t.label}
          </button>
        ))}
      </div>

      <TripDetailTabs
        detailTab={detailTab} trip={trip} trips={trips}
        persist={persist} setActiveTrip={setActiveTrip}
        readiness={readiness} completedTasks={completedTasks}
        planning={planning} packingLoading={packingLoading}
        cfoLoading={cfoLoading} cfoResult={cfoResult} setCfoResult={setCfoResult}
        generateItinerary={generateItinerary} generatePackingList={generatePackingList}
        togglePacking={togglePacking} toggleTask={toggleTask} toggleDoc={toggleDoc}
        askCFO={askCFO}
      />
    </div>
  );
}
