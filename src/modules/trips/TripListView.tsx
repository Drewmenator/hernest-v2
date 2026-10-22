import React from "react";
import { T, F, S, TYPE, R, alpha } from "../../config/theme";
import { Card, PageTitle, SectionHeader, ListRow, Button, Pill, Input, CheckBox, EmptyState, GlowCard, Headline, Detail, Emoji } from "../../shared/components";
import { safeDate, daysUntil, computeTripState, computeReadiness, normTrip, STATE_CONFIG } from "./tripsShared";
import type { Trip, Traveller } from "./tripsShared";
import { ReadinessRing, TripStageChip, TravelerAvatars } from "./ReadinessRing";

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
  setDetailTab: React.Dispatch<React.SetStateAction<"overview" | "itinerary" | "packing" | "checklist" | "budget" | "edit">>;
}) {
  const upcoming = trips.filter(t => daysUntil(t.departureDate) >= -7 && t.state !== "completed");
  const past = trips.filter(t => t.state === "completed" || daysUntil(t.departureDate) < -7);

  const fieldLabel: React.CSSProperties = { display: "block", fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text, margin: "0 0 6px" };
  const open = (trip: Trip) => { setActiveTrip(normTrip(trip)); setDetailTab("overview"); };

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      {/* Household state banner */}
      {householdSnapshot?.householdStressLevel === "high" && (
        <div style={{ background: alpha(T.blush, 0.10), border: `1px solid ${alpha(T.blush, 0.22)}`, borderRadius: R.button, padding: "10px 14px", marginBottom: S.md, display: "flex", alignItems: "center", gap: 10 }}>
          <Emoji e="💛" size={18} />
          <p style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text, margin: 0, lineHeight: 1.5 }}>
            Things look heavy right now. Focus on what matters most, Cleo's got the rest.
          </p>
        </div>
      )}
      {householdSnapshot?.calendarLoad === "critical" && householdSnapshot?.householdStressLevel !== "high" && (
        <div style={{ background: T.warnBg, border: `1px solid ${alpha(T.warn, 0.25)}`, borderRadius: R.button, padding: "10px 14px", marginBottom: S.md, display: "flex", alignItems: "center", gap: 10 }}>
          <Emoji e="📅" size={18} />
          <p style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text, margin: 0, lineHeight: 1.5 }}>
            Busy week ahead. Consider what can wait until next week.
          </p>
        </div>
      )}

      <PageTitle title="Trips" right={
        <Button size="sm" variant={showAdd ? "secondary" : "primary"} onClick={() => setShowAdd(!showAdd)} style={{ width: "auto" }}>
          {showAdd ? "Cancel" : "Plan a trip"}
        </Button>
      } />

      {/* ── ADD TRIP FORM ────────────────────────────────────────── */}
      {showAdd && (
        <Card>
          <h2 style={{ fontFamily: F.display, fontSize: TYPE.section, fontWeight: 500, color: T.text, margin: `0 0 ${S.lg}px` }}>New trip</h2>

          <div style={{ marginBottom: S.md }}>
            <Input label="Where to?" value={dest} onChange={setDest} placeholder="Where to? (e.g. Lagos, Nigeria)" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginBottom: S.md }}>
            <Input label="Departure" type="date" value={depDate} onChange={setDepDate} style={{ minWidth: 0, padding: "12px 10px", fontSize: 15 }} />
            <Input label="Return" type="date" value={retDate} onChange={setRetDate} style={{ minWidth: 0, padding: "12px 10px", fontSize: 15 }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr)", gap: 10, marginBottom: S.lg }}>
            <div>
              <label htmlFor="trip-currency" style={fieldLabel}>Currency</label>
              <select id="trip-currency" value={currency} onChange={e => setCurrency(e.target.value)}
                style={{ width: "100%", background: T.surface, border: `1.5px solid ${T.divider}`, borderRadius: R.button, padding: "12px 10px", minHeight: 48, fontFamily: F.sans, fontSize: 16, color: T.text, outline: "none", boxSizing: "border-box" }}>
                {["USD","GBP","EUR","NGN","CAD","AUD","ZAR"].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <Input label="Total budget" type="number" value={budget} onChange={setBudget} placeholder="e.g. 5000" />
          </div>

          {/* Travellers: select from profile + add guests */}
          <p style={fieldLabel}>Who's coming</p>
          <div style={{ marginBottom: S.md }}>
            {travellers.map((t, i) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${T.divider}` }}>
                {t.fromProfile ? (
                  <CheckBox checked={(t as any).selected !== false} label={`Include ${t.name || "traveler"}`}
                    onToggle={() => setTravellers(prev => prev.map((tt, ti) => ti === i ? { ...tt, selected: !(tt as any).selected } : tt))} />
                ) : (
                  <button onClick={() => setTravellers(prev => prev.filter((_, ti) => ti !== i))} aria-label={`Remove ${t.name || "traveler"}`}
                    style={{ width: 26, height: 26, borderRadius: 8, border: `2px solid ${alpha(T.blush, 0.35)}`, background: "none", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: T.blush, fontSize: 16, cursor: "pointer" }}>
                    ×
                  </button>
                )}
                <span style={{ flexShrink: 0, display: "inline-flex", marginLeft: t.fromProfile ? 8 : 0 }}><Emoji e={t.type === "adult" ? "👩" : t.age < 2 ? "👶" : "🧒"} size={18} /></span>
                <input value={t.name} onChange={e => setTravellers(prev => prev.map((tt, ti) => ti === i ? { ...tt, name: e.target.value } : tt))}
                  placeholder="Name" aria-label="Traveler name"
                  style={{ flex: 1, background: "none", border: "none", fontFamily: F.sans, fontSize: 16, color: T.text, outline: "none", minWidth: 0 }} />
                <select value={t.type} onChange={e => setTravellers(prev => prev.map((tt, ti) => ti === i ? { ...tt, type: e.target.value as any } : tt))}
                  aria-label="Traveler type"
                  style={{ background: T.sand, border: `1px solid ${T.divider}`, borderRadius: 8, padding: "6px 8px", fontFamily: F.sans, fontSize: 14, color: T.text2 }}>
                  <option value="adult">Adult</option>
                  <option value="child">Child</option>
                  <option value="infant">Infant</option>
                </select>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: S.lg, flexWrap: "wrap" }}>
            {[
              { label: "+ Partner", role: "partner", type: "adult" as const },
              { label: "+ Parent", role: "parent", type: "adult" as const },
              { label: "+ Friend", role: "friend", type: "adult" as const },
              { label: "+ Child", role: "kid", type: "child" as const },
            ].map(btn => (
              <Pill key={btn.label} label={btn.label} onClick={() => setTravellers(prev => [...prev, {
                id: crypto.randomUUID(), name: "", age: btn.type === "child" ? 8 : 35,
                type: btn.type, role: btn.role as any, fromProfile: false,
              }])} />
            ))}
          </div>

          <Button onClick={addTrip} disabled={!dest || !depDate}>Add trip</Button>
        </Card>
      )}

      {/* ── UPCOMING TRIPS ───────────────────────────────────────── */}
      {upcoming.length > 0 && (
        <>
          <SectionHeader title="Upcoming" style={{ marginTop: S.lg }} />
          {upcoming.map(trip => {
            const state = computeTripState(trip);
            const cfg = STATE_CONFIG[state];
            const readiness = computeReadiness(trip);
            return (
              <GlowCard key={trip.id} tint="cleo" onClick={() => open(trip)} ariaLabel={`View trip to ${trip.destination}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: S.md, marginBottom: S.md }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ marginBottom: 8 }}><TripStageChip label={cfg.label} color={cfg.color} bg={cfg.bg} /></div>
                    <Headline size={26}>{trip.destination}</Headline>
                    <Detail>
                      {trip.nights} nights · {safeDate(trip.departureDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </Detail>
                  </div>
                  <ReadinessRing score={readiness.overall} size={72} />
                </div>
                <TravelerAvatars names={trip.travellers.map(t => t.name)} />
              </GlowCard>
            );
          })}
        </>
      )}

      {/* ── PAST TRIPS ───────────────────────────────────────────── */}
      {past.length > 0 && (
        <>
          <SectionHeader title="Past" />
          <Card style={{ paddingTop: 0, paddingBottom: 0 }}>
            {past.map((trip, i) => (
              <ListRow key={trip.id} divider={i > 0} onClick={() => open(trip)} ariaLabel={`View trip to ${trip.destination}`}
                leading={<Emoji e="✈" tile size={16} />}
                title={trip.destination}
                detail={`${trip.nights} nights · ${safeDate(trip.departureDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`} />
            ))}
          </Card>
        </>
      )}

      {trips.length > 0 && !showAdd && (
        <Button variant="ghost" onClick={() => setShowAdd(true)} style={{ marginTop: S.sm }}>Plan another trip</Button>
      )}

      {trips.length === 0 && !showAdd && (
        <EmptyState
          icon={<Emoji e="✈" size={26} />}
          title="Where next?"
          body="Plan a trip and I'll help carry the load at every step: packing, prep, and budget."
          actionLabel="Plan a trip"
          onAction={() => setShowAdd(true)}
        />
      )}
    </div>
  );
}
