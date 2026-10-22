// ─── Today ─────────────────────────────────────────────────────────
// The calm, prioritized start to the day (Wisteria, lavender-led). It
// answers four questions in order: what matters today (Cleo's briefing),
// what needs me, what is already handled, and is there anything for me.
// Get Started shows until setup is done. The picture opens the You menu.
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { T, F, S, TYPE, ATMOS, ATMOS_TEXT2 } from "../../config/theme";
import { useStore } from "../../core/store";
import { loadData } from "../../core/firebase";
import { todayLocal } from "../../core/dateAwareness";
import { openCleo } from "../../shared/utils/openCleo";
import { type Bill } from "../../core/bills";
import { payBill, undoBillPayment } from "../bills/billActions";
import { answerTask } from "../../core/taskActions";
import type { OwnedTask } from "../../core/taskOwnership";
import { formatMoney } from "../../shared/utils/money";
import {
  Card, SectionHeader, ListRow, StatusChip, QuickAction, Button, TextButton,
  Skeleton, SkeletonRows, GlowCard, HeroNumber, Headline, Detail, LargeTitle, PullToRefresh,
  DayTimeline, SparkArea,
} from "../../shared/components";
import { showUndoToast } from "../../shared/components/undoToast";
import { haptic } from "../../shared/haptics";
import { PlusIcon, SparkleIcon, CheckIcon, BudgetIcon, PlanIcon, CalendarIcon, StarIcon, TripsIcon } from "../../shared/components/Icons";
import type { WeatherData } from "../../core/weather";
import { loadHomeDocs, invalidateHomeDocs } from "./homeData";
import { GetStartedCard } from "./GetStartedCard";
import { MailInboxCard } from "./MailInboxCard";
import {
  buildNeedsYou, billsThisWeek, eventsTodayTomorrow, nextTrip, alreadyHandled, dayHeadline,
  type NeedsItem, type NeedsKind, type Person, type DayEvent, type HandledItem,
} from "./todayData";
import { cachedBriefing, generateBriefing, type Briefing } from "../briefing/generateBriefing";
import { Avatar, YouMenu } from "../me/YouMenu";
import { useTripsEnabled } from "../me/extras";

