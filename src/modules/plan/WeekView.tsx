// Plan → Calendar: the one full calendar. Everything with a date in one
// place: events you add, connected calendars, each child's school dates,
// birthdays, trips, tasks with a due date, chores and bill due dates.
// Week shows the days as lists; Month shows a grid with a dot per item
// and the chosen day's list under it. Filter by person to see one kid's
// (or one adult's) things. (Export name kept: PlanScreen renders WeekView.)
import { useEffect, useMemo, useState } from "react";
import { T, F, TYPE, S, R, SHADOWS, alpha } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, Button, Input, Pill, Segmented, Emoji, TextButton } from "../../shared/components";
import { ChevronLeft, ChevronRight, Plus, Sparkles } from "lucide-react";
import { loadData, saveData } from "../../core/firebase";
import { bus } from "../../core/events";
import { todayLocal } from "../../core/dateAwareness";
import { openCleo } from "../../shared/utils/openCleo";
import { useCalendarEvents, type CalEvent } from "./useCalendarEvents";
import { buildWeekItems, billDatesInRange, sundayWeekDates, birthdayEvents, ymd, type Chore, type WeekItem } from "./planHelpers";
import type { Bill } from "../../core/bills";
import type { Person } from "../../core/familyPeople";
import toast from "react-hot-toast";

const KIND_META: Record<WeekItem["kind"], { icon: string; color: string; label: string }> = {
  event:    { icon: "📅", color: T.action,       label: "" },
  school:   { icon: "🏫", color: T.planInk,      label: "School" },
  birthday: { icon: "🎂", color: T.personalInk,  label: "Birthday" },
  trip:     { icon: "✈",  color: T.teal,         label: "Trip" },
  task:     { icon: "✓",  color: T.text,         label: "Task" },
  chore:    { icon: "🧺", color: T.sky,          label: "Chore" },
  bill:     { icon: "💰", color: T.householdInk, label: "Bill due" },
};

const fmtTime = (t?: string) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h)) return t;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
};
const dayLong = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

// The month as whole weeks (Sunday first), so the grid is always square.
function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const last = new Date(year, month + 1, 0);
  const cells = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
}

const matches = (who: string | undefined, person: string) =>
  !!who && who.toLowerCase().split(/[,&]| and /).some(w => w.trim() && (w.trim() === person.toLowerCase() || w.trim().split(" ")[0] === person.toLowerCase().split(" ")[0]));

