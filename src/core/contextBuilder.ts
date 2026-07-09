// ─── HerNest Context Builder ──────────────────────────────────────
// Per blueprint spec: aggregates ALL modules for Morning Briefing
// v2: reads budget_v2, exposes household snapshot for intelligence layer

import { loadData } from "./firebase";
import { buildMemoryContext, loadMemoryFacts } from "./memory";
import { buildMemoryContextV2 } from "./memoryServiceV2";
import { buildHouseholdSnapshot } from "./household/HouseholdIntelligence";
import type { HouseholdSnapshot } from "./store";

// ── Tone Profiles (unchanged) ─────────────────────────────────────
export const TONE_PROFILES = {
  thriving:   { color: "#D4A574", affirmationTheme: "growth",    energyStyle: "ambitious",  label: "Thriving" },
  steady:     { color: "#7B9E6B", affirmationTheme: "presence",  energyStyle: "balanced",   label: "Steady" },
  tired:      { color: "#8B9DC3", affirmationTheme: "gentleness",energyStyle: "protective", label: "Tired" },
  struggling: { color: "#C9A9A6", affirmationTheme: "strength",  energyStyle: "minimal",    label: "Struggling" },
} as const;

export type ToneProfile = keyof typeof TONE_PROFILES;

export const FOCUS_WORD_POOL = {
  strength: ["Rise","Anchor","Steady","Grounded","Resilient","Unshakeable"],
  calm:     ["Breathe","Flow","Ease","Gentle","Soft","Still"],
  growth:   ["Expand","Bloom","Forward","Become","Transform","Evolve"],
  joy:      ["Light","Radiant","Sparkle","Glow","Bright","Warm"],
  balance:  ["Centre","Harmony","Align","Poise","Ground","Restore"],
};

const FOCUS_EMOJIS: Record<string,string> = {
  Rise:"🌅",Anchor:"⚓",Steady:"🌿",Grounded:"🌳",Resilient:"💪",Unshakeable:"🏔",
  Breathe:"🫁",Flow:"🌊",Ease:"🛁",Gentle:"🕊",Soft:"☁️",Still:"🕯",
  Expand:"🌻",Bloom:"🌸",Forward:"→",Become:"🦋",Transform:"🌱",Evolve:"🔄",
  Light:"💡",Radiant:"☀️",Sparkle:"✨",Glow:"🌟",Bright:"🌤",Warm:"🧡",
  Centre:"🎯",Harmony:"🎵",Align:"📐",Poise:"🩰",Ground:"🌾",Restore:"♻️",
};

// ── Budget thresholds (unchanged) ─────────────────────────────────
const BUDGET_STATUS = (pct: number) =>
  pct >= 0.95 ? "critical" : pct >= 0.85 ? "warning" : pct >= 0.70 ? "watch" : "healthy";

// ── AppContext (extended with householdSnapshot) ───────────────────
export interface AppContext {
  // User
  name: string;
  role: string;
  challenge: string;
  energyPattern: string;
  priorities: string[];
  kids: { name: string; birthday?: string }[];

  // Tasks
  tasks: {
    dueToday: { title: string; category: string; priority: string }[];
    overdue:  { title: string; category: string; dueDate?: string }[];
    total: number;
    completionRate: number;
  };

  // Calendar
  calendar: {
    events: { title: string; time?: string; source: string; date: string }[];
    todayEvents: { title: string; time?: string; source: string }[];
    density: "light"|"moderate"|"heavy"|"extreme";
    conflicts: { event1: string; event2: string }[];
  };

  // Budget — reads from budget_v2 first, falls back to budget
  budget: {
    spent: number; limit: number; pct: number; remaining: number;
    status: "healthy"|"watch"|"warning"|"critical";
    topOverspend: string;
    daysUntilReset: number;
    projected: number;
    savingsGoals: { name: string; pct: number }[];
    categoryAlerts: { name: string; pct: number; status: string }[];
    // v2 additions
    monthlyIncome: number;
    totalDebt: number;
    savingsRate: number;
    financialHealthGrade: string;
  };