// ── Cleo's briefing ─────────────────────────────────────────────────
function Briefing({ weather }: { weather: WeatherData | null }) {
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
      else write();   // first open of the day
    });
    return () => { alive = false; };
    // Only on open: a new weather reading shouldn't write a second note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, !!profile]);

  const weatherLine = weather ? `${weather.temp}°${weather.unit}, ${weather.condition.toLowerCase()}` : null;
  const body: React.CSSProperties = { fontFamily: F.sans, fontSize: TYPE.body, color: T.text, lineHeight: 1.5, margin: 0 };
  const ink = ATMOS.cleo.ink;

  // One line in large type, two priorities under it, the rest one tap away.
  const why = briefing?.focusWord?.why?.trim();
  const pri = (briefing?.priorities || []).slice(0, 3);
  const headline = why ? (/[.!?]$/.test(why) ? why : `${why}.`) : pri[0]?.text;
  const rest = why ? pri : pri.slice(1);

  return (
    <GlowCard tint="cleo" grain eyebrow="Your briefing from Cleo">
      {state === "failed" ? (
        <>
          <p style={body}>Cleo couldn't write your briefing just now.</p>
          <TextButton onClick={write} color={ink}>Try again</TextButton>
        </>
      ) : state !== "ready" || !briefing ? (
        <div role="status" aria-label={state === "writing" ? "Cleo is writing your briefing" : "Loading your briefing"}>
          <Skeleton onTint height={22} width="92%" radius={8} />
          <Skeleton onTint height={22} width="70%" radius={8} style={{ marginTop: 8 }} />
          <Skeleton onTint height={14} width="80%" style={{ marginTop: 18 }} />
          <Skeleton onTint height={14} width="60%" style={{ marginTop: 10 }} />
          <p style={{ fontFamily: F.sans, fontSize: TYPE.support, color: ATMOS_TEXT2, margin: "14px 0 0" }}>{state === "writing" ? "Cleo is writing your briefing…" : "Loading…"}</p>
        </div>
      ) : (
        <>
          {briefing.focusWord?.word && (
            <span style={{ display: "inline-block", fontFamily: F.sans, fontSize: 13, fontWeight: 700, color: ink, background: "rgba(255,255,255,.6)", borderRadius: 99, padding: "4px 10px", marginBottom: 10 }}>
              Focus: {briefing.focusWord.word}
            </span>
          )}
          {headline && <Headline size={24}>{headline}</Headline>}
          {rest.length > 0 && (
            <div style={{ marginTop: 14, borderTop: "1px solid rgba(76,59,116,.14)" }}>
              {rest.slice(0, 2).map((p, i) => (
                <p key={i} style={{ ...body, fontSize: 15, display: "flex", gap: 10, padding: "10px 0 0" }}>
                  <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center", background: "rgba(255,255,255,.7)", color: ink, fontSize: 12, fontWeight: 800 }}>{i + 1}</span>
                  <span>{p.text}</span>
                </p>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: S.sm, marginTop: 6 }}>
            <TextButton color={ink} onClick={() => setActiveTab("briefing")}>{rest.length > 2 ? "See all of it ›" : "Full briefing ›"}</TextButton>
            {weatherLine && <span style={{ fontFamily: F.sans, fontSize: TYPE.support, color: ATMOS_TEXT2 }}>{weatherLine}</span>}
          </div>
        </>
      )}
    </GlowCard>
  );
}

// ── Today at a glance ───────────────────────────────────────────────
// The hero: how many things today, the next one, and the day as a line.
function TodayHero({ data, failed }: { data: TodayData | null; failed: boolean }) {
  const a = ATMOS.plan;
  if (failed) return null;
  if (!data) return (
    <GlowCard tint="plan" eyebrow="Today at a glance" reveal={false}>
      <div role="status" aria-label="Loading today">
        <Skeleton onTint width={90} height={48} radius={12} />
        <Skeleton onTint width="75%" height={20} style={{ marginTop: 14 }} />
        <Skeleton onTint height={26} style={{ marginTop: 18 }} />
      </div>
    </GlowCard>
  );
  const events = data.events.today;
  const needs = data.needs.length;
  const count = events.length + needs;
  const parts = [
    events.length ? `${events.length} on the calendar` : null,
    needs ? `${needs} need${needs === 1 ? "s" : ""} you` : null,
  ].filter(Boolean).join(" · ");
  return (
    <GlowCard tint="plan" eyebrow="Today at a glance" reveal={false}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: S.md }}>
        <HeroNumber value={count} unit={count === 1 ? "thing today" : "things today"} label={parts || "Nothing planned"} />
      </div>
      <Headline size={21} style={{ marginTop: 14 }}>{dayHeadline(events, needs)}</Headline>
      {events.some(e => e.time) && (
        <div style={{ marginTop: 16 }}>
          <DayTimeline times={events.map(e => e.time || "")} color={a.chart} soft={a.chartSoft} textColor={ATMOS_TEXT2} />
        </div>
      )}
    </GlowCard>
  );
}

// ── Shared data for Needs, Handled and This week ────────────────────
interface TodayData {
  needs: NeedsItem[]; handled: HandledItem[]; tasks: OwnedTask[]; bills: Bill[];
  week: { count: number; total: number };
  events: { today: DayEvent[]; tomorrow: DayEvent[] };
  trip: { dest: string; days: number } | null;
}
const EMPTY: TodayData = { needs: [], handled: [], tasks: [], bills: [], week: { count: 0, total: 0 }, events: { today: [], tomorrow: [] }, trip: null };

function useTodayData(tripsOn: boolean) {
  const uid = useStore(s => s.user?.uid);
  const profile = useStore(s => s.profile);
  const familyMembers = useStore(s => s.familyMembers);
  const [data, setData] = useState<TodayData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    loadHomeDocs(uid).then(d => {
      if (!alive) return;
      const bills = ((d.bills?.bills as Bill[]) || []).filter(b => b && b.name);
      const tasks = (d.tasks?.tasks as OwnedTask[]) || [];
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
      setFailed(false);
      setData({
        needs: buildNeedsYou({ bills, tasks, school: school as never[], trips: trips as never[], people }, { tripsOn, viewerUid: uid }),
        handled: alreadyHandled(tasks, uid),
        tasks,
        bills,
        week: billsThisWeek(bills),
        events: eventsTodayTomorrow([...((d.calendar?.events as never[]) || []), ...(school as never[])]),
        trip: nt && nt.days <= 60 ? { dest: nt.trip.destination || "your trip", days: nt.days } : null,
      });
    }).catch(() => { if (alive) { setFailed(true); setData(EMPTY); } });
    return () => { alive = false; };
  }, [uid, profile, familyMembers, tripsOn, tick]);

  const reload = () => { invalidateHomeDocs(); setTick(t => t + 1); };
  return { data, failed, reload };
}

