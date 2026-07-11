import React from "react";
import { T, F } from "../../config/theme";
import { Card, PageTitle, EmptyState } from "../../shared/components";
import { safeDate, daysUntil, computeTripState, computeReadiness, normTrip, STATE_CONFIG } from "./tripsShared";
import type { Trip, Traveller } from "./tripsShared";
import { ReadinessRing } from "./ReadinessRing";

export function TripListView({
  trips, householdSnapshot, showAdd, setShowAdd,
  dest, setDest, depDate, setDepDate, retDate, setRetDate,
  budget, setBudget, currency, setCurrency, travellers, setTravellers,
  addTrip, setActiveTrip, setDetailTab,
}: {
  trips: Trip[]; householdSnapshot: any;
  showAdd: boolean; setShowAdd: React.Dispatch<React.SetStateAction<boolean>>;
  dest: string; setDest: React.Dispatch<React.SetStateAction<string>>;
  depDate: string; setDepDate: React.Dispatch<React.SetStateAction<string>>;
  retDate: string; setRetDate: React.Dispatch<React.SetStateAction<string>>;
  budget: string; setBudget: React.Dispatch<React.SetStateAction<string>>;
  currency: string; setCurrency: React.Dispatch<React.SetStateAction<string>>;
  travellers: Traveller[]; setTravellers: React.Dispatch<React.SetStateAction<Traveller[]>>;
  addTrip: () => Promise<void>;
  setActiveTrip: React.Dispatch<React.SetStateAction<Trip | null>>;
  setDetailTab: React.Dispatch<React.SetStateAction<"overview" | "itinerary" | "packing" | "checklist" | "budget" | "ask" | "edit">>;
}) {
  const upcoming = trips.filter(t => daysUntil(t.departureDate) >= -7 && t.state !== "completed");
  const past = trips.filter(t => t.state === "completed" || daysUntil(t.departureDate) < -7);

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
    {/* Household state banner */}
    {householdSnapshot?.householdStressLevel === "high" && (
      <div style={{ background:`${T.blush}15`, border:`1px solid ${T.blush}30`, borderRadius:12, padding:"10px 14px", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:16 }}>💛</span>
        <p style={{ fontFamily:F.sans, fontSize:12, color:T.bark, margin:0, lineHeight:1.5 }}>
          Things look heavy right now. Focus on what matters most — Cleo's got the rest.
        </p>
      </div>
    )}
    {householdSnapshot?.calendarLoad === "critical" && householdSnapshot?.householdStressLevel !== "high" && (
      <div style={{ background:`${T.gold}12`, border:`1px solid ${T.gold}30`, borderRadius:12, padding:"10px 14px", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:16 }}>📅</span>
        <p style={{ fontFamily:F.sans, fontSize:12, color:T.bark, margin:0, lineHeight:1.5 }}>
          Busy week ahead — consider what can wait until next week.
        </p>
      </div>
    )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <PageTitle title="Trips" />
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
                style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "10px 12px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div>
              <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: T.taupe, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Return</p>
              <input type="date" value={retDate} onChange={e => setRetDate(e.target.value)}
                style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "10px 12px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", boxSizing: "border-box" }} />
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
                style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "10px 12px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", boxSizing: "border-box" }} />
            </div>
          </div>

          {/* Travellers — select from profile + add guests */}
          <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" }}>WHO'S COMING</p>
          <div style={{ marginBottom: 12 }}>
            {travellers.map((t, i) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.linen}` }}>
                {t.fromProfile ? (
                  <button onClick={() => setTravellers(prev => prev.map((tt, ti) => ti === i ? { ...tt, selected: !(tt as any).selected } : tt))}
                    style={{ width: 24, height: 24, borderRadius: 8, border: `2px solid ${(t as any).selected === false ? T.linen : T.sage}`, background: (t as any).selected === false ? "transparent" : T.sage, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, cursor: "pointer" }}>
                    {(t as any).selected !== false ? "✓" : ""}
                  </button>
                ) : (
                  <button onClick={() => setTravellers(prev => prev.filter((_, ti) => ti !== i))}
                    style={{ width: 24, height: 24, borderRadius: 8, border: `2px solid ${T.blush}40`, background: "none", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: T.blush, fontSize: 14, cursor: "pointer" }}>
                    ×
                  </button>
                )}
                <span style={{ fontSize: 18, flexShrink: 0 }}>{t.type === "adult" ? "👩" : t.age < 2 ? "👶" : "🧒"}</span>
                <input value={t.name} onChange={e => setTravellers(prev => prev.map((tt, ti) => ti === i ? { ...tt, name: e.target.value } : tt))}
                  placeholder="Name"
                  style={{ flex: 1, background: "none", border: "none", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", minWidth: 0 }} />
                <select value={t.type} onChange={e => setTravellers(prev => prev.map((tt, ti) => ti === i ? { ...tt, type: e.target.value as any } : tt))}
                  style={{ background: T.sand, border: `1px solid ${T.linen}`, borderRadius: 8, padding: "4px 8px", fontFamily: F.sans, fontSize: 11, color: T.taupe }}>
                  <option value="adult">Adult</option>
                  <option value="child">Child</option>
                  <option value="infant">Infant</option>
                </select>
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

      {trips.length > 0 && !showAdd && (
        <button onClick={() => setShowAdd(true)}
          style={{ width:"100%", marginTop:8, padding:"14px", background:"none", border:`1.5px dashed ${T.linen}`, borderRadius:16, fontFamily:F.sans, fontSize:13, color:T.taupe, cursor:"pointer", touchAction:"manipulation" }}>
          + Plan another trip
        </button>
      )}

      {trips.length === 0 && !showAdd && (
        <EmptyState
          icon="→"
          title="Where next?"
          body="Plan a trip and I'll help carry the load at every step — packing, prep, and budget ✦"
          actionLabel="Plan a trip ✦"
          onAction={() => setShowAdd(true)}
        />
      )}
    </div>
  );
}