export function WeekView({ people, chores, schoolEvents, tasks }: {
  people: Person[];
  chores: Chore[];
  schoolEvents: CalEvent[];
  tasks: Array<{ id: string; title: string; dueDate?: string; status?: string; who?: string }>;
}) {
  const { user, setActiveTab } = useStore();
  const { events, reload, anyConnected, connectionChecked } = useCalendarEvents(user?.uid, people);
  const today = todayLocal();
  // Week or Month, remembered on this phone.
  const [mode, setModeState] = useState<"week" | "month">(() => {
    try { return localStorage.getItem("hn_calendar_view") === "month" ? "month" : "week"; } catch { return "week"; }
  });
  const setMode = (m: "week" | "month") => { setModeState(m); try { localStorage.setItem("hn_calendar_view", m); } catch { /* private mode */ } };
  const [offset, setOffset] = useState(0);            // weeks or months from now
  const [selected, setSelected] = useState(today);    // the day shown under the month grid
  const [person, setPerson] = useState("");           // "" = everyone
  const [bills, setBills] = useState<Bill[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [who, setWho] = useState("");

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    loadData(user.uid, "bills").then(d => { if (alive) setBills(((d?.bills as Bill[]) || []).filter(b => b?.name)); }).catch(() => {});
    return () => { alive = false; };
  }, [user?.uid]);

  const now = new Date();
  const anchor = mode === "week"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset * 7)
    : new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const days = mode === "week" ? sundayWeekDates(anchor) : monthGrid(anchor.getFullYear(), anchor.getMonth());
  const inMonth = (d: string) => mode === "week" || d.slice(0, 7) === ymd(anchor).slice(0, 7);

  // Birthdays for every year the view touches (a December grid can show January).
  const years = [...new Set([days[0], days[days.length - 1]].map(d => Number(d.slice(0, 4))))];
  const bdays = years.flatMap(y => birthdayEvents(people, y)) as CalEvent[];
  const { byDay, undated } = buildWeekItems({
    week: days, events: [...events.filter(e => e.source !== "birthday"), ...bdays], schoolEvents, chores, tasks,
    bills: billDatesInRange(bills, days[0], days[days.length - 1]),
  });

  const filtered = (items: WeekItem[]) => (person ? items.filter(i => matches(i.who, person)) : items);
  const total = days.filter(inMonth).reduce((n, d) => n + filtered(byDay[d]).length, 0);
  const names = useMemo(() => people.map(p => p.name).filter(Boolean), [people]);

  const title_ = (() => {
    if (mode === "month") return anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (offset === 0) return "This week";
    if (offset === 1) return "Next week";
    if (offset === -1) return "Last week";
    return `Week of ${new Date(`${days[0]}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  })();
  const sub = mode === "week"
    ? `${new Date(`${days[0]}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} to ${new Date(`${days[6]}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : "";

  const addEvent = async () => {
    if (!title.trim() || !date || !user?.uid) return;
    const event: CalEvent = {
      id: crypto.randomUUID(), title: title.trim(), date, source: "manual", allDay: !time,
      ...(time ? { time } : {}), ...(who ? { child: who } : {}),
    };
    // Append to what's saved (never rewrite the list from a filtered view).
    const saved = ((await loadData(user.uid, "calendar"))?.events as CalEvent[]) || [];
    await saveData(user.uid, "calendar", { events: JSON.parse(JSON.stringify([...saved, event])) });
    await bus.publish("plan.calendar.event.added", event, { userId: user.uid, source: "plan" });
    await reload();
    setTitle(""); setTime(""); setWho(""); setShowAdd(false);
    toast.success("Added to your calendar");
  };

  const askCleo = () => {
    const shown = days.filter(inMonth);
    const lines = shown.flatMap(d => filtered(byDay[d]).map(i => `${new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}: ${i.title}${i.who ? ` (${i.who})` : ""}`));
    openCleo(lines.length
      ? `Help me get ahead of ${mode === "week" ? "this week" : "this month"}${person ? ` for ${person}` : ""}. Here's what's on:\n${lines.slice(0, 30).join("\n")}`
      : "Help me plan ahead. The calendar looks quiet so far. Is there anything in my tasks, bills or school items I should get ahead of?");
  };

  const navBtn: React.CSSProperties = { width: 44, height: 44, borderRadius: 22, border: `1px solid ${T.glass}`, background: T.frost, backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", display: "grid", placeItems: "center", color: T.text, cursor: "pointer", boxShadow: SHADOWS.sm, touchAction: "manipulation" };

  const itemRow = (i: WeekItem, dim: boolean) => {
    const meta = KIND_META[i.kind];
    const color = i.color || meta.color;
    return (
      <div key={i.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", background: T.surface, borderRadius: 14, border: `1px solid ${T.hairline}`, boxShadow: SHADOWS.sm, marginBottom: 6, opacity: dim ? 0.62 : 1 }}>
        <span aria-hidden="true" style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: color, flexShrink: 0 }} />
        <Emoji e={meta.icon} tile size={15} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: T.text, margin: 0, lineHeight: 1.3, overflowWrap: "anywhere" }}>{i.title}</p>
          <p style={{ fontFamily: F.sans, fontSize: 13, color: T.text2, margin: "2px 0 0" }}>
            {[fmtTime(i.time) || "All day", meta.label, i.who].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Week or Month, and whose calendar */}
      <Segmented label="Calendar view" value={mode} onChange={v => { setMode(v); setOffset(0); setSelected(today); }}
        options={[{ id: "week", label: "Week" }, { id: "month", label: "Month" }]} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setOffset(o => o - 1)} aria-label={`Previous ${mode}`} style={navBtn}><ChevronLeft size={20} strokeWidth={2} /></button>
        <div style={{ textAlign: "center", minWidth: 0 }}>
          <p style={{ fontFamily: F.display, fontWeight: 500, fontSize: 22, letterSpacing: "-0.01em", color: T.text, margin: 0 }}>{title_}</p>
          <p style={{ fontFamily: F.sans, fontSize: 13, color: T.text2, margin: "2px 0 0" }}>{[sub, `${total} thing${total === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</p>
        </div>
        <button onClick={() => setOffset(o => o + 1)} aria-label={`Next ${mode}`} style={navBtn}><ChevronRight size={20} strokeWidth={2} /></button>
      </div>
      {offset !== 0 && (
        <div style={{ textAlign: "center", margin: "-6px 0 6px" }}>
          <TextButton onClick={() => { setOffset(0); setSelected(today); }}>Back to today</TextButton>
        </div>
      )}

      {names.length > 0 && (
        <div className="scroll-x" style={{ display: "flex", gap: 8, marginBottom: 12, paddingBottom: 2 }}>
          <Pill label="Everyone" active={!person} onClick={() => setPerson("")} />
          {names.map(n => <Pill key={n} label={n.split(" ")[0]} active={person === n} onClick={() => setPerson(person === n ? "" : n)} />)}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Button onClick={() => { setShowAdd(!showAdd); setDate(mode === "month" ? selected : today); }} style={{ flex: 1 }}><Plus size={18} strokeWidth={2.2} aria-hidden="true" /> Add event</Button>
        <Button variant="gentle" onClick={askCleo} style={{ flex: 1 }}><Sparkles size={17} strokeWidth={1.9} aria-hidden="true" /> Ask Cleo</Button>
      </div>

      {showAdd && (
        <Card>
          <Input label="What's happening?" value={title} onChange={setTitle} placeholder="Soccer practice" />
          <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
            <input type="date" aria-label="Date" value={date} onChange={e => setDate(e.target.value)} style={{ flex: 1, minWidth: 0, background: T.surface, border: `1.5px solid ${T.divider}`, borderRadius: R.button, padding: "12px", fontFamily: F.sans, fontSize: 16, color: T.text, outline: "none", minHeight: 48 }} />
            <input type="time" aria-label="Time (optional)" value={time} onChange={e => setTime(e.target.value)} style={{ flex: 1, minWidth: 0, background: T.surface, border: `1.5px solid ${T.divider}`, borderRadius: R.button, padding: "12px", fontFamily: F.sans, fontSize: 16, color: T.text, outline: "none", minHeight: 48 }} />
          </div>
          {names.length > 0 && (
            <>
              <p style={{ fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text, margin: "0 0 8px" }}>Who is it for? (optional)</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {names.map(n => <Pill key={n} label={n} active={who === n} onClick={() => setWho(who === n ? "" : n)} />)}
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={addEvent} disabled={!title.trim() || !date} style={{ flex: 1 }}>Add</Button>
            <Button onClick={() => setShowAdd(false)} variant="secondary" style={{ flex: 1 }}>Cancel</Button>
          </div>
        </Card>
      )}

      {mode === "month" ? (
        <>
          <Card style={{ padding: "12px 10px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((l, i) => (
                <span key={i} aria-hidden="true" style={{ textAlign: "center", fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: T.text2 }}>{l}</span>
              ))}
            </div>
            <div role="grid" aria-label={title_} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", rowGap: 2 }}>
              {days.map(d => {
                const items = filtered(byDay[d]);
                const isSel = d === selected, isToday = d === today, other = !inMonth(d);
                const kinds = [...new Set(items.map(i => i.color || KIND_META[i.kind].color))].slice(0, 3);
                return (
                  <button key={d} role="gridcell" aria-selected={isSel} onClick={() => setSelected(d)}
                    aria-label={`${dayLong(d)}${items.length ? `, ${items.length} thing${items.length === 1 ? "" : "s"}` : ", nothing planned"}`}
                    style={{ minHeight: 48, padding: "6px 0 4px", border: "none", borderRadius: 14, cursor: "pointer", touchAction: "manipulation",
                      background: isSel ? T.action : isToday ? alpha(T.action, 0.12) : "transparent", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <span style={{ fontFamily: F.sans, fontSize: 15, fontWeight: isToday || isSel ? 800 : 500, color: isSel ? T.onAction : other ? alpha(T.text2, 0.55) : T.text, fontVariantNumeric: "tabular-nums" }}>
                      {Number(d.slice(8))}
                    </span>
                    <span aria-hidden="true" style={{ display: "flex", gap: 3, height: 6 }}>
                      {kinds.map((c, k) => <span key={k} style={{ width: 6, height: 6, borderRadius: 3, background: isSel ? T.onAction : c, opacity: other ? 0.5 : 1 }} />)}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
          <p style={{ fontFamily: F.display, fontSize: 19, fontWeight: 500, color: T.text, margin: `${S.md}px 2px 8px` }}>
            {dayLong(selected)}{selected === today ? " · Today" : ""}
          </p>
          {filtered(byDay[selected] || []).length === 0
            ? <p style={{ fontFamily: F.sans, fontSize: 14, color: T.text2, margin: "0 2px 12px" }}>Nothing planned{person ? ` for ${person.split(" ")[0]}` : ""}.</p>
            : filtered(byDay[selected] || []).map(i => itemRow(i, false))}
        </>
      ) : days.map(d => {
        const items = filtered(byDay[d]);
        const isToday = d === today;
        const isPast = d < today;
        return (
          <div key={d} style={{ marginBottom: 12 }}>
            <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 700, color: isToday ? T.action : T.text2, margin: "0 2px 6px", opacity: isPast ? 0.7 : 1 }}>
              {dayLong(d)}{isToday ? " · Today" : ""}
            </p>
            {items.length === 0
              ? <p style={{ fontFamily: F.sans, fontSize: 13, color: T.text2, margin: "0 2px 4px", opacity: 0.8 }}>Nothing planned</p>
              : items.map(i => itemRow(i, isPast))}
          </div>
        );
      })}

      {mode === "week" && undated.length > 0 && !person && (
        <Card>
          <p style={{ fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 700, color: T.text, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}><Emoji e="🧺" size={16} /> Chores this week</p>
          {undated.map(i => (
            <p key={i.id} style={{ fontFamily: F.sans, fontSize: 14, color: T.text, margin: "0 0 6px" }}>{i.title} <span style={{ color: T.text2 }}>· {i.who}</span></p>
          ))}
        </Card>
      )}

      {connectionChecked && !anyConnected && (
        <button onClick={() => setActiveTab("connections")} style={{ width: "100%", padding: "12px", background: T.frost, border: `1.5px dashed ${T.border}`, borderRadius: 14, fontFamily: F.sans, fontSize: 14, color: T.text2, cursor: "pointer", minHeight: 44, marginTop: 4 }}>
          Add your Google, Outlook or iPhone calendar in Connections
        </button>
      )}
    </>
  );
}
