// ─── Today ─────────────────────────────────────────────────────────
// Home and Briefing in one calm screen (simplification plan, section 4):
// Get Started (until done) · Morning note · Needs you · This week ·
// Quick add · a small "You today" line. The picture opens the You menu.
import React, { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { openCleo } from "../../shared/utils/openCleo";
import { loadData, saveData } from "../../core/firebase";
import { markPaid, undoPaid, type Bill } from "../../core/bills";
import { formatMoney } from "../../shared/utils/money";
import { Spinner } from "../../shared/components";
import type { WeatherData } from "../../core/weather";
import { loadHomeDocs, invalidateHomeDocs } from "./homeData";
import { GetStartedCard } from "./GetStartedCard";
import { buildNeedsYou, billsThisWeek, eventsTodayTomorrow, nextTrip, type NeedsItem, type Person, type DayEvent } from "./todayData";
import { cachedBriefing, generateBriefing, type Briefing } from "../briefing/generateBriefing";
import { Avatar, YouMenu } from "../me/YouMenu";
import { useTripsEnabled } from "../me/extras";

const card: React.CSSProperties = { background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: 16, marginBottom: 12 };
const eyebrow: React.CSSProperties = { fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", padding: 0, fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: T.goldText, cursor: "pointer", minHeight: 32 };

// ── Morning note ────────────────────────────────────────────────────
function MorningNote({ weather }: { weather: WeatherData | null }) {
  const uid = useStore(s => s.user?.uid);
  const profile = useStore(s => s.profile);
  const familyMembers = useStore(s => s.familyMembers);
  const setActiveTab = useStore(s => s.setActiveTab);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "writing" | "failed">("loading");

  const write = useCallback(() => {
    if (!uid) return;
    setState("writing");
    generateBriefing({ uid, profile, familyMembers, weather })
      .then(r => { setBriefing(r.briefing); setState("ready"); })
      .catch(() => setState("failed"));
  }, [uid, profile, familyMembers, weather]);

  useEffect(() => {
    if (!uid || !profile) return;
    let alive = true;
    cachedBriefing().then(b => {
      if (!alive) return;
      if (b) { setBriefing(b); setState("ready"); }
      else write();   // first open of this morning/afternoon/evening
    });
    return () => { alive = false; };
    // Only on open: a new weather reading shouldn't write a second note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, !!profile]);

  // One note a day now, so name it for the day, not the hour.
  const label = "Today's note";
  const dark: React.CSSProperties = { background: `linear-gradient(135deg,${T.esp},#3D2E22)`, borderRadius: 20, padding: 18, marginBottom: 12, color: "#fff" };
  const weatherLine = weather ? `${weather.icon} ${weather.temp}°${weather.unit}, ${weather.condition.toLowerCase()}` : null;

  if (state !== "ready" || !briefing) {
    return (
      <div style={dark}>
        <p style={{ ...eyebrow, color: "rgba(255,255,255,0.5)" }}>{label}</p>
        {state === "failed" ? (
          <>
            <p style={{ fontFamily: F.serif, fontSize: 18, fontStyle: "italic", margin: "0 0 10px" }}>Cleo couldn't write your note just now.</p>
            <button onClick={write} style={{ ...linkBtn, color: T.gold }}>Try again</button>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Spinner size={16} />
            <p style={{ fontFamily: F.sans, fontSize: 13, color: "rgba(255,255,255,0.7)", margin: 0 }}>{state === "writing" ? "Cleo is writing your note…" : "Loading…"}</p>
          </div>
        )}
        {weatherLine && <p style={{ fontFamily: F.sans, fontSize: 12, color: "rgba(255,255,255,0.6)", margin: "10px 0 0" }}>{weatherLine}</p>}
      </div>
    );
  }

  const focus = briefing.focusWord;
  return (
    <div style={dark}>
      <p style={{ ...eyebrow, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>{label}</p>
      {focus?.word && (
        <p style={{ fontFamily: F.serif, fontSize: 17, fontStyle: "italic", color: "rgba(255,255,255,0.9)", margin: "0 0 12px", lineHeight: 1.4 }}>
          Today's focus: <span style={{ color: T.gold }}>{focus.word}</span>{focus.emoji ? ` ${focus.emoji}` : ""}{focus.why ? <>. {focus.why}</> : null}
        </p>
      )}
      {(briefing.priorities || []).slice(0, 3).map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0" }}>
          <span style={{ fontFamily: F.sans, fontSize: 12, color: T.gold, flexShrink: 0, width: 14 }}>{i + 1}.</span>
          <p style={{ fontFamily: F.sans, fontSize: 13, color: "rgba(255,255,255,0.88)", margin: 0, lineHeight: 1.4 }}>{p.text}</p>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 8 }}>
        <p style={{ fontFamily: F.sans, fontSize: 12, color: "rgba(255,255,255,0.6)", margin: 0 }}>{weatherLine || ""}</p>
        <button onClick={() => setActiveTab("briefing")} style={{ ...linkBtn, color: T.gold }}>See full briefing →</button>
      </div>
    </div>
  );
}

// ── Needs you + This week (share one data load) ─────────────────────
interface TodayData { needs: NeedsItem[]; bills: Bill[]; week: { count: number; total: number }; events: { today: DayEvent[]; tomorrow: DayEvent[] }; trip: { dest: string; days: number } | null }

function useTodayData(tripsOn: boolean) {
  const uid = useStore(s => s.user?.uid);
  const profile = useStore(s => s.profile);
  const familyMembers = useStore(s => s.familyMembers);
  const [data, setData] = useState<TodayData | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    loadHomeDocs(uid).then(d => {
      if (!alive) return;
      const bills = ((d.bills?.bills as Bill[]) || []).filter(b => b && b.name);
      const school = (d.school?.events as unknown[]) || [];
      const trips = (d.trips?.trips as unknown[]) || [];
      const people: Person[] = [
        ...((d.circle?.contacts as Person[]) || []),
        ...familyMembers,
        ...((profile?.kids as Person[]) || []),
        ...((profile?.parents as Person[]) || []),
        ...((profile?.inlaws as Person[]) || []),
      ];
      const nt = tripsOn ? nextTrip(trips as never[]) : null;
      setData({
        needs: buildNeedsYou({ bills, tasks: (d.tasks?.tasks as never[]) || [], school: school as never[], trips: trips as never[], people }, { tripsOn }),
        bills,
        week: billsThisWeek(bills),
        events: eventsTodayTomorrow([...((d.calendar?.events as never[]) || []), ...(school as never[])]),
        trip: nt && nt.days <= 60 ? { dest: nt.trip.destination || "your trip", days: nt.days } : null,
      });
    }).catch(() => { if (alive) setData({ needs: [], bills: [], week: { count: 0, total: 0 }, events: { today: [], tomorrow: [] }, trip: null }); });
    return () => { alive = false; };
  }, [uid, profile, familyMembers, tripsOn, tick]);

  const reload = () => { invalidateHomeDocs(); setTick(t => t + 1); };
  return { data, reload };
}

function NeedsYou({ data, reload }: { data: TodayData | null; reload: () => void }) {
  const uid = useStore(s => s.user?.uid);
  const setActiveTab = useStore(s => s.setActiveTab);
  const [paying, setPaying] = useState<string | null>(null);

  // Same as the Paid button on Bills: tick off this repeat, offer Undo.
  const pay = async (billId: string) => {
    if (!uid || paying) return;
    setPaying(billId);
    try {
      const stored = ((await loadData(uid, "bills"))?.bills as Bill[]) || [];
      const b = stored.find(x => x.id === billId);
      if (!b) return;
      const save = async (list: Bill[]) => {
        await saveData(uid, "bills", JSON.parse(JSON.stringify({ bills: list })));
        import("../../core/localNotifications").then(m => m.syncBillReminders(list, uid)).catch(() => {});
        reload();
      };
      const next = stored.map(x => (x.id === billId ? markPaid(x, new Date(), undefined, uid) : x));
      await save(next);
      toast(t => (
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {b.name} marked paid
          <button onClick={() => { toast.dismiss(t.id); save(next.map(x => (x.id === billId ? undoPaid(x) : x))); }}
            style={{ background: "none", border: "none", color: T.gold, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>Undo</button>
        </span>
      ), { duration: 5000 });
    } catch { toast.error("Couldn't save. Try again from Bills."); }
    finally { setPaying(null); }
  };

  return (
    <div style={card}>
      <p style={eyebrow}>Needs you</p>
      {!data ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 8 }}><Spinner size={18} /></div>
      ) : data.needs.length === 0 ? (
        <p style={{ fontFamily: F.serif, fontSize: 17, fontStyle: "italic", color: T.esp, margin: 0 }}>You're all caught up ✦</p>
      ) : data.needs.map((it, i) => (
        <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i ? `1px solid ${T.linen}` : "none" }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: it.urgent ? T.blush : T.gold, flexShrink: 0 }} />
          <button onClick={() => setActiveTab(it.tab)} style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", minHeight: 36 }}>
            <p style={{ fontFamily: F.sans, fontSize: 13.5, fontWeight: 600, color: T.esp, margin: 0 }}>{it.label}</p>
            {it.detail && <p style={{ fontFamily: F.sans, fontSize: 11.5, color: T.taupe, margin: "1px 0 0" }}>{it.detail}</p>}
          </button>
          {it.billId ? (
            <button onClick={() => pay(it.billId!)} disabled={paying === it.billId}
              style={{ padding: "7px 14px", borderRadius: 20, border: "none", background: T.esp, color: "#fff", fontFamily: F.sans, fontSize: 12, fontWeight: 700, cursor: "pointer", minHeight: 36, flexShrink: 0 }}>
              {paying === it.billId ? "…" : "Paid"}
            </button>
          ) : <span aria-hidden style={{ color: T.taupe, fontSize: 16 }}>›</span>}
        </div>
      ))}
    </div>
  );
}

