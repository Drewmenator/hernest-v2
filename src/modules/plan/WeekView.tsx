// Plan → Week: the one calendar view. Calendar events, school events, tasks
// with a due date and chores, in one list by day.
import { useState } from "react";
import { T, F, alpha } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, Button, Input, Emoji } from "../../shared/components";
import { loadData, saveData } from "../../core/firebase";
import { bus } from "../../core/events";
import { todayLocal } from "../../core/dateAwareness";
import { openCleo } from "../../shared/utils/openCleo";
import { useCalendarEvents, type CalEvent } from "./useCalendarEvents";
import { buildWeekItems, sundayWeekDates, type Chore, type WeekItem } from "./planHelpers";
import type { Person } from "../../core/familyPeople";
import toast from "react-hot-toast";

const KIND_META: Record<WeekItem["kind"], { icon: string; color: string; label: string }> = {
  event:    { icon: "◉", color: T.lav,   label: "" },
  school:   { icon: "🏫", color: T.sage,  label: "School" },
  birthday: { icon: "🎂", color: T.blush, label: "Birthday" },
  trip:     { icon: "✈", color: T.gold,  label: "Trip" },
  task:     { icon: "✓", color: T.esp,   label: "Task" },
  chore:    { icon: "🧺", color: T.sky,   label: "Chore" },
};

const fmtTime = (t?: string) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h)) return t;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

