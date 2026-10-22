import React from "react";
import { BookOpen, ShieldCheck, FileText, Ticket, HeartPulse, Luggage, Home, Bell } from "lucide-react";
import { T, F, S, R, TYPE, alpha } from "../../config/theme";
import { Card, ListRow, StatusChip, CheckBox, AIBadge, ProgressBar, Button, HeroNumber, Headline, Emoji } from "../../shared/components";
import { estimateBudgetBreakdown, normTrip } from "./tripsShared";
import type { Trip, ReadinessScore, TripDocument } from "./tripsShared";

type IconCmp = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number; "aria-hidden"?: boolean | "true" | "false" }>;

const CATEGORY_ICONS: Record<string, IconCmp> = {
  booking: Ticket, document: FileText, health: HeartPulse, packing: Luggage, home: Home, notification: Bell,
};
const DOC_ICONS: Record<TripDocument["type"], IconCmp> = {
  passport: BookOpen, visa: FileText, insurance: ShieldCheck, booking: Ticket, health: HeartPulse,
};

const DOC_STATUS = {
  needed:  { status: "unpaid" as const,  label: "Needed" },
  ready:   { status: "paid" as const,    label: "Ready" },
  expired: { status: "overdue" as const, label: "Expired" },
};

const fieldLabel: React.CSSProperties = { display: "block", fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text, margin: "0 0 6px" };
const fieldStyle: React.CSSProperties = {
  width: "100%", background: T.surface, border: `1.5px solid ${T.divider}`, borderRadius: R.button, padding: "12px 14px", minHeight: 48,
  fontFamily: F.sans, fontSize: 16, color: T.text, outline: "none", boxSizing: "border-box", WebkitAppearance: "none", minWidth: 0,
};

const barColor = (v: number, hi = 80, mid = 40) => v >= hi ? T.householdInk : v >= mid ? T.warn : T.blush;

function IconTile({ Icon }: { Icon: IconCmp }) {
  return (
    <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11, background: T.cleoBg, display: "inline-grid", placeItems: "center", flexShrink: 0 }}>
      <Icon size={18} color={T.action} strokeWidth={1.9} aria-hidden="true" />
    </span>
  );
}

// A checkbox row: the box is the control (with its own label); tapping the text toggles too.
function CheckRow({ checked, onToggle, label, first, children, align = "center" }: {
  checked: boolean; onToggle: () => void; label: string; first?: boolean; children: React.ReactNode; align?: "center" | "flex-start";
}) {
  return (
    <div style={{ display: "flex", alignItems: align, gap: S.md, padding: `${S.md}px 0 ${S.md}px 9px`, borderTop: first ? "none" : `1px solid ${T.divider}` }}>
      <CheckBox checked={checked} onToggle={onToggle} label={label} />
      <div onClick={onToggle} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: S.sm, cursor: "pointer", touchAction: "manipulation" }}>{children}</div>
    </div>
  );
}

