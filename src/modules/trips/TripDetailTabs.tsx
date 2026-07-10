import React from "react";
import { T, F } from "../../config/theme";
import { Card, AIBadge, Spinner, ProgressBar, Button } from "../../shared/components";
import { estimateBudgetBreakdown, normTrip } from "./tripsShared";
import type { Trip, ReadinessScore } from "./tripsShared";

const CATEGORY_ICONS: Record<string, string> = {
  booking: "◈", document: "◎", health: "◦", packing: "🧳", home: "◉", notification: "◆",
};

export function TripDetailTabs({
  detailTab, trip, trips, persist, setActiveTrip, readiness, completedTasks,
  planning, packingLoading, cfoLoading, cfoResult, setCfoResult,
  generateItinerary, generatePackingList, togglePacking, toggleTask, toggleDoc, askCFO,
}: {
  detailTab: "overview" | "itinerary" | "packing" | "checklist" | "budget" | "ask" | "edit";
  trip: Trip; trips: Trip[];
  persist: (updated: Trip[]) => Promise<void>;
  setActiveTrip: React.Dispatch<React.SetStateAction<Trip | null>>;
  readiness: ReadinessScore; completedTasks: number;
  planning: boolean; packingLoading: boolean; cfoLoading: boolean;
  cfoResult: any; setCfoResult: React.Dispatch<React.SetStateAction<any>>;
  generateItinerary: (trip: Trip) => Promise<void>;
  generatePackingList: (trip: Trip) => Promise<void>;
  togglePacking: (si: number, ii: number) => Promise<void>;
  toggleTask: (i: number) => Promise<void>;
  toggleDoc: (i: number) => Promise<void>;
  askCFO: (question: string) => Promise<void>;
}) {
  return (
    <>
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
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, marginBottom: 16 }}>No itinerary yet — let Cleo plan your days.</p>
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
                <AIBadge label="Packed by Cleo" />
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
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, marginBottom: 16 }}>Cleo will build a smart packing list for your family.</p>
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
          TAB: EDIT
      ══════════════════════════════════════════════════════════════ */}
      {detailTab === "edit" && (
        <Card>
          <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 16px" }}>EDIT TRIP</p>
          <input defaultValue={trip.destination}
            onBlur={async e => { const updated = { ...trip, destination: e.target.value }; const all = trips.map(t => t.id === updated.id ? updated : t); await persist(all); setActiveTrip(normTrip(updated)); }}
            style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "12px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 12, boxSizing: "border-box" as any }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: T.taupe, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Departure</p>
              <input type="date" defaultValue={trip.departureDate}
                onBlur={async e => { const updated = { ...trip, departureDate: e.target.value }; const all = trips.map(t => t.id === updated.id ? updated : t); await persist(all); setActiveTrip(normTrip(updated)); }}
                style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "10px 12px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none", boxSizing: "border-box" as any }} />
            </div>
            <div>
              <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: T.taupe, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Return</p>
              <input type="date" defaultValue={trip.returnDate}
                onBlur={async e => { const updated = { ...trip, returnDate: e.target.value }; const all = trips.map(t => t.id === updated.id ? updated : t); await persist(all); setActiveTrip(normTrip(updated)); }}
                style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "10px 12px", fontFamily: F.sans, fontSize: 14, color: T.esp, outline: "none", boxSizing: "border-box" as any }} />
            </div>
          </div>
          <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: T.taupe, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Budget</p>
          <input type="number" defaultValue={trip.budget.total}
            onBlur={async e => { const total = parseFloat(e.target.value) || 0; const updated = { ...trip, budget: { ...trip.budget, total, breakdown: estimateBudgetBreakdown(total) } }; const all = trips.map(t => t.id === updated.id ? updated : t); await persist(all); setActiveTrip(normTrip(updated)); }}
            style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "12px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 16, boxSizing: "border-box" as any }} />
          <button onClick={async () => { const all = trips.filter(t => t.id !== trip.id); await persist(all); setActiveTrip(null); }}
            style={{ width: "100%", padding: "12px", background: `${T.blush}15`, border: `1px solid ${T.blush}40`, borderRadius: 12, fontFamily: F.sans, fontSize: 13, color: T.blush, cursor: "pointer" }}>
            Delete Trip
          </button>
        </Card>
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
    </>
  );
}
