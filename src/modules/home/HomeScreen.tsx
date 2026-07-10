import React, { useEffect, useState } from "react";
import { T, F } from "../../config/theme";
import toast from "react-hot-toast";
import { useStore } from "../../core/store";
import { useAdaptiveUX, filterInsightsForDisplay, getStateBannerProps, getAdaptiveGreeting } from "../../core/household/adaptiveUX";
import { loadData } from "../../core/firebase";
import { db } from "../../core/db";
import { Spinner } from "../../shared/components";
import { createActionsFromInsight, executeRecommendedAction } from "../../core/recommendationActions";
import { CleoSetupScreen } from "../onboarding/OnboardingScreen";
import { buildHouseholdSnapshot, generateHouseholdInsights, getTopInsight, loadHouseholdInsights, saveHouseholdInsights } from "../../core/household";
import { computeHouseholdScores, type HouseholdScores, type ScoreBand, type AttentionSeverity } from "../../core/intelligence/householdScores";

import { loadHomeDocs } from "./homeData";
import { BAND_COLOR, SEV_COLOR, SEV_RANK, SOURCE_TAB, cc_str } from "./homeShared";
import { BriefingHero } from "./BriefingHero";
import { HouseholdPulseCard } from "./HouseholdPulseCard";
import { CommandCenterCard } from "./CommandCenterCard";