// Each kind of item gets a small tinted icon, so the list scans quickly.
// The words still carry the meaning; color only supports them.
const KIND: Record<NeedsKind, { bg: string; ink: string; Icon: typeof PlanIcon }> = {
  bill:     { bg: T.householdBg, ink: T.householdInk, Icon: BudgetIcon },
  task:     { bg: T.planBg,      ink: T.planInk,      Icon: PlanIcon },
  school:   { bg: T.planBg,      ink: T.planInk,      Icon: CalendarIcon },
  birthday: { bg: T.personalBg,  ink: T.personalInk,  Icon: StarIcon },
  trip:     { bg: T.cleoBg,      ink: T.action,       Icon: TripsIcon },
};
function KindIcon({ kind }: { kind: NeedsKind }) {
  const k = KIND[kind];
  return (
    <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11, background: k.bg, display: "grid", placeItems: "center", flexShrink: 0 }}>
      <k.Icon size={19} color={k.ink} />
    </span>
  );
}

// Urgent items get a written label, never just a color.
function urgencyChip(it: NeedsItem) {
  if (!it.urgent) return null;
  if (/overdue|\blate\b/i.test(`${it.label} ${it.detail}`)) return <StatusChip status="overdue">Overdue</StatusChip>;
  return <StatusChip status="dueSoon">{it.kind === "trip" ? "Soon" : "Today"}</StatusChip>;
}

// ── Needs your attention ────────────────────────────────────────────
function NeedsYou({ data, failed, reload }: { data: TodayData | null; failed: boolean; reload: () => void }) {
  const uid = useStore(s => s.user?.uid);
  const setActiveTab = useStore(s => s.setActiveTab);
  const [busy, setBusy] = useState<string | null>(null);

  // Same as Mark as paid on Bills: tick off this repeat, offer Undo.
  const pay = async (billId: string) => {
    if (!uid || busy) return;
    setBusy(billId);
    try {
      const b = data?.bills.find(x => x.id === billId);
      if (!b) return;
      const r = await payBill(uid, b);
      const resync = () => import("../../core/localNotifications").then(m => m.syncBillRemindersFromCloud(uid)).catch(() => {});
      resync();
      reload();
      if (r.status === "already") { toast(`${b.name} is already marked paid`); return; }
      haptic("success");
      showUndoToast(`${b.name} marked as paid`, () => {
        undoBillPayment(uid, r.bill, r.due).then(() => { resync(); reload(); }).catch(() => {});
      });
    } catch { toast.error("Couldn't save. Try again from Bills."); }
    finally { setBusy(null); }
  };

  // A task someone asked you to take: say yes or no right here.
  const answer = async (taskId: string, yes: boolean) => {
    const t = data?.tasks.find(x => x.id === taskId);
    if (!t || busy) return;
    setBusy(taskId);
    try {
      const r = await answerTask(t, yes);
      reload();
      if (r) toast.success(yes ? "Accepted. It's yours now." : "Declined. They'll see it's back with them.");
    } catch { toast.error("Couldn't save. Try again from Plan."); }
    finally { setBusy(null); }
  };

  return (
    <>
      <SectionHeader title="Needs your attention" action="See all" onAction={() => setActiveTab("plan")} />
      <Card style={{ padding: `${S.xs}px ${S.lg}px` }}>
        {!data ? (
          <SkeletonRows rows={2} />
        ) : failed ? (
          <div role="alert" style={{ padding: `${S.md}px 0` }}>
            <p style={{ fontFamily: F.sans, fontSize: TYPE.body, color: T.text, margin: 0 }}>Couldn't load today's list.</p>
            <TextButton onClick={reload}>Try again</TextButton>
          </div>
        ) : data.needs.length === 0 ? (
          <ListRow divider={false}
            leading={<span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11, background: T.householdBg, display: "grid", placeItems: "center" }}><CheckIcon size={18} color={T.householdInk} strokeWidth={2.4} /></span>}
            title="You're all caught up"
            detail="Nothing needs you right now." />
        ) : data.needs.map((it, i) => (
          <ListRow key={it.id} divider={i > 0}
            leading={<KindIcon kind={it.kind} />}
            title={<button onClick={() => setActiveTab(it.tab)} style={{ all: "unset", cursor: "pointer", display: "block" }}>{it.label}</button>}
            detail={<span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {urgencyChip(it)}
              {it.detail}
            </span>}
            trailing={it.billId ? (
              <Button size="sm" onClick={() => pay(it.billId!)} disabled={busy === it.billId} style={{ width: "auto" }} ariaLabel={`Mark ${it.label} as paid`}>
                {busy === it.billId ? "Saving…" : "Mark paid"}
              </Button>
            ) : it.taskId ? null : <span aria-hidden="true" style={{ color: T.text2, fontSize: 20 }}>›</span>}
            actions={it.taskId ? (
              <>
                <Button size="sm" onClick={() => answer(it.taskId!, true)} disabled={busy === it.taskId} style={{ width: "auto" }}>Accept</Button>
                <Button size="sm" variant="secondary" onClick={() => answer(it.taskId!, false)} disabled={busy === it.taskId} style={{ width: "auto" }}>Decline</Button>
              </>
            ) : undefined}
          />
        ))}
      </Card>
    </>
  );
}