export function WeekView({ people, chores, schoolEvents, tasks }: {
  people: Person[];
  chores: Chore[];
  schoolEvents: CalEvent[];
  tasks: Array<{ id: string; title: string; dueDate?: string; status?: string; who?: string }>;
}) {
  const { user, setActiveTab } = useStore();
  const { events, reload, anyConnected, connectionChecked } = useCalendarEvents(user?.uid, people);
  const [offset, setOffset] = useState(0);          // weeks from this one
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [time, setTime] = useState("");
  const [who, setWho] = useState("");

  const today = todayLocal();
  const now = new Date();
  const week = sundayWeekDates(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset * 7));
  const { byDay, undated } = buildWeekItems({ week, events, schoolEvents, chores, tasks });
  const total = week.reduce((n, d) => n + byDay[d].length, 0);

  const rangeLabel = (() => {
    const a = new Date(week[0] + "T00:00:00"), b = new Date(week[6] + "T00:00:00");
    const f = (d: Date, withMonth: boolean) => d.toLocaleDateString("en-US", withMonth ? { month: "short", day: "numeric" } : { day: "numeric" });
    return `${f(a, true)} – ${f(b, a.getMonth() !== b.getMonth())}`;
  })();

  const addEvent = async () => {
    if (!title.trim() || !date || !user?.uid) return;
    const event: CalEvent = {
      id: crypto.randomUUID(), title: title.trim(), date, source: "manual", color: T.lav, allDay: !time,
      ...(time ? { time } : {}), ...(who ? { child: who } : {}),
    };
    // Append to what's saved (the old Calendar screen rewrote this list from
    // its filtered view and could drop imported school dates).
    const saved = ((await loadData(user.uid, "calendar"))?.events as CalEvent[]) || [];
    await saveData(user.uid, "calendar", { events: JSON.parse(JSON.stringify([...saved, event])) });
    await bus.publish("plan.calendar.event.added", event, { userId: user.uid, source: "plan" });
    await reload();
    setTitle(""); setTime(""); setWho(""); setShowAdd(false);
    toast.success("Added to your week");
  };

  const askCleo = () => {
    const lines = week.flatMap(d => byDay[d].map(i => `${new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}: ${i.title}${i.who ? ` (${i.who})` : ""}`));
    openCleo(lines.length
      ? `Help me get ahead of this week. Here's what's on:\n${lines.slice(0, 25).join("\n")}`
      : "Help me plan this week. The calendar looks quiet so far. Is there anything in my tasks, bills or school items I should get ahead of?");
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={() => setOffset(o => o - 1)} aria-label="Previous week" style={{ background: T.sand, border: `1px solid ${T.linen}`, borderRadius: 10, padding: "8px 16px", fontFamily: F.sans, fontSize: 18, cursor: "pointer", color: T.esp, minHeight: 44 }}>‹</button>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontFamily: F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize: 20, color: T.esp, margin: 0 }}>{offset === 0 ? "This week" : offset === 1 ? "Next week" : offset === -1 ? "Last week" : rangeLabel}</p>
          <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "2px 0 0" }}>{rangeLabel} · {total} thing{total === 1 ? "" : "s"}</p>
        </div>
        <button onClick={() => setOffset(o => o + 1)} aria-label="Next week" style={{ background: T.sand, border: `1px solid ${T.linen}`, borderRadius: 10, padding: "8px 16px", fontFamily: F.sans, fontSize: 18, cursor: "pointer", color: T.esp, minHeight: 44 }}>›</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setShowAdd(!showAdd)} style={{ flex: 1, background: T.esp, color: T.onAction, border: "none", borderRadius: 12, padding: "10px", fontFamily: F.sans, fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 44 }}>+ Add event</button>
        <button onClick={askCleo} style={{ flex: 1, background: T.goldP, color: T.gold, border: `1px solid ${alpha(T.gold, 0.25)}`, borderRadius: 12, padding: "10px", fontFamily: F.sans, fontSize: 13, fontWeight: 600, cursor: "pointer", minHeight: 44 }}><Emoji e="✦" size={14} /> Ask Cleo</button>
      </div>

      {showAdd && (
        <Card>
          <Input value={title} onChange={setTitle} placeholder="What's happening?" style={{ marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ flex: 1, background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "12px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", minHeight: 48 }} />
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ flex: 1, background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "12px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", minHeight: 48 }} />
          </div>
          {people.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {people.map(p => (
                <button key={p.id} onClick={() => setWho(who === p.name ? "" : p.name)} style={{ padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${who === p.name ? T.gold : T.linen}`, background: who === p.name ? T.goldP : T.surface, color: who === p.name ? T.gold : T.bark, fontFamily: F.sans, fontSize: 12, cursor: "pointer", minHeight: 30 }}>{p.name}</button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={addEvent} disabled={!title.trim() || !date} variant="gold" style={{ flex: 1 }}>Add</Button>
            <Button onClick={() => setShowAdd(false)} variant="ghost" style={{ flex: 1 }}>Cancel</Button>
          </div>
        </Card>
      )}

      {week.map(d => {
        const items = byDay[d];
        const isToday = d === today;
        const isPast = d < today;
        return (
          <div key={d} style={{ marginBottom: 10, opacity: isPast ? 0.6 : 1 }}>
            <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: isToday ? T.gold : T.taupe, margin: "0 0 6px" }}>
              {new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}{isToday ? " · Today" : ""}
            </p>
            {items.length === 0 ? (
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 4px 2px" }}>Nothing planned</p>
            ) : items.map(i => {
              const meta = KIND_META[i.kind];
              return (
                <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", background: isToday ? `${alpha(T.gold, 0.03)}` : T.ivory, borderRadius: 14, border: `1px solid ${T.linen}`, borderLeft: `4px solid ${i.color || meta.color}`, marginBottom: 6 }}>
                  <span style={{ fontSize: 16, width: 20, display: "inline-flex", justifyContent: "center", flexShrink: 0, color: i.color || meta.color }}><Emoji e={meta.icon} size={16} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>{i.title}</p>
                    <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "2px 0 0" }}>
                      {[fmtTime(i.time), meta.label, i.who].filter(Boolean).join(" · ") || "All day"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {undated.length > 0 && (
        <Card>
          <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.taupe, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6 }}><Emoji e="🧺" size={16} /> Chores this week</p>
          {undated.map(i => (
            <p key={i.id} style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: "0 0 6px" }}>{i.title} <span style={{ color: T.gold, fontSize: 12 }}>→ {i.who}</span></p>
          ))}
        </Card>
      )}

      {connectionChecked && !anyConnected && (
        <button onClick={() => setActiveTab("connections")} style={{ width: "100%", padding: "12px", background: "none", border: `1.5px dashed ${T.linen}`, borderRadius: 14, fontFamily: F.sans, fontSize: 13, color: T.taupe, cursor: "pointer", minHeight: 44, marginTop: 4 }}>
          See your Google, Outlook or iPhone calendar here → Connections
        </button>
      )}
    </>
  );
}