function ScoreDial({ label, score, band, headline }: { label: string; score: number; band: ScoreBand; headline: string }) {
  const color = BAND_COLOR[band];
  return (
    <div style={{ flex: 1, background: "#fff", border: `1px solid ${T.linen}`, borderRadius: 14, padding: "12px 12px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontFamily: F.sans, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.taupe }}>{label}</span>
        <span style={{ fontFamily: F.serif, fontSize: 24, fontWeight: 700, color }}>{score}</span>
      </div>
      <div style={{ height: 4, background: T.linen, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.6s ease" }} />
      </div>
      <p style={{ fontFamily: F.sans, fontSize: 10.5, color: T.bark, margin: 0, lineHeight: 1.4 }}>
        <span style={{ fontWeight: 700, color, textTransform: "capitalize" }}>{band}</span> · {headline}
      </p>
    </div>
  );
}

function HouseholdScoresCard() {
  const { user, profile } = useStore();
  const [scores, setScores] = useState<HouseholdScores | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    (async () => {
      try {
        const { buildAppContext } = await import("../../core/contextBuilder");
        const appCtx = await buildAppContext(user.uid, (profile ?? {}) as unknown as Record<string, unknown>);
        if (alive) setScores(computeHouseholdScores(appCtx));
      } catch (e) {
        console.warn("[Home] scores failed:", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.uid]);

  if (loading) return (
    <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12, display: "flex", justifyContent: "center" }}>
      <Spinner size={20} />
    </div>
  );
  if (!scores) return null;

  return (
    <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12 }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>HOUSEHOLD INTELLIGENCE</p>

      {/* Resilience + Productivity dials (the Risk Radar lives in the Command Center) */}
      <div style={{ display: "flex", gap: 8 }}>
        <ScoreDial label="Resilience" score={scores.resilience.score} band={scores.resilience.band} headline={scores.resilience.headline} />
        <ScoreDial label="Productivity" score={scores.productivity.score} band={scores.productivity.band} headline={scores.productivity.headline} />
      </div>
    </div>
  );
}

function IntelligenceCard() {
  const { user } = useStore();
  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    const today = new Date().toISOString().split("T")[0];
    loadHomeDocs(user.uid).then(({ tasks: tasksD, budget: budgetD, calendar: calendarD, school: schoolD, trips: tripsD, circle: circleD }) => {
      const allTasks = (tasksD?.tasks as any[]) || [];
      const pending = allTasks.filter((t: any) => t.status !== "completed");
      const overdue = pending.filter((t: any) => t.dueDate && t.dueDate < today);
      const categories = (budgetD?.categories as any[]) || [];
      const totalBudget = categories.reduce((s: number, c: any) => s + (c.budget || 0), 0);
      const totalSpent = categories.reduce((s: number, c: any) => s + (c.spent || 0), 0);
      const budgetPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
      const budgetStatus = budgetPct >= 95 ? "critical" : budgetPct >= 85 ? "warning" : budgetPct >= 70 ? "watch" : "healthy";
      const calEvents = (calendarD?.events as any[]) || [];
      const todayEvents = calEvents.filter((e: any) => e.date === today);
      const schoolEvents = (schoolD?.events as any[]) || [];
      const urgentSchool = schoolEvents.filter((e: any) => e.requiresAction && e.actionDeadline >= today);
      const trips = (tripsD?.trips as any[]) || [];
      const upcoming = trips.filter((t: any) => t.departureDate > today).sort((a: any, b: any) => a.departureDate.localeCompare(b.departureDate));
      const nextTrip = upcoming[0];
      const daysUntil = nextTrip ? Math.ceil((new Date(nextTrip.departureDate).getTime() - Date.now()) / 86400000) : null;
      const contacts = (circleD?.contacts as any[]) || [];
      const circleOverdue = contacts.filter((c: any) => {
        if (!c.lastContact) return true;
        const days = Math.floor((Date.now() - new Date(c.lastContact).getTime()) / 86400000);
        const freq = c.frequency === "weekly" ? 7 : c.frequency === "monthly" ? 30 : 90;
        return days > freq;
      }).length;
      setData({ pending: pending.length, overdue: overdue.length, budgetPct, budgetStatus, todayEvents: todayEvents.length, nextEvent: todayEvents[0], urgentSchool: urgentSchool.length, urgentSchoolItem: urgentSchool[0], nextTrip, daysUntil, circleOverdue });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user?.uid]);

  const budgetColor = data.budgetStatus === "critical" ? "#dc2626" : data.budgetStatus === "warning" ? T.gold : T.sage;

  return (
    <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12 }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>TODAY'S INTELLIGENCE</p>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}><Spinner size={20} /></div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div onClick={() => useStore.getState().setActiveTab("plan")} style={{ background: "#fff", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: `1px solid ${T.linen}`, cursor: "pointer" }}>
              <p style={{ fontFamily: F.serif, fontSize: 20, fontWeight: 700, color: data.overdue > 0 ? "#dc2626" : T.esp, margin: "0 0 2px" }}>{data.pending || 0}</p>
              <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Tasks{data.overdue > 0 ? ` · ${data.overdue} late` : ""}</p>
            </div>
            <div onClick={() => useStore.getState().setActiveTab("calendar")} style={{ background: "#fff", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: `1px solid ${T.linen}`, cursor: "pointer" }}>
              <p style={{ fontFamily: F.serif, fontSize: 20, fontWeight: 700, color: T.esp, margin: "0 0 2px" }}>{data.todayEvents || 0}</p>
              <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Events</p>
            </div>
            <div onClick={() => useStore.getState().setActiveTab("budget")} style={{ background: "#fff", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: `1px solid ${T.linen}`, cursor: "pointer" }}>
              <p style={{ fontFamily: F.serif, fontSize: 20, fontWeight: 700, color: budgetColor, margin: "0 0 2px" }}>{data.budgetPct || 0}%</p>
              <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Budget</p>
            </div>
          </div>
          {data.urgentSchool > 0 && (
            <div onClick={() => useStore.getState().setActiveTab("plan")} style={{ display: "flex", gap: 10, padding: "8px 10px", background: `${T.blush}10`, borderRadius: 10, marginBottom: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>🎒</span>
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0 }}>{data.urgentSchoolItem?.title || `${data.urgentSchool} school action needed`}</p>
            </div>
          )}
          {data.nextTrip && data.daysUntil !== null && data.daysUntil <= 30 && (
            <div onClick={() => useStore.getState().setActiveTab("trips")} style={{ display: "flex", gap: 10, padding: "8px 10px", background: `${T.gold}10`, borderRadius: 10, marginBottom: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>✈️</span>
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0 }}>{data.nextTrip.destination} in {data.daysUntil} days</p>
            </div>
          )}
          {data.circleOverdue > 0 && (
            <div onClick={() => useStore.getState().setActiveTab("circle")} style={{ display: "flex", gap: 10, padding: "8px 10px", background: `${T.gold}10`, borderRadius: 10, marginBottom: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>💌</span>
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0 }}>{data.circleOverdue} check-in{data.circleOverdue > 1 ? "s" : ""} overdue</p>
            </div>
          )}
          {data.nextEvent && (
            <div onClick={() => useStore.getState().setActiveTab("calendar")} style={{ display: "flex", gap: 10, padding: "8px 10px", background: `${T.sage}10`, borderRadius: 10, marginBottom: 6, cursor: "pointer" }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>📅</span>
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0 }}>{data.nextEvent.title}{data.nextEvent.time ? ` · ${data.nextEvent.time}` : ""}</p>
            </div>
          )}
          {!data.urgentSchool && !data.nextTrip && !data.circleOverdue && !data.nextEvent && data.pending === 0 && (
            <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, textAlign: "center", padding: "8px 0", fontStyle: "italic" }}>You're all caught up ✦</p>
          )}
          <p onClick={() => useStore.getState().setActiveTab("plan")} style={{ fontFamily: F.sans, fontSize: 11, color: T.gold, margin: "8px 0 0", cursor: "pointer", textAlign: "right" }}>See full plan →</p>
        </>
      )}
    </div>
  );
}