function ThisWeek({ data }: { data: TodayData | null }) {
  const setActiveTab = useStore(s => s.setActiveTab);
  const currency = useStore(s => (s.profile as { currency?: string } | null)?.currency);
  if (!data) return null;
  const { today, tomorrow } = data.events;
  const row = (e: DayEvent, i: number) => (
    <div key={`${e.date}_${i}`} style={{ display: "flex", gap: 10, padding: "4px 0" }}>
      <span style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, width: 48, flexShrink: 0 }}>{e.time || "All day"}</span>
      <span style={{ fontFamily: F.sans, fontSize: 13, color: T.esp }}>{e.title}</span>
    </div>
  );
  const day = (title: string, list: DayEvent[]) => (
    <div style={{ marginBottom: 8 }}>
      <p style={{ fontFamily: F.sans, fontSize: 11.5, fontWeight: 700, color: T.bark, margin: "0 0 2px" }}>{title}</p>
      {list.length ? list.slice(0, 4).map(row) : <p style={{ fontFamily: F.sans, fontSize: 12.5, color: T.taupe, margin: 0 }}>Nothing planned</p>}
      {list.length > 4 && <p style={{ fontFamily: F.sans, fontSize: 11.5, color: T.taupe, margin: "2px 0 0" }}>+{list.length - 4} more</p>}
    </div>
  );
  const w = data.week;
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <p style={eyebrow}>This week</p>
        <button onClick={() => setActiveTab("plan")} style={linkBtn}>Plan →</button>
      </div>
      {day("Today", today)}
      {day("Tomorrow", tomorrow)}
      <button onClick={() => setActiveTab("budget")} style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: T.sand, border: "none", borderRadius: 12, padding: "10px 12px", marginTop: 4, cursor: "pointer", minHeight: 44 }}>
        <span style={{ fontFamily: F.sans, fontSize: 13, color: T.esp }}>
          {w.count === 0 ? "No bills due this week" : `${w.count} bill${w.count > 1 ? "s" : ""} this week${w.total ? ` · ${formatMoney(w.total, currency)}` : ""}`}
        </span>
        <span aria-hidden style={{ color: T.taupe }}>›</span>
      </button>
      {data.trip && (
        <button onClick={() => setActiveTab("trips")} style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: T.goldP, border: "none", borderRadius: 12, padding: "10px 12px", marginTop: 8, cursor: "pointer", minHeight: 44 }}>
          <span style={{ fontFamily: F.sans, fontSize: 13, color: T.esp }}>✈ Trip to {data.trip.dest} {data.trip.days === 0 ? "today" : `in ${data.trip.days} day${data.trip.days > 1 ? "s" : ""}`}</span>
          <span aria-hidden style={{ color: T.taupe }}>›</span>
        </button>
      )}
    </div>
  );
}