  // Thrive
  thrive: {
    sleepLast: number;
    sleepTrend: number[];
    water: number;
    habitsToday: number;
    totalHabits: number;
    mood: number | null;
    moodTrend: number[];
    weeklyScore?: number;
  };

  // Trips
  trips: {
    next: { dest: string; daysUntil: number; nights: number; budget: number; urgentActions: string[]; packingPct: number } | null;
    isClose: boolean;
  };

  // School
  school: {
    urgentToday: { title: string; child?: string; actionType?: string }[];
    thisWeek: { title: string; date: string; child?: string }[];
  };

  // Circle
  circle: {
    overdueCheckins: { name: string; days: number; relationship: string }[];
    birthdaysSoon: { name: string; daysUntil: number }[];
  };

  // Memory
  memory: string;
  memoryFacts: { statement: string; type: string }[];

  // Meta
  tone: ToneProfile;
  toneConfig: typeof TONE_PROFILES[ToneProfile];
  dayOfWeek: string;
  isWeekend: boolean;
  isSunday: boolean;
  daysUntilMonthEnd: number;

  // NEW: Household intelligence snapshot
  // Available to Home screen, Cleo, and any module that needs cross-module context
  householdSnapshot: HouseholdSnapshot | null;
}

// ── Select tone (unchanged) ───────────────────────────────────────
export function selectToneProfile(sleepTrend: number[], moodTrend: number[]): ToneProfile {
  const avgSleep = sleepTrend.length ? sleepTrend.reduce((a,b)=>a+b,0)/sleepTrend.length : 0;
  const avgMood  = moodTrend.length  ? moodTrend.reduce((a,b)=>a+b,0)/moodTrend.length   : 3;
  if (avgSleep >= 7 && avgMood >= 4) return "thriving";
  if (avgSleep < 5  || avgMood < 2) return "struggling";
  if (avgSleep < 6.5 || avgMood < 3) return "tired";
  return "steady";
}

export function selectFocusWord(tone: ToneProfile): { word: string; emoji: string } {
  const pools: Record<ToneProfile, string[]> = {
    thriving:   FOCUS_WORD_POOL.growth,
    steady:     FOCUS_WORD_POOL.balance,
    tired:      FOCUS_WORD_POOL.calm,
    struggling: FOCUS_WORD_POOL.strength,
  };
  const pool = pools[tone];
  const word = pool[Math.floor(Math.random() * pool.length)];
  return { word, emoji: FOCUS_EMOJIS[word] || "✨" };
}