// ── Family HQ Card (unchanged) ────────────────────────────────────
function FamilyHQCard() {
  const { familyMembers } = useStore();
  if (familyMembers.length === 0) return null;
  const ROLE_ICONS: Record<string, string> = { partner: "💛", child: "⭐", parent: "🌿", inlaw: "🌸", other: "✦" };
  return (
    <div onClick={() => useStore.getState().setActiveTab("family")} style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: 0 }}>FAMILY HQ</p>
        <span style={{ fontFamily: F.sans, fontSize: 11, color: T.gold }}>View →</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {familyMembers.slice(0, 4).map((m, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: `${m.color}20`, border: `1.5px solid ${m.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
              {ROLE_ICONS[m.role]}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>{m.name}</p>
              {m.notes && <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>{m.notes}</p>}
            </div>
          </div>
        ))}
      </div>
      <div onClick={(e) => { e.stopPropagation(); useStore.getState().setActiveTab("cleo"); }} style={{ marginTop: 10, padding: "8px 12px", background: `${T.gold}10`, borderRadius: 10, textAlign: "center" }}>
        <p style={{ fontFamily: F.sans, fontSize: 12, color: T.gold, margin: 0, fontWeight: 600 }}>✦ Ask Cleo about your family</p>
      </div>
    </div>
  );
}

// ── Module Grid (unchanged) ───────────────────────────────────────
function ModuleGrid() {
  const { user } = useStore();
  const setActiveTab = useStore(s => s.setActiveTab);
  const [badges, setBadges] = useState<Record<string, number | string>>({});

  useEffect(() => {
    if (!user?.uid) return;
    const today = new Date().toISOString().split("T")[0];
    loadHomeDocs(user.uid).then(({ tasks: tasksD, budget: budgetD, circle: circleD, trips: tripsD, thrive: thriveD, calendar: calendarD }) => {
      const b: Record<string, number | string> = {};
      const tasks = (tasksD?.tasks as any[]) || [];
      const overdue = tasks.filter((t: any) => t.status !== "completed" && t.dueDate && t.dueDate < today).length;
      if (overdue > 0) b.plan = overdue;
      const cats = (budgetD?.categories as any[]) || [];
      const overBudget = cats.filter((c: any) => c.budget > 0 && (c.spent / c.budget) >= 0.8).length;
      if (overBudget > 0) b.budget = overBudget;
      const contacts = (circleD?.contacts as any[]) || [];
      const circleOverdue = contacts.filter((c: any) => {
        if (!c.lastContact) return true;
        const days = Math.floor((Date.now() - new Date(c.lastContact).getTime()) / 86400000);
        const freq = c.frequency === "weekly" ? 7 : c.frequency === "monthly" ? 30 : 90;
        return days > freq;
      }).length;
      if (circleOverdue > 0) b.circle = circleOverdue;
      const trips = (tripsD?.trips as any[]) || [];
      const soon = trips.filter((t: any) => {
        const days = Math.ceil((new Date(t.departureDate).getTime() - Date.now()) / 86400000);
        return days >= 0 && days <= 14;
      });
      if (soon.length > 0) {
        const days = Math.ceil((new Date(soon[0].departureDate).getTime() - Date.now()) / 86400000);
        b.trips = days === 0 ? "today" : `${days}d`;
      }
      const logs = (thriveD?.logs as any[]) || [];
      const loggedToday = logs.some((l: any) => l.date === today);
      if (!loggedToday) b.thrive = "!";
      const events = (calendarD?.events as any[]) || [];
      const todayEvents = events.filter((e: any) => e.date === today).length;
      if (todayEvents > 0) b.calendar = todayEvents;
      setBadges(b);
    }).catch(() => {});
  }, [user?.uid]);

  const modules = [
    { id: "style",    label: "Style",    icon: "✦", sub: "What should I wear?",  color: T.blush },
    { id: "trips",    label: "Trips",    icon: "→", sub: "Plan your next escape", color: T.orange },
    { id: "thrive",   label: "Thrive",   icon: "◦", sub: "Log today's mood",     color: T.sage },
    { id: "circle",   label: "Circle",   icon: "◉", sub: "Your people",          color: T.sky },
    { id: "budget",   label: "Budget", icon: "◎", sub: "Household CFO",        color: T.yellow },
    { id: "plan",     label: "Plan",     icon: "◈", sub: "Tasks & meals",        color: T.esp },
    { id: "calendar", label: "Calendar", icon: "◆", sub: "Your schedule",        color: T.navy },
    { id: "family",   label: "Family",   icon: "⌂", sub: "Command centre",      color: T.gold },
    { id: "memory",   label: "Memory",   icon: "✦", sub: "What Cleo knows",      color: T.lav },
    { id: "connections", label: "Connect", icon: "⚯", sub: "Integrations",        color: T.teal },
  ];

  return (
    <div>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" }}>YOUR MODULES</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {modules.map((m, i) => (
          <div key={i} onClick={() => setActiveTab(m.id)}
            style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 16, padding: "14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, position: "relative", transition: "transform 0.15s ease" }}
            onMouseDown={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.97)"; }}
            onMouseUp={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
            onTouchStart={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.97)"; }}
            onTouchEnd={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: `${m.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, color: m.color, position: "relative" }}>
              {m.icon}
              {badges[m.id] !== undefined && (
                <div style={{ position: "absolute", top: -6, right: -6, background: m.id === "thrive" ? T.gold : T.blush, borderRadius: 20, minWidth: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", border: "2px solid #fff" }}>
                  <span style={{ fontFamily: F.sans, fontSize: 9, fontWeight: 700, color: "#fff" }}>{badges[m.id]}</span>
                </div>
              )}
            </div>
            <div>
              <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 700, color: T.esp, margin: "0 0 2px" }}>{m.label}</p>
              <p style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, margin: 0 }}>{m.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main HomeScreen ───────────────────────────────────────────────
// ── Post-onboarding guide ──────────────────────────────────────────
// Onboarding is delightful, then new users land on ten tiles with no map.
// Three steps to first real value; disappears once done or dismissed.
function GetStartedCard() {
  const { user } = useStore();
  const setActiveTab = useStore(s => s.setActiveTab);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("hn_getstarted_done") === "1");
  const [steps, setSteps] = useState<{ income: boolean; task: boolean; connect: boolean } | null>(null);

  useEffect(() => {
    if (!user?.uid || dismissed) return;
    let alive = true;
    (async () => {
      try {
        const docs = await loadHomeDocs(user.uid);
        const incomes = (docs.budget?.incomes as any[]) || [];
        const tasks = (docs.tasks?.tasks as any[]) || [];
        const { doc, getDoc } = await import("firebase/firestore");
        const { db } = await import("../../core/firebase");
        const snaps = await Promise.all(["google_calendar", "apple_calendar", "oura", "gmail"].map(d =>
          getDoc(doc(db, "users", user.uid, "integrations", d)).catch(() => null)));
        const connected = snaps.some(s => s?.exists());
        if (alive) setSteps({ income: incomes.length > 0, task: tasks.length > 0, connect: connected });
      } catch { if (alive) setSteps(null); }
    })();
    return () => { alive = false; };
  }, [user?.uid, dismissed]);

  if (dismissed || !steps) return null;
  const items = [
    { done: steps.income, label: "Add your income", sub: "unlocks the CFO & health score", tab: "budget" },
    { done: steps.task, label: "Add your first task", sub: "or just tell Cleo", tab: "plan" },
    { done: steps.connect, label: "Connect a calendar or your ring", sub: "so Cleo sees your real life", tab: "connections" },
  ];
  const doneCount = items.filter(i => i.done).length;
  if (doneCount === items.length) { localStorage.setItem("hn_getstarted_done", "1"); return null; }

  return (
    <div style={{ background: T.ivory, border: `1.5px solid ${T.gold}40`, borderRadius: 20, padding: "16px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.goldText, margin: 0 }}>GETTING STARTED · {doneCount}/3</p>
        <button onClick={() => { localStorage.setItem("hn_getstarted_done", "1"); setDismissed(true); }}
          style={{ background: "none", border: "none", color: T.taupe, fontSize: 15, cursor: "pointer", padding: 0 }}>×</button>
      </div>
      {items.map((it, i) => (
        <div key={i} onClick={() => !it.done && setActiveTab(it.tab)}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < items.length - 1 ? `1px solid ${T.linen}` : "none", cursor: it.done ? "default" : "pointer", opacity: it.done ? 0.55 : 1, touchAction: "manipulation" }}>
          <span style={{ width: 20, textAlign: "center", color: it.done ? T.sage : T.gold, fontSize: 14, flexShrink: 0 }}>{it.done ? "✓" : "→"}</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0, textDecoration: it.done ? "line-through" : "none" }}>{it.label}</p>
            <p style={{ fontFamily: F.sans, fontSize: 10.5, color: T.taupe, margin: "1px 0 0" }}>{it.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function HomeScreen() {
  const { profile } = useStore();
  const setActiveTab = useStore(s => s.setActiveTab);
  const name = profile?.name || "lovely";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <div style={{ marginBottom: 20, paddingTop: 8 }}>
        <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: T.taupe, margin: "0 0 6px" }}>{date}</p>
        <h1 style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: 34, color: T.esp, margin: "0 0 16px", fontWeight: 500, lineHeight: 1.1 }}>
          {greeting},<br />{name}.
        </h1>
      </div>

      <GetStartedCard />
      <CommandCenterCard />
      <BriefingHero onExpand={() => setActiveTab("briefing")} />
      <HouseholdPulseCard />
      <HouseholdScoresCard />
      <IntelligenceCard />
      <FamilyHQCard />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
        {[
          { label: "Brief", icon: "☀", tab: "briefing", color: T.gold },
          { label: "Chat Cleo", icon: "✦", tab: "cleo", color: T.esp },
          { label: "Add Task", icon: "+", tab: "plan", color: T.sage },
        ].map((a, i) => (
          <div key={i} onClick={() => setActiveTab(a.tab)} style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 14, padding: "12px 8px", cursor: "pointer", textAlign: "center" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `${a.color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, margin: "0 auto 6px", color: a.color }}>{a.icon}</div>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color: T.esp, margin: 0 }}>{a.label}</p>
          </div>
        ))}
      </div>

      <ModuleGrid />
    </div>
  );
}