function QuickAdd() {
  const setActiveTab = useStore(s => s.setActiveTab);
  const items = [
    { label: "Add task", icon: "+", go: () => setActiveTab("plan") },
    { label: "Add bill", icon: "$", go: () => setActiveTab("budget") },
    { label: "Ask Cleo", icon: "✦", go: () => openCleo() },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
      {items.map(a => (
        <button key={a.label} onClick={a.go} style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 14, padding: "12px 8px", cursor: "pointer", minHeight: 64 }}>
          <span aria-hidden style={{ display: "block", fontSize: 18, color: T.goldText, marginBottom: 4 }}>{a.icon}</span>
          <span style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: T.esp }}>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

// "Slept 6.5h · 3,200 steps · Rainy, 54°F: see today's outfit" → Me tab.
function YouToday({ weather }: { weather: WeatherData | null }) {
  const uid = useStore(s => s.user?.uid);
  const setActiveTab = useStore(s => s.setActiveTab);
  const [body, setBody] = useState<{ sleep: number | null; steps: number | null } | null>(null);
  useEffect(() => {
    if (!uid) return;
    import("../../core/wellnessAutoTrack").then(m => m.readWearable(uid))
      .then(w => setBody(w ? { sleep: w.sleepHours, steps: w.steps } : null)).catch(() => {});
  }, [uid]);
  const parts = [
    body?.sleep ? `Slept ${Math.round(body.sleep * 10) / 10}h` : null,
    body?.steps ? `${body.steps.toLocaleString("en-US")} steps` : null,
    weather ? `${weather.condition}, ${weather.temp}°${weather.unit}` : null,
  ].filter(Boolean);
  return (
    <button onClick={() => setActiveTab(weather ? "style" : "me")}
      style={{ display: "block", width: "100%", background: "none", border: "none", padding: "6px 4px", textAlign: "center", cursor: "pointer", minHeight: 44 }}>
      <span style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe }}>
        {parts.length ? parts.join(" · ") : "Check in with yourself"}: <span style={{ color: T.goldText, fontWeight: 700 }}>{weather ? "see today's outfit" : "open Me"}</span>
      </span>
    </button>
  );
}