// ── Already handled ─────────────────────────────────────────────────
function Handled({ items }: { items: HandledItem[] }) {
  if (!items.length) return null;
  return (
    <>
      <SectionHeader title="Already handled" />
      <Card style={{ padding: `${S.xs}px ${S.lg}px` }}>
        {items.map((h, i) => (
          <ListRow key={h.id} divider={i > 0}
            leading={<span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: "50%", background: T.householdBg, color: T.householdInk, display: "grid", placeItems: "center", fontFamily: F.sans, fontWeight: 700, fontSize: 15 }}>{h.who.charAt(0).toUpperCase()}</span>}
            title={h.title}
            detail={`${h.who} is handling it`}
            trailing={<StatusChip status="handled">Handled</StatusChip>} />
        ))}
      </Card>
    </>
  );
}

// "17:00" → "5:00 PM"; anything else is shown as saved.
function clockTime(t?: string): string {
  if (!t) return "All day";
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return t;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

// ── This week ───────────────────────────────────────────────────────
function ThisWeek({ data }: { data: TodayData | null }) {
  const setActiveTab = useStore(s => s.setActiveTab);
  const currency = useStore(s => (s.profile as { currency?: string } | null)?.currency);
  if (!data) return null;
  const { today, tomorrow } = data.events;
  const rows = [
    ...today.slice(0, 3).map(e => ({ ...e, day: "Today" })),
    ...tomorrow.slice(0, 2).map(e => ({ ...e, day: "Tomorrow" })),
  ];
  const w = data.week;
  return (
    <>
      <SectionHeader title="This week" action="Plan" onAction={() => setActiveTab("plan")} />
      <Card style={{ padding: `${S.xs}px ${S.lg}px` }}>
        {rows.length === 0 && (
          <ListRow divider={false} title="Nothing on the calendar" detail="Today and tomorrow are clear." />
        )}
        {rows.map((e, i) => (
          <ListRow key={`${e.date}_${i}`} divider={i > 0}
            leading={<span style={{ width: 64, flexShrink: 0, fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.planInk, fontVariantNumeric: "tabular-nums" }}>{clockTime(e.time)}</span>}
            title={e.title}
            detail={e.day} />
        ))}
        <ListRow divider onClick={() => setActiveTab("budget")}
          ariaLabel="Open Bills"
          leading={<KindIcon kind="bill" />}
          title={w.count === 0 ? "No bills due this week" : `${w.count} bill${w.count > 1 ? "s" : ""} due this week`}
          detail={w.total ? `About ${formatMoney(w.total, currency)}` : undefined}
          trailing={<span aria-hidden="true" style={{ color: T.text2, fontSize: 20 }}>›</span>} />
        {data.trip && (
          <ListRow divider onClick={() => setActiveTab("trips")}
            ariaLabel="Open Trips"
            leading={<KindIcon kind="trip" />}
            title={`Trip to ${data.trip.dest}`}
            detail={data.trip.days === 0 ? "Today" : `In ${data.trip.days} day${data.trip.days > 1 ? "s" : ""}`}
            trailing={<span aria-hidden="true" style={{ color: T.text2, fontSize: 20 }}>›</span>} />
        )}
      </Card>
    </>
  );
}

// ── Quick actions ───────────────────────────────────────────────────
function QuickActions() {
  const setActiveTab = useStore(s => s.setActiveTab);
  return (
    <div style={{ display: "flex", gap: S.sm, marginBottom: S.xs }}>
      <QuickAction tint="plan" label="Add task" icon={<PlusIcon size={18} strokeWidth={2.2} />} onClick={() => setActiveTab("plan")} />
      <QuickAction tint="household" label="Add bill" icon={<PlusIcon size={18} strokeWidth={2.2} />} onClick={() => setActiveTab("budget")} />
      <QuickAction tint="cleo" label="Ask Cleo" icon={<SparkleIcon size={17} filled />} onClick={() => openCleo()} />
    </div>
  );
}

// ── A moment for yourself ───────────────────────────────────────────
// Only shown when there's something real to offer (sleep, steps or the
// weather for today's outfit). Otherwise it stays out of the way.
function MomentForYou({ weather }: { weather: WeatherData | null }) {
  const uid = useStore(s => s.user?.uid);
  const setActiveTab = useStore(s => s.setActiveTab);
  const [body, setBody] = useState<{ sleep: number | null; steps: number | null; week: (number | null)[] } | null>(null);
  const [look, setLook] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    import("../../core/wellnessAutoTrack").then(m => m.readWearable(uid))
      .then(w => setBody(w ? { sleep: w.sleepHours, steps: w.steps, week: (w.history || []).slice(-7).map(p => p.sleepHours) } : null)).catch(() => {});
    // Today's look from Style, if Cleo already put one together today
    loadData(uid, "style").then((d: Record<string, unknown> | null) => {
      const t = d?.todayOutfit as { date?: string; outfit?: { headline?: string } } | undefined;
      setLook(t && t.date === todayLocal() && t.outfit?.headline ? t.outfit.headline : null);
    }).catch(() => {});
  }, [uid]);
  const sleep = body?.sleep ? Math.round(body.sleep * 10) / 10 : null;
  const parts = [
    body?.steps ? `${body.steps.toLocaleString("en-US")} steps so far` : null,
    weather ? `${weather.condition}, ${weather.temp}°${weather.unit}` : null,
    look ? `Today's look: ${look}` : null,
  ].filter(Boolean);
  if (!parts.length && sleep == null) return null;
  const a = ATMOS.personal;
  return (
    <GlowCard tint="personal" eyebrow="A moment for yourself" style={{ marginTop: S.xxl }}>
      {sleep != null && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: S.lg, marginBottom: 6 }}>
          <HeroNumber value={sleep} unit="hours" label="Sleep last night" size={44} />
          {(body?.week.filter(v => v != null).length ?? 0) >= 3 && (
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 6 }}>
              <SparkArea id="today-sleep" points={body!.week} color={a.chart} guide={7} height={48} />
            </div>
          )}
        </div>
      )}
      {parts.length > 0 && <Detail style={{ fontSize: TYPE.body, color: T.text }}>{parts.join(". ")}.</Detail>}
      <TextButton color={a.ink} onClick={() => setActiveTab(weather || look ? "style" : "me")}>
        {look ? "Wear it or swap it ›" : weather ? "See today's outfit ›" : "Open Me ›"}
      </TextButton>
    </GlowCard>
  );
}