export function TripDetailTabs({
  detailTab, trip, trips, persist, setActiveTrip, readiness, completedTasks,
  planning, packingLoading,
  generateItinerary, generatePackingList, togglePacking, toggleTask, toggleDoc,
}: {
  detailTab: "overview" | "itinerary" | "packing" | "checklist" | "budget" | "edit";
  trip: Trip; trips: Trip[];
  persist: (updated: Trip[]) => Promise<void>;
  setActiveTrip: React.Dispatch<React.SetStateAction<Trip | null>>;
  readiness: ReadinessScore; completedTasks: number;
  planning: boolean; packingLoading: boolean;
  generateItinerary: (trip: Trip) => Promise<void>;
  generatePackingList: (trip: Trip) => Promise<void>;
  togglePacking: (si: number, ii: number) => Promise<void>;
  toggleTask: (i: number) => Promise<void>;
  toggleDoc: (i: number) => Promise<void>;
}) {
  const saveTrip = async (updated: Trip) => {
    const all = trips.map(t => t.id === updated.id ? updated : t);
    await persist(all);
    setActiveTrip(normTrip(updated));
  };

  return (
    <>
      {/* ══════════════ TAB: OVERVIEW ══════════════ */}
      {detailTab === "overview" && (
        <>
          <Card>
            <h2 style={{ fontFamily: F.display, fontSize: TYPE.section, fontWeight: 500, color: T.text, margin: `0 0 ${S.lg}px` }}>Trip readiness</h2>
            {[
              { label: "Documents",  value: readiness.documents, icon: "📖" },
              { label: "Budget set", value: readiness.budget,    icon: "💰" },
              { label: "Packing",    value: readiness.packing,   icon: "🧳" },
              { label: "Booking",    value: readiness.booking,   icon: "🎟" },
              { label: "Prep tasks", value: readiness.tasks,     icon: "✓" },
            ].map(r => (
              <div key={r.label} style={{ marginBottom: S.md }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: F.sans, fontSize: TYPE.support, color: T.text }}><Emoji e={r.icon} size={15} /> {r.label}</span>
                  <span style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text2, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{r.value}%</span>
                </div>
                <ProgressBar value={r.value} max={100} color={barColor(r.value)} height={8} />
              </div>
            ))}
          </Card>

          <Card>
            <h2 style={{ fontFamily: F.display, fontSize: TYPE.section, fontWeight: 500, color: T.text, margin: "0 0 4px" }}>Travelers</h2>
            {trip.travellers.map((t, i) => (
              <ListRow key={i} divider={i > 0}
                leading={<Emoji e={t.type === "adult" ? "👩" : t.age < 2 ? "👶" : "🧒"} tile size={16} />}
                title={t.name}
                detail={<span style={{ textTransform: "capitalize" }}>{t.role || t.type} · {t.age}y</span>} />
            ))}
          </Card>

          <Card>
            <h2 style={{ fontFamily: F.display, fontSize: TYPE.section, fontWeight: 500, color: T.text, margin: "0 0 4px" }}>Documents</h2>
            {trip.documents.map((doc, i) => {
              const st = DOC_STATUS[doc.status];
              return (
                <ListRow key={i} divider={i > 0} onClick={() => toggleDoc(i)} ariaLabel={`Toggle ${doc.type} status`}
                  leading={<IconTile Icon={DOC_ICONS[doc.type] || FileText} />}
                  title={<span style={{ textTransform: "capitalize" }}>{doc.type}{doc.traveller ? ` · ${doc.traveller}` : ""}</span>}
                  trailing={<StatusChip status={st.status}>{st.label}</StatusChip>} />
              );
            })}
            <p style={{ fontFamily: F.sans, fontSize: TYPE.meta, color: T.text2, margin: "4px 0 0", textAlign: "center" }}>Tap to update status</p>
          </Card>

          {!trip.itinerary.length && (
            <Button onClick={() => generateItinerary(trip)} disabled={planning} variant="gold">
              <Emoji e="✦" size={16} /> {planning ? "Planning itinerary..." : "Generate itinerary"}
            </Button>
          )}
          {!trip.packingList.length && (
            <Button onClick={() => generatePackingList(trip)} disabled={packingLoading} variant="secondary" style={{ marginTop: 8 }}>
              <Emoji e="✦" size={16} /> {packingLoading ? "Building packing list..." : "Generate packing list"}
            </Button>
          )}
        </>
      )}

      {/* ══════════════ TAB: ITINERARY ══════════════ */}
      {detailTab === "itinerary" && (
        <>
          {trip.itinerary.length ? trip.itinerary.map((day, i) => (
            <Card key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: S.md, marginBottom: S.sm }}>
                <div style={{ minWidth: 0 }}>
                  <Headline size={22}>Day {day.day}</Headline>
                  <p style={{ fontFamily: F.sans, fontSize: TYPE.body, fontWeight: 600, color: T.text, margin: "4px 0 0" }}>{day.theme}</p>
                </div>
                <span style={{ fontFamily: F.sans, fontSize: TYPE.meta, color: T.text2, paddingTop: 4, whiteSpace: "nowrap" }}>{/^\d{4}-\d{2}-\d{2}$/.test(String(day.date)) ? new Date(`${day.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : day.date}</span>
              </div>
              {[
                { label: "Morning",   value: day.morning,   icon: "☀" },
                { label: "Afternoon", value: day.afternoon, icon: "🌤" },
                { label: "Evening",   value: day.evening,   icon: "✦" },
              ].map(slot => (
                <div key={slot.label} style={{ display: "flex", gap: S.md, padding: `${S.md}px 0`, borderTop: `1px solid ${T.divider}` }}>
                  <span style={{ width: 22, flexShrink: 0, color: T.action, paddingTop: 2 }}><Emoji e={slot.icon} size={18} /></span>
                  <div>
                    <p style={{ fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text2, margin: "0 0 2px" }}>{slot.label}</p>
                    <p style={{ fontFamily: F.sans, fontSize: TYPE.body, color: T.text, margin: 0, lineHeight: 1.45 }}>{slot.value}</p>
                  </div>
                </div>
              ))}
              {day.mumMoment && (
                <div style={{ marginTop: S.sm, padding: "12px 14px", background: T.cleoBg, borderRadius: R.button, borderLeft: `3px solid ${T.action}` }}>
                  <p style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 700, color: T.action, margin: "0 0 3px" }}><Emoji e="✦" size={14} /> Mom moment</p>
                  <p style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text, margin: 0, lineHeight: 1.5 }}>{day.mumMoment}</p>
                </div>
              )}
              {day.tip && (
                <p style={{ display: "flex", gap: 6, fontFamily: F.sans, fontSize: TYPE.support, color: T.text2, margin: `${S.md}px 0 0`, lineHeight: 1.45 }}>
                  <span style={{ flexShrink: 0, paddingTop: 2 }}><Emoji e="💡" size={15} /></span> {day.tip}
                </p>
              )}
            </Card>
          )) : (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <p style={{ fontFamily: F.sans, fontSize: TYPE.body, color: T.text2, marginBottom: 16 }}>No itinerary yet. Let Cleo plan your days.</p>
              <Button onClick={() => generateItinerary(trip)} disabled={planning} variant="gold" style={{ width: "auto" }}>
                <Emoji e="✦" size={16} /> {planning ? "Planning..." : "Generate itinerary"}
              </Button>
            </div>
          )}
          {trip.itinerary.length > 0 && (
            <Button onClick={() => generateItinerary(trip)} disabled={planning} variant="ghost" size="sm" style={{ marginTop: 8 }}>
              {planning ? "Regenerating..." : "Regenerate itinerary"}
            </Button>
          )}
        </>
      )}

      {/* ══════════════ TAB: PACKING ══════════════ */}
      {detailTab === "packing" && (
        <>
          {trip.packingList.length ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: S.md }}>
                <AIBadge label="Packed by Cleo" />
                <Button onClick={() => generatePackingList(trip)} disabled={packingLoading} variant="ghost" size="sm" style={{ width: "auto" }}>
                  {packingLoading ? "..." : "Redo"}
                </Button>
              </div>
              {trip.packingList.map((sec, si) => {
                const secChecked = sec.items.filter(i => i.checked).length;
                return (
                  <Card key={si}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: S.sm }}>
                      <h2 style={{ fontFamily: F.display, fontSize: TYPE.section, fontWeight: 500, color: T.text, margin: 0 }}>{sec.name}</h2>
                      <span style={{ fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text2, fontVariantNumeric: "tabular-nums" }}>{secChecked}/{sec.items.length}</span>
                    </div>
                    <ProgressBar value={secChecked} max={sec.items.length} color={T.action} height={6} />
                    <div style={{ marginTop: S.sm }}>
                      {sec.items.map((item, ii) => (
                        <CheckRow key={ii} first={ii === 0} checked={item.checked} onToggle={() => togglePacking(si, ii)} label={`Toggle packed: ${item.name}`}>
                          <p style={{ fontFamily: F.sans, fontSize: TYPE.body, color: item.checked ? T.text2 : T.text, margin: 0, flex: 1, textDecoration: item.checked ? "line-through" : "none" }}>
                            {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}
                          </p>
                          {item.essential && !item.checked && <StatusChip status="unpaid">Essential</StatusChip>}
                          {item.weatherDependent && <span style={{ color: T.text2 }}><Emoji e="🌤" size={15} /></span>}
                        </CheckRow>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <p style={{ fontFamily: F.sans, fontSize: TYPE.body, color: T.text2, marginBottom: 16 }}>Cleo will build a smart packing list for your family.</p>
              <Button onClick={() => generatePackingList(trip)} disabled={packingLoading} variant="gold" style={{ width: "auto" }}>
                <Emoji e="✦" size={16} /> {packingLoading ? "Building list..." : "Generate packing list"}
              </Button>
            </div>
          )}
        </>
      )}

      {/* ══════════════ TAB: CHECKLIST ══════════════ */}
      {detailTab === "checklist" && (
        <Card>
          <h2 style={{ fontFamily: F.display, fontSize: TYPE.section, fontWeight: 500, color: T.text, margin: "0 0 4px" }}>Pre-departure</h2>
          <p style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text2, margin: `0 0 ${S.md}px` }}>{completedTasks} of {trip.preDeparture.length} complete</p>
          <ProgressBar value={completedTasks} max={trip.preDeparture.length} color={T.householdInk} height={8} />
          <div style={{ marginTop: S.md }}>
            {trip.preDeparture.map((task, i) => {
              const CatIcon = CATEGORY_ICONS[task.category];
              return (
                <CheckRow key={i} first={i === 0} align="flex-start" checked={task.completed} onToggle={() => toggleTask(i)} label={`Toggle task: ${task.task}`}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontFamily: F.sans, fontSize: TYPE.body, color: task.completed ? T.text2 : T.text, margin: "0 0 2px", textDecoration: task.completed ? "line-through" : "none" }}>{task.task}</p>
                    <p style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: F.sans, fontSize: TYPE.meta, color: T.text2, margin: 0 }}>
                      {CatIcon && <CatIcon size={13} strokeWidth={1.9} aria-hidden="true" />} {task.deadline}
                    </p>
                  </div>
                </CheckRow>
              );
            })}
          </div>
        </Card>
      )}

      {/* ══════════════ TAB: BUDGET ══════════════ */}
      {detailTab === "budget" && (
        <Card>
          <h2 style={{ fontFamily: F.display, fontSize: TYPE.section, fontWeight: 500, color: T.text, margin: `0 0 ${S.md}px` }}>Trip budget</h2>
          <div style={{ marginBottom: S.xl }}>
            <HeroNumber value={`${trip.budget.currency}${trip.budget.total.toLocaleString()}`} label="Total" size={40} />
          </div>
          {Object.entries(trip.budget.breakdown).map(([key, val]) => {
            const pct = trip.budget.total > 0 ? Math.round((val / trip.budget.total) * 100) : 0;
            return (
              <div key={key} style={{ marginBottom: S.md }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text, textTransform: "capitalize" }}>{key}</span>
                  <span style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text2, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{trip.budget.currency}{val.toLocaleString()} · {pct}%</span>
                </div>
                <ProgressBar value={pct} max={100} color={T.action} height={8} />
              </div>
            );
          })}
        </Card>
      )}

      {/* ══════════════ TAB: EDIT ══════════════ */}
      {detailTab === "edit" && (
        <Card>
          <h2 style={{ fontFamily: F.display, fontSize: TYPE.section, fontWeight: 500, color: T.text, margin: `0 0 ${S.lg}px` }}>Edit trip</h2>
          <label htmlFor="trip-edit-dest" style={fieldLabel}>Destination</label>
          <input id="trip-edit-dest" defaultValue={trip.destination}
            onBlur={e => saveTrip({ ...trip, destination: e.target.value })}
            style={{ ...fieldStyle, marginBottom: S.md }} />
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginBottom: S.md }}>
            <div>
              <label htmlFor="trip-edit-dep" style={fieldLabel}>Departure</label>
              <input id="trip-edit-dep" type="date" defaultValue={trip.departureDate}
                onBlur={e => saveTrip({ ...trip, departureDate: e.target.value })}
                style={fieldStyle} />
            </div>
            <div>
              <label htmlFor="trip-edit-ret" style={fieldLabel}>Return</label>
              <input id="trip-edit-ret" type="date" defaultValue={trip.returnDate}
                onBlur={e => saveTrip({ ...trip, returnDate: e.target.value })}
                style={fieldStyle} />
            </div>
          </div>
          <label htmlFor="trip-edit-budget" style={fieldLabel}>Budget</label>
          <input id="trip-edit-budget" type="number" defaultValue={trip.budget.total}
            onBlur={e => { const total = parseFloat(e.target.value) || 0; return saveTrip({ ...trip, budget: { ...trip.budget, total, breakdown: estimateBudgetBreakdown(total) } }); }}
            style={{ ...fieldStyle, marginBottom: S.xl }} />
          <Button variant="secondary" onClick={async () => { const all = trips.filter(t => t.id !== trip.id); await persist(all); setActiveTrip(null); }}
            style={{ color: T.danger, background: T.dangerBg, border: `1px solid ${alpha(T.danger, 0.25)}` }}>
            Delete trip
          </Button>
        </Card>
      )}
    </>
  );
}