export function TodayScreen() {
  const name = useStore(s => s.profile?.name) || "lovely";
  const [menuOpen, setMenuOpen] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const tripsOn = useTripsEnabled();
  const { data, reload } = useTodayData(tripsOn);

  useEffect(() => {
    import("../../core/weather").then(m => m.getWeatherByLocation()).then(w => { if (w) setWeather(w); }).catch(() => {});
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, margin: "8px 0 18px" }}>
        <div>
          <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.taupe, margin: "0 0 6px" }}>{date}</p>
          <h1 style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: 32, color: T.esp, margin: 0, fontWeight: 500, lineHeight: 1.1 }}>{greeting},<br />{name}.</h1>
        </div>
        <button onClick={() => setMenuOpen(true)} aria-label="Open your menu: profile, family, settings"
          style={{ background: "none", border: "none", padding: 2, cursor: "pointer", borderRadius: "50%", minWidth: 44, minHeight: 44 }}>
          <Avatar size={42} />
        </button>
      </div>

      <GetStartedCard />
      <MorningNote weather={weather} />
      <NeedsYou data={data} reload={reload} />
      <ThisWeek data={data} />
      <QuickAdd />
      <YouToday weather={weather} />

      {menuOpen && <YouMenu onClose={() => setMenuOpen(false)} />}
    </div>
  );
}