// ── Main context builder ──────────────────────────────────────────
export async function buildAppContext(
  userId: string,
  profile: Record<string, unknown>
): Promise<AppContext> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const daysInMonth = new Date(today.getFullYear(), today.getMonth()+1, 0).getDate();
  const daysUntilReset = daysInMonth - today.getDate();

  console.log("[Context] starting buildAppContext v2 for", userId);

  // Load all modules in parallel — now includes budget_v2
  const [
    tasksData, budgetDataV2, budgetDataV1, thriveData,
    tripsData, schoolData, circleData, calendarData,
    memoryFacts
  ] = await Promise.all([
    loadData(userId, "tasks"),
    loadData(userId, "budget_v2"),   // NEW: try v2 first
    loadData(userId, "budget"),      // fallback to v1
    loadData(userId, "thrive"),
    loadData(userId, "trips"),
    loadData(userId, "school"),
    loadData(userId, "circle"),
    loadData(userId, "calendar"),
    loadMemoryFacts(userId),
  ]);

  // Use v2 if available, otherwise fall back to v1
  const budgetData = budgetDataV2 || budgetDataV1;
  const isV2 = !!budgetDataV2;

  console.log("[Context] data loaded:", {
    budgetV2: !!budgetDataV2, budgetV1: !!budgetDataV1,
    tasks: !!tasksData, thrive: !!thriveData
  });

  const memoryCtx = await buildMemoryContextV2(userId, { maxResults: 10 }).catch(() => buildMemoryContext(userId));

  // ── Tasks ───────────────────────────────────────────────────────
  const allTasks = (tasksData?.tasks as any[]) || [];
  const pendingTasks = allTasks.filter((t:any) => !t.done);
  const dueToday = pendingTasks.filter((t:any) => t.dueDate === todayStr);
  const overdue  = pendingTasks.filter((t:any) => t.dueDate && t.dueDate < todayStr);
  const doneTasks = allTasks.filter((t:any) => t.done);
  const completionRate = allTasks.length ? doneTasks.length / allTasks.length : 0;

  // ── Calendar ────────────────────────────────────────────────────
  const manualEvents = (calendarData?.events as any[]) || [];
  const schoolEvents = (schoolData?.events as any[]) || [];
  const allEvents = [
    ...manualEvents,
    ...schoolEvents.map((e:any) => ({ ...e, source:"school" })),
  ];
  const todayEvents = allEvents.filter((e:any) => e.date === todayStr);
  const density = todayEvents.length >= 7 ? "extreme" : todayEvents.length >= 5 ? "heavy" : todayEvents.length >= 3 ? "moderate" : "light";

  // ── Budget (v2-aware) ────────────────────────────────────────────
  const cats = (budgetData?.categories as any[]) || [];
  const spent = cats.reduce((a:number,c:any)=>a+(c.spent||0),0);
  const limit = cats.reduce((a:number,c:any)=>a+(c.budget||0),0);
  const pct   = limit > 0 ? spent/limit : 0;
  const budgetStatus = BUDGET_STATUS(pct) as any;
  const daysElapsed = today.getDate();
  const projected = daysElapsed > 0 ? (spent/daysElapsed)*daysInMonth : 0;
  const catsSorted = [...cats].sort((a:any,b:any)=>(b.spent/b.budget)-(a.spent/a.budget));
  const topOverspend = catsSorted[0]?.label || "";
  const categoryAlerts = cats
    .filter((c:any)=>c.budget>0 && (c.spent/c.budget)>=0.7)
    .map((c:any)=>({ name:c.label, pct:Math.round(c.spent/c.budget*100), status:BUDGET_STATUS(c.spent/c.budget) }));

  // v2 goals structure
  const rawGoals = (budgetData?.goals as any[]) || [];
  const savingsGoals = rawGoals.map((g:any) => ({
    name: g.name,
    pct: isV2
      ? (g.targetAmount > 0 ? Math.round(g.currentAmount / g.targetAmount * 100) : 0)
      : (g.target > 0 ? Math.round(g.saved / g.target * 100) : 0),
  }));

  // v2 income + debt
  const incomes = (budgetData?.incomes as any[]) || [];
  const monthlyIncome = incomes.reduce((a: number, inc: any) => {
    const m: Record<string, number> = { monthly:1, biweekly:26/12, weekly:52/12, annual:1/12 };
    return a + (inc.amount||0) * (m[inc.frequency]||1);
  }, 0);
  const debts = (budgetData?.debts as any[]) || [];
  const totalDebt = debts.reduce((a:number, d:any) => a + (d.balance||0), 0);
  const savingsRate = monthlyIncome > 0 ? Math.max(0, ((monthlyIncome - spent) / monthlyIncome) * 100) : 0;
  const healthGrade = (budgetData?.healthScore as any)?.grade || "—";

  // ── Thrive ──────────────────────────────────────────────────────
  const sleepLogs  = (thriveData?.sleepLog as any[]) || [];
  const moodLogs   = (thriveData?.moodLog  as any[]) || [];
  const habits     = (thriveData?.habits   as any[]) || [];
  const todaySleep = sleepLogs.find((l:any)=>l.date===todayStr);
  const todayMood  = moodLogs.find((l:any)=>l.date===todayStr);
  const sleepTrend = sleepLogs.slice(-7).map((l:any)=>l.hours);
  const moodTrend  = moodLogs.slice(-7).map((l:any)=>l.value);

  // ── Tone ────────────────────────────────────────────────────────
  const tone = selectToneProfile(sleepTrend, moodTrend);
  const toneConfig = TONE_PROFILES[tone];

  // ── Trips ───────────────────────────────────────────────────────
  const allTrips = (tripsData?.trips as any[]) || [];
  const futureTrips = allTrips
    .filter((t:any)=>new Date(t.date)>today)
    .sort((a:any,b:any)=>new Date(a.date).getTime()-new Date(b.date).getTime());
  const nextTrip = futureTrips[0];
  const daysUntil = nextTrip
    ? Math.ceil((new Date(nextTrip.date).getTime()-today.getTime())/(1000*60*60*24))
    : null;
  const packingList = nextTrip?.packingList || [];
  const packingPct = packingList.length
    ? Math.round(packingList.filter((i:any)=>i.done).length/packingList.length*100)
    : 0;

  // ── School ──────────────────────────────────────────────────────
  const allSchool = (schoolData?.events as any[]) || [];
  const urgentToday = allSchool.filter((e:any)=>e.date===todayStr&&e.requiresAction);
  const thisWeek = allSchool.filter((e:any)=>{
    const diff=(new Date(e.date).getTime()-today.getTime())/(1000*60*60*24);
    return diff>=0&&diff<=7;
  });

  // ── Circle ──────────────────────────────────────────────────────
  const contacts = (circleData?.contacts as any[]) || [];
  const yr = today.getFullYear();
  const birthdaysSoon = [
    ...contacts,
    ...((profile.kids as any[])||[]),
    ...((profile.parents as any[])||[]),
  ].filter((p:any)=>{
    if (!p.birthday) return false;
    const [m,d] = p.birthday.split("-").map(Number);
    const next = new Date(yr,m-1,d);
    if (next<today) next.setFullYear(yr+1);
    return Math.ceil((next.getTime()-today.getTime())/(1000*60*60*24))<=14;
  }).map((p:any)=>{
    const [m,d] = p.birthday.split("-").map(Number);
    const next = new Date(yr,m-1,d);
    if (next<today) next.setFullYear(yr+1);
    return { name:p.name, daysUntil:Math.ceil((next.getTime()-today.getTime())/(1000*60*60*24)) };
  });

  const overdueCheckins = contacts.filter((c:any)=>{
    if (!c.lastContact) return true;
    return Math.floor((today.getTime()-new Date(c.lastContact).getTime())/(1000*60*60*24))>14;
  }).map((c:any)=>({
    name:c.name,
    days:c.lastContact?Math.floor((today.getTime()-new Date(c.lastContact).getTime())/(1000*60*60*24)):999,
    relationship:c.relationship||"Friend",
  })).slice(0,3);

  // ── NEW: Household snapshot (non-blocking) ────────────────────
  // Build async but don't block the context builder
  // Returns null if it fails — modules degrade gracefully
  let householdSnapshot: HouseholdSnapshot | null = null;
  try {
    householdSnapshot = await buildHouseholdSnapshot(userId);
  } catch (e) {
    console.warn("[Context] householdSnapshot build failed (non-fatal):", e);
  }

  return {
    // User
    name: (profile.name as string) || "lovely",
    role: (profile.role as string) || "",
    challenge: (profile.challenge as string) || "",
    energyPattern: (profile.energyPattern as string) || "morning",
    priorities: (profile.priorities as string[]) || [],
    kids: (profile.kids as any[]) || [],

    // Tasks
    tasks: { dueToday, overdue, total:pendingTasks.length, completionRate },

    // Calendar
    calendar: { events: allEvents, todayEvents, density: density as any, conflicts: [] },

    // Budget (v2-aware)
    budget: {
      spent, limit, pct, remaining: limit-spent,
      status: budgetStatus, topOverspend, daysUntilReset, projected,
      savingsGoals, categoryAlerts,
      // v2 additions
      monthlyIncome, totalDebt, savingsRate, financialHealthGrade: healthGrade,
    },

    // Thrive
    thrive: {
      sleepLast: todaySleep?.hours || 0,
      sleepTrend,
      water: (thriveData?.water as number) || 0,
      habitsToday: habits.filter((h:any)=>h.done).length,
      totalHabits: habits.length,
      mood: todayMood?.value || null,
      moodTrend,
      weeklyScore: (thriveData?.score as any)?.score,
    },

    // Trips
    trips: {
      next: nextTrip ? {
        dest: nextTrip.dest, daysUntil: daysUntil!, nights: nextTrip.nights||0,
        budget: nextTrip.budget||0,
        urgentActions: nextTrip.plan?.days?.[0]?.activities?.slice(0,2)||[],
        packingPct,
      } : null,
      isClose: daysUntil!==null && daysUntil<=60,
    },

    // School
    school: { urgentToday, thisWeek },

    // Circle
    circle: { overdueCheckins, birthdaysSoon },

    // Memory
    memory: memoryCtx,
    memoryFacts,

    // Meta
    tone, toneConfig,
    dayOfWeek: today.toLocaleDateString("en-US",{weekday:"long"}),
    isWeekend: today.getDay()===0||today.getDay()===6,
    isSunday: today.getDay()===0,
    daysUntilMonthEnd: daysUntilReset,

    // NEW
    householdSnapshot,
  };
}