export function TodayScreen() {
  const name = useStore(s => s.profile?.name) || "there";
  const [menuOpen, setMenuOpen] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const tripsOn = useTripsEnabled();
  const { data, failed, reload } = useTodayData(tripsOn);

  useEffect(() => {
    import("../../core/weather").then(m => m.getWeatherByLocation()).then(w => { if (w) setWeather(w); }).catch(() => {});
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const sub = hour < 12 ? "A calm start to the day" : hour < 17 ? "Here's the rest of your day" : "Here's where things stand tonight";
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <PullToRefresh onRefresh={async () => { reload(); await new Promise(r => setTimeout(r, 900)); }} />
      <LargeTitle eyebrow={date} title={`${greeting}, ${name.split(" ")[0]}`} subtitle={sub} compactTitle="Today"
        right={
          <button onClick={() => setMenuOpen(true)} aria-label="Open your menu: profile, family, settings"
            style={{ background: "none", border: "none", padding: 2, cursor: "pointer", borderRadius: "50%", minWidth: 44, minHeight: 44, flexShrink: 0 }}>
            <Avatar size={44} />
          </button>
        } />

      <GetStartedCard />
      <TodayHero data={data} failed={failed} />
      <Briefing weather={weather} />
      <QuickActions />
      <NeedsYou data={data} failed={failed} reload={reload} />
      <MailInboxCard />
      <Handled items={data?.handled ?? []} />
      {/* If loading failed, don't claim the week is empty. */}
      {!failed && <ThisWeek data={data} />}
      {data ? <MomentForYou weather={weather} /> : <Skeleton height={120} radius={24} style={{ marginTop: S.xxl }} />}

      {menuOpen && <YouMenu onClose={() => setMenuOpen(false)} />}
    </div>
  );
}