// ── Briefing prompt builder (extended with v2 data) ───────────────
export function buildBriefingPrompt(ctx: AppContext): string {
  const lines: string[] = [];

  lines.push(`=== USER CONTEXT ===`);
  lines.push(`Name: ${ctx.name}. Role: ${ctx.role||"not specified"}. Challenge: ${ctx.challenge||"managing everything"}.`);
  lines.push(`Energy pattern: ${ctx.energyPattern}. Priorities: ${ctx.priorities.join(", ")||"family, career"}.`);
  lines.push(`Kids: ${ctx.kids.map((k:any)=>k.name).join(", ")||"none"}.`);
  lines.push(`Tone profile: ${ctx.tone} (${ctx.toneConfig.label}). Affirmation theme: ${ctx.toneConfig.affirmationTheme}.`);
  lines.push(``);

  lines.push(`=== TODAY: ${ctx.dayOfWeek.toUpperCase()} ===`);
  lines.push(`Weekend: ${ctx.isWeekend}. Sunday Reset: ${ctx.isSunday}.`);
  lines.push(``);

  lines.push(`=== TASKS ===`);
  if (ctx.tasks.dueToday.length)
    lines.push(`Due today (${ctx.tasks.dueToday.length}): ${ctx.tasks.dueToday.map(t=>`${t.title} [${t.category}/${t.priority}]`).join(", ")}.`);
  if (ctx.tasks.overdue.length)
    lines.push(`OVERDUE (${ctx.tasks.overdue.length}): ${ctx.tasks.overdue.map(t=>t.title).join(", ")}.`);
  lines.push(`Total pending: ${ctx.tasks.total}. Completion rate: ${Math.round(ctx.tasks.completionRate*100)}%.`);
  lines.push(``);

  lines.push(`=== CALENDAR ===`);
  if (ctx.calendar.todayEvents.length)
    lines.push(`Today (${ctx.calendar.todayEvents.length} events, ${ctx.calendar.density}): ${ctx.calendar.todayEvents.map(e=>`${e.title}${e.time?` at ${e.time}`:""}`).join("; ")}.`);
  else
    lines.push(`Calendar: clear today.`);
  lines.push(``);

  lines.push(`=== BUDGET ===`);
  // Include v2 data if available
  if (ctx.budget.monthlyIncome > 0) {
    lines.push(`Monthly income: $${Math.round(ctx.budget.monthlyIncome).toLocaleString()}. Savings rate: ${ctx.budget.savingsRate.toFixed(0)}%. Financial health: ${ctx.budget.financialHealthGrade}.`);
  }
  lines.push(`Status: ${ctx.budget.status}. Spent: $${ctx.budget.spent.toFixed(0)} of $${ctx.budget.limit} (${Math.round(ctx.budget.pct*100)}%). Remaining: $${ctx.budget.remaining.toFixed(0)}.`);
  lines.push(`Projected month end: $${ctx.budget.projected.toFixed(0)}. ${ctx.budget.daysUntilReset} days until reset.`);
  if (ctx.budget.totalDebt > 0)
    lines.push(`Total debt: $${ctx.budget.totalDebt.toLocaleString()}.`);
  if (ctx.budget.categoryAlerts.length)
    lines.push(`BUDGET ALERTS: ${ctx.budget.categoryAlerts.map(c=>`${c.name} at ${c.pct}%`).join(", ")}.`);
  if (ctx.budget.savingsGoals.length)
    lines.push(`Goals: ${ctx.budget.savingsGoals.map(g=>`${g.name} ${g.pct}%`).join(", ")}.`);
  lines.push(``);

  lines.push(`=== THRIVE ===`);
  lines.push(`Sleep last night: ${ctx.thrive.sleepLast||"not logged"}h. 7-day trend: ${ctx.thrive.sleepTrend.join(", ")||"no data"}.`);
  lines.push(`Water: ${ctx.thrive.water}/8. Habits: ${ctx.thrive.habitsToday}/${ctx.thrive.totalHabits} done. Mood: ${ctx.thrive.mood||"not logged"}/5.`);
  if (ctx.thrive.weeklyScore) lines.push(`Weekly wellness score: ${ctx.thrive.weeklyScore}/10.`);
  lines.push(``);

  if (ctx.trips.next) {
    lines.push(`=== TRIP ===`);
    lines.push(`Next: ${ctx.trips.next.dest} in ${ctx.trips.next.daysUntil} days. Budget: $${ctx.trips.next.budget}. Packing: ${ctx.trips.next.packingPct}% done.`);
  }

  if (ctx.school.urgentToday.length || ctx.school.thisWeek.length) {
    lines.push(`=== SCHOOL ===`);
    if (ctx.school.urgentToday.length)
      lines.push(`URGENT TODAY: ${ctx.school.urgentToday.map(e=>`${e.title}${e.child?` (${e.child})`:""}`).join(", ")}.`);
    if (ctx.school.thisWeek.length)
      lines.push(`This week: ${ctx.school.thisWeek.map(e=>e.title).join(", ")}.`);
  }

  if (ctx.circle.birthdaysSoon.length || ctx.circle.overdueCheckins.length) {
    lines.push(`=== CIRCLE ===`);
    if (ctx.circle.birthdaysSoon.length)
      lines.push(`BIRTHDAYS: ${ctx.circle.birthdaysSoon.map(b=>`${b.name} in ${b.daysUntil} days`).join(", ")}.`);
    if (ctx.circle.overdueCheckins.length)
      lines.push(`Overdue check-ins: ${ctx.circle.overdueCheckins.map(c=>`${c.name} (${c.days} days)`).join(", ")}.`);
  }

  if (ctx.memory) {
    lines.push(`=== CLEO'S MEMORY ===`);
    lines.push(ctx.memory);
  }

  // NEW: household snapshot context for briefing AI
  if (ctx.householdSnapshot) {
    const snap = ctx.householdSnapshot;
    lines.push(``);
    lines.push(`=== HOUSEHOLD INTELLIGENCE ===`);
    lines.push(`Calendar load: ${snap.calendarLoad}. Stress level: ${snap.householdStressLevel}.`);
    if (snap.activeGoals.some(g => g.riskStatus !== "on_track")) {
      const atRisk = snap.activeGoals.filter(g => g.riskStatus !== "on_track");
      lines.push(`Goals at risk: ${atRisk.map(g => g.name).join(", ")}.`);
    }
  }

  return lines.join("\n");
}
