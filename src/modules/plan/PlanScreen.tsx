import React, { useState, useEffect, useMemo } from "react";
import { trackEvent } from "../../core/analytics";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, HeroCard, Pill, Button, Input, ProgressBar, AIBadge, EmptyState } from "../../shared/components";
import { todayLocal } from "../../core/dateAwareness";
import { saveData, loadData } from "../../core/firebase";
import { subscribeItems, createItem, updateItem, removeItem } from "../../core/householdItems";
import { ownershipView, awaitsAnswerFrom, type OwnedTask } from "../../core/taskOwnership";
import { otherAdults, currentWho, proposeNewTask, answerTask, setTaskDone, takeBack, askAgainTask } from "../../core/taskActions";
import { normalizeName } from "../../core/familyPeople";
import { formatRemindAt, parseRemindAt, remindAtDate, toRemindAt } from "../../core/taskReminders";
import { ai } from "../../core/ai";
import { s } from "../../core/aiSchema";
import { bus } from "../../core/events";
import { buildMemoryContextV2 } from "../../core/memoryServiceV2";
import toast from "react-hot-toast";
import { onEnterSpace } from "../../shared/utils/a11y";
import { WeekView } from "./WeekView";
import { DAYS_OF_WEEK, PLAN_TAB_KEY, weekDates, choresToTasks, choreIdOf, familyDinnersToPlan, type Chore, type FamilyDinner } from "./planHelpers";
import type { Person } from "../../core/familyPeople";
import { ensurePeopleMerged } from "../../core/familyPeopleSync";
import type { CalEvent } from "./useCalendarEvents";

// ── Types per blueprint ────────────────────────────────────────────
interface Task extends OwnedTask {
  id: string; title: string;
  category: "family"|"work"|"home"|"travel"|"personal"|"School";
  priority: "must"|"nice"|"critical"|"high"|"medium"|"low";
  status: "pending"|"completed";
  source: "manual"|"cleo"|"school"|"trip"|"chore";
  energyRequired: "high"|"medium"|"low";
  userConfirmed: boolean;
  dueDate?: string; estimatedMinutes?: number;
  remindAt?: string;    // local "YYYY-MM-DDTHH:mm": alerts the person the task belongs to
  createdAt: number;
  who?: string;         // chores: who does it
  isChore?: boolean;    // a chore record (users/{owner}/chores), not a task
}

interface SchoolEvent {
  id: string; title: string; date: string; child?: string;
  type: "academic"|"sport"|"social"|"parent-evening"|"trip"|"deadline";
  requiresAction: boolean;
  actionType?: "permission-slip"|"payment"|"rsvp"|"supply-list"|"costume";
  actionDeadline?: string; notes?: string;
}

interface ShoppingItem { item: string; quantity: string; category: "produce"|"protein"|"pantry"|"dairy"|"frozen"|"other"; checked: boolean; }
interface DayMeal { date: string; dayName: string; breakfast?: string; lunch?: string; dinner: string; snack?: string; prepNotes?: string; prepTime?: number; }
interface MealPlan { days: DayMeal[]; shoppingList: ShoppingItem[]; generatedAt: number; fromFamily?: boolean; }

const CATS = ["family","work","home","travel","personal"] as const;
const PRIORITY_COLORS: Record<string,string> = { must:T.esp, nice:T.sage, critical:"#dc2626", high:T.gold, medium:T.esp, low:T.taupe };

// Time stamp for completions (outside the component so it reads as an event-time value).
const stamp = () => Date.now();

// Friendly short date (e.g. "Jul 3") from an ISO yyyy-mm-dd string.
const fmtDate = (d: string) => { try { return new Date(d+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}); } catch { return d; } };

// ── Priority scoring per blueprint ─────────────────────────────────
function scoreTask(t: Task, energyPattern: string): number {
  let score = 0;
  const priorityScore: Record<string,number> = { must:80, nice:30, critical:100, high:75, medium:50, low:25 };
  score += priorityScore[t.priority] || 50;
  if (t.dueDate && t.dueDate < todayLocal()) score += 50; // overdue
  if (t.source === "school") score += 20;
  const h = new Date().getHours();
  const isMorning = h < 12;
  const isHighEnergy = energyPattern === "morning" && isMorning;
  if (t.energyRequired === "high" && isHighEnergy) score += 30;
  if (t.energyRequired === "low" && !isHighEnergy) score += 20;
  return score;
}

const OWNERSHIP_COLORS: Record<string, string> = { ask: T.gold, waiting: T.taupe, warn: T.blush, ok: T.sage, done: T.sage };
const smallBtn = (bg: string, fg: string, border = bg): React.CSSProperties => ({ background: bg, color: fg, border: `1.5px solid ${border}`, borderRadius: 8, padding: "5px 10px", fontFamily: F.sans, fontSize: 11, fontWeight: 700, cursor: "pointer", minHeight: 30, flexShrink: 0 });

export function PlanScreen() {
  const { user, profile } = useStore();
  const householdMembers = useStore(s => s.householdMembers);
  // Other adults with HerNest: giving them a task asks them first.
  const adults = useMemo(() => otherAdults(), [householdMembers, user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState(() => {
    try {
      const t = sessionStorage.getItem(PLAN_TAB_KEY);
      if (t) { sessionStorage.removeItem(PLAN_TAB_KEY); return t; }
    } catch { /* private mode */ }
    return "tasks";
  });

  // Family doc: people (for "who"), chores, and the old Family dinner plan
  const [people, setPeople] = useState<Person[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [familyDinners, setFamilyDinners] = useState<FamilyDinner[]>([]);
  const [who, setWho] = useState("");

  // Tasks
  const [tasks, setTasks]     = useState<Task[]>([]);
  const [nowMs, setNowMs]     = useState(stamp); // clock for "Not accepted yet", re-read on each update
  const [input, setInput]     = useState("");
  const [cat, setCat]         = useState<Task["category"]>("family");
  const [priority, setPriority] = useState<Task["priority"]>("must");
  const [energy]             = useState<Task["energyRequired"]>("medium");
  const [dueDate, setDueDate] = useState("");
  const [remindAt, setRemindAt] = useState("");     // "" = no reminder
  const [remindEdit, setRemindEdit] = useState<{ id: string; value: string } | null>(null);
  const [filter, setFilter]   = useState("all");

  // School
  const [schoolEvents, setSchoolEvents] = useState<SchoolEvent[]>([]);
  const [newsletterText, setNewsletterText] = useState("");
  const [extracting, setExtracting] = useState(false);

  // Meals
  const [mealPlan, setMealPlan] = useState<MealPlan|null>(null);
  const [generatingMeals, setGeneratingMeals] = useState(false);
  const [showShopping, setShowShopping] = useState(false);

  const today = todayLocal();
  // Chores show alongside tasks, with who does them.
  const allTasks = useMemo(() => [...tasks, ...(choresToTasks(chores) as Task[])], [tasks, chores]);
  const done = allTasks.filter(t=>t.status==="completed").length;
  const total = allTasks.length;
  const pending = allTasks.filter(t=>t.status==="pending");
  // Who can do it: me, other adults with HerNest (asked first), everyone, then
  // family people (kids etc.) who aren't one of those adults.
  const whoOptions = useMemo(() => {
    const adultNames = new Set(adults.map(a => normalizeName(a.name)));
    return [
      { value: "", label: "Me" },
      ...adults.map(a => ({ value: `uid:${a.uid}`, label: a.name })),
      ...(people.length ? [{ value: "Everyone", label: "Everyone" }] : []),
      ...people.filter(m => !adultNames.has(normalizeName(m.name)) && !adultNames.has(normalizeName(m.name.split(" ")[0])))
        .map(m => ({ value: m.name, label: m.name })),
    ];
  }, [adults, people]);
  const energyPattern = (profile as any)?.energyPattern || "morning";

  // Tasks and chores are live: an add, tick or delete on either phone shows on both.
  useEffect(() => {
    if (!user?.uid) return;
    const offTasks = subscribeItems<Task>(user.uid, "tasks", items => {
      setTasks([...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
      setNowMs(stamp());
    });
    const offChores = subscribeItems<Chore>(user.uid, "chores", items => setChores(items));
    return () => { offTasks(); offChores(); };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "school").then(d => { if(d?.events) setSchoolEvents(d.events as any); });
    loadData(user.uid, "meals").then(d => { if(d?.mealPlan) setMealPlan(d.mealPlan as any); });
    ensurePeopleMerged(user.uid).then(() => loadData(user.uid, "family")).then(d => {
      setPeople((d?.members as Person[]) || []);
      setFamilyDinners((d?.meals as FamilyDinner[]) || []);
    });
  }, [user?.uid]);

  // Each write touches one record only, so two people editing at once both keep their change.
  const uid = user?.uid;
  const saveFailed = (e: unknown) => { console.error("[Plan] save failed:", e); toast.error("Couldn't save. Try again."); };

  // ── Reminders ──────────────────────────────────────────────────────
  // A sensible first pick: the due date at 9:00 AM, or an hour from now.
  const defaultRemindAt = () => {
    const due = dueDate && dueDate >= today ? new Date(`${dueDate}T09:00`) : null;
    if (due && due.getTime() > Date.now()) return toRemindAt(due);
    const d = new Date(Date.now() + 3600000);
    d.setMinutes(0, 0, 0);
    return toRemindAt(d);
  };
  // null = fine; otherwise why the time can't be used.
  const remindProblem = (v: string) => {
    const d = remindAtDate(v);
    if (!d) return "Pick a date and time for the reminder.";
    if (d.getTime() <= Date.now()) return "Pick a time later than now.";
    return null;
  };
  // Notification permission is asked here, the first time she sets one.
  const afterReminderSet = async (v: string) => {
    toast.success(`Reminder set for ${formatRemindAt(v)}`);
    if (!uid) return;
    const { ensureReminderPermission } = await import("../../core/localNotifications");
    if (await ensureReminderPermission(uid) === false) {
      toast("Notifications are off, so this reminder can't alert you. You can turn them on in Settings.", { duration: 6000 });
    }
  };
  const saveReminder = async (t: Task, value: string) => {
    if (!uid) return;
    const v = value ? parseRemindAt(value) : null;
    if (value) {
      const problem = remindProblem(value);
      if (problem || !v) { toast.error(problem || "Pick a date and time for the reminder."); return; }
    }
    setRemindEdit(null);
    await updateItem(uid, "tasks", t.id, { remindAt: v || undefined }).catch(saveFailed);
    if (v) await afterReminderSet(v);
    else toast.success("Reminder removed");
  };

  // ── Add task with energy level per blueprint ───────────────────────
  const addTask = async () => {
    if (!input.trim()) return;
    const reminder = remindAt ? parseRemindAt(remindAt) : null;
    if (remindAt) {
      const problem = remindProblem(remindAt);
      if (problem || !reminder) { toast.error(problem || "Pick a date and time for the reminder."); return; }
    }
    const adult = who.startsWith("uid:") ? adults.find(a => `uid:${a.uid}` === who) : undefined;
    if (who && !adult) {
      const chore: Chore = { id: crypto.randomUUID(), title: input.trim(), assignedTo: who, done: false, ...(dueDate ? { dueDate } : {}), ...(uid ? { createdBy: uid } : {}) };
      setInput(""); setDueDate(""); setWho(""); setRemindAt("");
      if (uid) await createItem(uid, "chores", chore).catch(saveFailed);
      return;
    }
    const task: Task = {
      id: crypto.randomUUID(), title: input.trim(), category: cat,
      priority, status: "pending", source: "manual",
      energyRequired: energy, userConfirmed: true,
      ...(dueDate ? { dueDate } : {}),
      ...(reminder ? { remindAt: reminder } : {}),
      createdAt: Date.now(),
      ...(uid ? { createdBy: uid, createdByName: currentWho()?.name } : {}),
    };
    setInput(""); setDueDate(""); setWho(""); setRemindAt("");
    if (!uid) return;
    if (adult) {
      // Asked, not assigned: it counts as handled only once they say yes.
      // The reminder goes to their phone once they accept.
      const ok = await proposeNewTask(task, adult).catch(saveFailed);
      if (ok) toast.success(`Asked ${adult.name}. We'll show when they answer.`);
      return;
    }
    await createItem(uid, "tasks", task).catch(saveFailed);
    await bus.publish("plan.task.created", task, { userId: user!.uid, source: "plan" });
    if (reminder) await afterReminderSet(reminder);
  };

  // ── Confirm AI-extracted task per blueprint ────────────────────────
  const confirmTask = async (id: string) => {
    if (!uid) return;
    await updateItem(uid, "tasks", id, { userConfirmed: true }).catch(saveFailed);
    trackEvent("task_confirmed");
    toast.success("Task confirmed ✓");
  };

  const toggleTask = async (id: string) => {
    if (!uid) return;
    const choreId = choreIdOf(id);
    if (choreId) {
      const c = chores.find(c => c.id===choreId);
      if (!c) return;
      await updateItem(uid, "chores", choreId, { done: !c.done }).catch(saveFailed);
      if (!c.done) toast.success("Chore done ✓");
      return;
    }
    const t = tasks.find(t => t.id===id);
    if (!t) return;
    const completing = t.status !== "completed";
    const r = await setTaskDone(t, completing).catch(saveFailed);
    if (r && completing) toast.success("Task complete ✓");
  };

  // ── Task ownership: answer, or follow up on an unanswered ask ──────
  const answer = async (t: Task, yes: boolean) => {
    const r = await answerTask(t, yes).catch(saveFailed);
    if (r) toast.success(yes ? "Accepted. It's yours now." : `Declined. ${t.createdByName || "They"} will see it's back with them.`);
  };
  const doItMyself = async (t: Task) => { if (await takeBack(t).catch(saveFailed)) toast.success("It's on your list now"); };
  const askAgain = async (t: Task) => { if (await askAgainTask(t).catch(saveFailed)) toast.success(`Asked ${t.assigneeName || "them"} again`); };

  const deleteTask = async (id: string) => {
    if (!uid) return;
    const choreId = choreIdOf(id);
    if (choreId) { await removeItem(uid, "chores", choreId).catch(saveFailed); return; }
    await removeItem(uid, "tasks", id).catch(saveFailed);
  };

  // ── School newsletter extraction per blueprint ──────────────────────
  const extractFromNewsletter = async () => {
    if (!newsletterText.trim() || !user?.uid) return;
    setExtracting(true);

    try {
      const { extractSchoolEvents } = await import("../../core/schoolNewsletterService");
      const { events, allEvents, error } = await extractSchoolEvents(user.uid, newsletterText);
      // crisis_detected: the crisis sheet is already showing, no error toast.
      if (error) { if (error !== "crisis_detected") toast.error("Couldn't extract events"); setExtracting(false); return; }
      setSchoolEvents(allEvents as any);
      setNewsletterText("");

      // Auto-create tasks for action items per blueprint
      const actionTasks: Task[] = events.filter(e=>e.requiresAction).map(e => ({
        id: crypto.randomUUID(),
        title: `${e.actionType==="permission-slip"?"Sign permission slip":e.actionType||"Action needed"}: ${e.title}`,
        category: "family" as const,
        status: "pending" as const,
        priority: "high" as const,
        source: "school" as const,
        energyRequired: "medium" as const,
        userConfirmed: false, // needs confirmation per blueprint
        dueDate: e.actionDeadline || e.date,
        createdAt: Date.now(),
      }));

      if (actionTasks.length) await Promise.all(actionTasks.map(t => createItem(user.uid, "tasks", t)));

      toast.success(`Found ${events.length} events · ${events.filter(e=>e.requiresAction).length} need action`);
    } catch(e) { console.error('[Plan] newsletter parse:', e); toast.error("Couldn't read newsletter — try pasting plain text only"); }
    setExtracting(false);
  };

  // ── Meal plan per blueprint with structured format ─────────────────
  const generateMeals = async () => {
    setGeneratingMeals(true);
    const p = profile as any;
    const diet = p?.diet || "no restrictions";
    const kidList = people.filter(m => m.role === "child");
    const kids = kidList.length
      ? kidList.map(k => k.name + (k.notes ? ` (${k.notes})` : "")).join(", ")
      : String(p?.kids?.length || 0);
    const energy = p?.energyPattern || "morning";
    const memCtx = user?.uid ? await buildMemoryContextV2(user.uid, { maxResults: 10 }).catch(() => "") : "";

    const sys = `You are Cleo, a meal planner.
7 days Mon-Sun. Keep meal names under 6 words. prepTime is minutes. Shopping list max 25 items, categorized, all unchecked.
Consider: easier meals on busy weekdays, more elaborate on weekends.`;
    const schema = s.object({
      days: s.array(s.object({
        dayName: s.enum(DAYS_OF_WEEK),
        breakfast: s.string(), lunch: s.string(), dinner: s.string(), snack: s.string(),
        prepNotes: s.string(), prepTime: s.integer("minutes"),
      })),
      shoppingList: s.array(s.object({
        item: s.string(), quantity: s.string(),
        category: s.enum(["produce","protein","pantry","dairy","frozen","other"]),
        checked: s.boolean(),
      })),
    });

    const prompt = `Diet: ${diet}. Kids: ${kids}. Energy: ${energy} person. Budget-conscious. ${memCtx?"Context: "+memCtx:""}`;
    const result = await ai(sys, prompt, "meal_plan", [], { schema });

    if (!result.error) {
      try {
        const raw = JSON.parse(result.text);
        // Dates for this week, Monday to Sunday, in local time. (This used to
        // jump to next week when generated on a Sunday, and use UTC dates.)
        const week = weekDates();
        const days: DayMeal[] = (raw.days||[]).slice(0, 7).map((d:any, i:number) => ({ ...d, date: week[i], dayName: DAYS_OF_WEEK[i] }));

        const plan: MealPlan = { days, shoppingList: raw.shoppingList||[], generatedAt:Date.now() };
        setMealPlan(plan);
        if (user?.uid) {
          await saveData(user.uid, "meals", { mealPlan:plan });
          await bus.publish("plan.meal.generated", { days:7 }, { userId:user.uid, source:"plan" });
        }
        toast.success("Meal plan ready ✦");
      } catch(e) { console.error('[Plan] meal plan parse:', e); toast.error("Meal plan failed — tap try again"); }
    }
    setGeneratingMeals(false);
  };

  const toggleShoppingItem = async (index: number) => {
    if (!mealPlan) return;
    const updated = { ...mealPlan, shoppingList: mealPlan.shoppingList.map((item,i) => i===index?{...item,checked:!item.checked}:item) };
    setMealPlan(updated);
    if (user?.uid) await saveData(user.uid, "meals", { mealPlan:updated });
  };

  // Sort pending tasks by priority score per blueprint
  // Tasks someone asked you to take come first, then by priority score.
  const asksMe = (t: Task) => (uid && awaitsAnswerFrom(t, uid) ? 1 : 0);
  const sortedPending = [...pending].sort((a,b) => asksMe(b) - asksMe(a) || scoreTask(b,energyPattern) - scoreTask(a,energyPattern));

  const filteredTasks = filter==="all" ? sortedPending
    : filter==="done" ? allTasks.filter(t=>t.status==="completed")
    : filter==="unconfirmed" ? allTasks.filter(t=>!t.userConfirmed&&t.status==="pending")
    : sortedPending.filter(t=>t.category===filter);

  const unconfirmedCount = allTasks.filter(t=>!t.userConfirmed&&t.status==="pending").length;
  // Meals: the saved plan, or Family's old dinner plan until a new one is made.
  const shownMealPlan: MealPlan | null = mealPlan || (familyDinnersToPlan(familyDinners) as MealPlan | null);
  const urgentSchool = schoolEvents.filter(e=>e.requiresAction).length;

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow={new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}).toUpperCase()} title="Plan"/>

      <HeroCard
        eyebrow="TODAY'S PROGRESS"
        title={total?`${done} of ${total} done`:"Nothing planned yet"}
        subtitle={total?`${Math.round(done/total*100)}% complete · ${pending.length} remaining`:"Add your first task below"}
        color={T.esp}
      >
        {total>0 && <div style={{ marginTop:12 }}><ProgressBar value={done} max={total} color={T.gold}/></div>}
      </HeroCard>

      {/* Unconfirmed tasks alert per blueprint */}
      {unconfirmedCount > 0 && (
        <div style={{ background:`${T.gold}15`, border:`1px solid ${T.gold}30`, borderRadius:14, padding:"10px 14px", marginBottom:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.gold, margin:0 }}>{unconfirmedCount} task{unconfirmedCount>1?"s":""} from Cleo need your confirmation</p>
          <button onClick={()=>setFilter("unconfirmed")} style={{ background:T.gold, color:"#fff", border:"none", borderRadius:8, padding:"4px 10px", fontFamily:F.sans, fontSize:11, cursor:"pointer", minHeight:28 }}>Review</button>
        </div>
      )}

      {/* School alert */}
      {urgentSchool > 0 && (
        <div style={{ background:`${T.blush}10`, border:`1px solid ${T.blush}30`, borderRadius:14, padding:"10px 14px", marginBottom:12 }}>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.blush, margin:0 }}>🏫 {urgentSchool} school action{urgentSchool>1?"s":""} need attention</p>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", justifyContent:"center" }}>
        {[
          { id:"tasks",    label:"✓ Tasks" },
          { id:"week",     label:"📅 Week" },
          { id:"school",   label:`🏫 School${urgentSchool>0?` (${urgentSchool})`:""}` },
          { id:"meals",    label:"🍽 Meals" },
        ].map(t=><Pill key={t.id} label={t.label} active={tab===t.id} onClick={()=>setTab(t.id)}/>)}
      </div>

      {/* ── TASKS TAB ──────────────────────────────────────────────── */}
      {tab==="tasks" && <>
        {/* Filters */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12, justifyContent:"center" }}>
          {[
            { id:"all", label:"All" },
            ...(unconfirmedCount>0?[{ id:"unconfirmed", label:`Unconfirmed (${unconfirmedCount})` }]:[]),
            ...CATS.map(c=>({ id:c, label:c.charAt(0).toUpperCase()+c.slice(1) })),
            { id:"done", label:"Done" },
          ].map(f=><Pill key={f.id} label={f.label} active={filter===f.id} onClick={()=>setFilter(f.id)}/>)}
        </div>

        {/* Add task */}
        <Card>
          <div style={{ display:"flex", gap:8, marginBottom:12 }}>
            <Input value={input} onChange={setInput} placeholder="Add a task..." style={{ flex:1 }}/>
            <button onClick={addTask} disabled={!input.trim()} style={{ width:44, height:44, borderRadius:12, background:input.trim()?T.esp:T.linen, border:"none", color:"#fff", fontSize:22, cursor:input.trim()?"pointer":"not-allowed", flexShrink:0 }}>+</button>
          </div>
          {/* Priority — 2 levels */}
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            {([{ id:"must", label:"✦ Must do", color:T.esp }, { id:"nice", label:"◦ Nice to do", color:T.sage }] as const).map(p=>(
              <button key={p.id} onClick={()=>setPriority(p.id as any)} style={{ flex:1, padding:"10px", borderRadius:12, border:`1.5px solid ${priority===p.id?p.color:T.linen}`, background:priority===p.id?`${p.color}15`:"#fff", color:priority===p.id?p.color:T.bark, fontFamily:F.sans, fontSize:12, fontWeight:priority===p.id?700:400, cursor:"pointer", touchAction:"manipulation" }}>
                {p.label}
              </button>
            ))}
          </div>
          {/* Category + date row */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            {CATS.map(c=>(
              <button key={c} onClick={()=>setCat(c)} style={{ padding:"6px 12px", borderRadius:20, border:`1.5px solid ${cat===c?T.gold:T.linen}`, background:cat===c?T.goldP:"#fff", color:cat===c?T.gold:T.bark, fontFamily:F.sans, fontSize:11, fontWeight:cat===c?700:400, cursor:"pointer" }}>
                {c}
              </button>
            ))}
            <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} style={{ padding:"6px 12px", borderRadius:20, border:`1.5px solid ${T.linen}`, background:T.sand, fontFamily:F.sans, fontSize:16, color:T.bark, outline:"none" }}/>
          </div>
          {/* Reminder: an alert on her phone at this time (tasks only, not family chores) */}
          {(!who || who.startsWith("uid:")) && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:10 }}>
              {remindAt ? <>
                <span style={{ fontFamily:F.sans, fontSize:11, color:T.taupe }}>Remind me:</span>
                <input type="datetime-local" aria-label="Reminder date and time" value={remindAt} onChange={e=>setRemindAt(e.target.value)} style={{ padding:"6px 12px", borderRadius:20, border:`1.5px solid ${T.linen}`, background:T.sand, fontFamily:F.sans, fontSize:16, color:T.bark, outline:"none" }}/>
                <button onClick={()=>setRemindAt("")} style={{ padding:"5px 12px", borderRadius:20, border:`1.5px solid ${T.linen}`, background:"#fff", color:T.bark, fontFamily:F.sans, fontSize:11, cursor:"pointer" }}>No reminder</button>
              </> : (
                <button onClick={()=>setRemindAt(defaultRemindAt())} style={{ padding:"5px 12px", borderRadius:20, border:`1.5px solid ${T.linen}`, background:"#fff", color:T.bark, fontFamily:F.sans, fontSize:11, cursor:"pointer" }}>🔔 Remind me</button>
              )}
            </div>
          )}
          {/* Who does it: another adult is asked first; kids and "Everyone" make a family chore */}
          {who.startsWith("uid:") && (
            <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"8px 0 0" }}>They'll be asked to accept or decline. It shows as waiting until they say yes.</p>
          )}
          {whoOptions.length > 1 && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:10 }}>
              <span style={{ fontFamily:F.sans, fontSize:11, color:T.taupe }}>Who:</span>
              {whoOptions.map(o=>(
                <button key={o.value||"me"} onClick={()=>setWho(o.value)} style={{ padding:"5px 12px", borderRadius:20, border:`1.5px solid ${who===o.value?T.sky:T.linen}`, background:who===o.value?`${T.sky}15`:"#fff", color:who===o.value?T.sky:T.bark, fontFamily:F.sans, fontSize:11, cursor:"pointer" }}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Task list sorted by priority score per blueprint */}
        {filteredTasks.length===0 ? (
          <EmptyState
            icon={filter==="done" ? "✓" : "◈"}
            title={filter==="done" ? "Nothing completed yet" : "Your list is clear"}
            body={filter==="done" ? "Tasks you complete will show up here." : "Add a task below or ask Cleo to pull tasks from a message — I'll keep them in order for you ✦"}
          />
        ) : filteredTasks.map(t=>{
          const own = uid && !t.isChore ? ownershipView(t, uid, nowMs) : null;
          return (
          <div key={t.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", background:t.status==="completed"?"#fff":t.priority==="must"?`${T.esp}06`:`${T.sage}06`, borderRadius:16, border:`1.5px solid ${t.status==="completed"?T.linen:t.priority==="must"?`${T.esp}20`:`${T.sage}20`}`, marginBottom:8 }}>
            <button onClick={()=>toggleTask(t.id)} style={{ width:24, height:24, borderRadius:7, border:`2px solid ${t.status==="completed"?T.sage:PRIORITY_COLORS[t.priority]||T.linen}`, background:t.status==="completed"?T.sage:"transparent", flexShrink:0, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:13, minHeight:24, touchAction:"manipulation" }}>
              {t.status==="completed"?"✓":""}
            </button>
            <div style={{ flex:1 }}>
              <p style={{ fontFamily:F.sans, fontSize:13, color:t.status==="completed"?T.taupe:T.esp, margin:0, textDecoration:t.status==="completed"?"line-through":"none" }}>{t.title}</p>
              <div style={{ display:"flex", gap:6, marginTop:4, flexWrap:"wrap", alignItems:"center" }}>
                <span style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, color:t.priority==="must"?T.esp:T.sage, padding:"2px 8px", borderRadius:10, background:t.priority==="must"?`${T.esp}10`:`${T.sage}10` }}>{t.priority==="must"?"✦ must":t.priority==="nice"?"◦ nice":t.priority}</span>
                {t.who || (t.assigneeUid && t.assigneeUid !== uid) ? <span style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, color:T.sky }}>→ {t.who || t.assigneeName}</span> : <span style={{ fontFamily:F.sans, fontSize:10, color:T.taupe }}>{t.category}</span>}
                {own && <span style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, color:OWNERSHIP_COLORS[own.tone], padding:"2px 8px", borderRadius:10, background:`${OWNERSHIP_COLORS[own.tone]}15` }}>{own.label}</span>}
                {t.dueDate && <span style={{ fontFamily:F.sans, fontSize:10, color:t.dueDate<today?T.taupe:T.taupe, fontWeight:t.dueDate<today?700:400 }}>{t.dueDate<today?`was due ${fmtDate(t.dueDate)}`:`due ${fmtDate(t.dueDate)}`}</span>}
                {t.source!=="manual" && t.source!=="chore" && <span style={{ fontFamily:F.sans, fontSize:10, color:T.gold }}>✦ {t.source}</span>}
                {!t.isChore && t.status!=="completed" && (
                  <button onClick={()=>setRemindEdit(remindEdit?.id===t.id ? null : { id:t.id, value:t.remindAt || defaultRemindAt() })} aria-label={t.remindAt ? "Change reminder" : "Add a reminder"}
                    style={{ fontFamily:F.sans, fontSize:10, color:t.remindAt?T.sky:T.taupe, fontWeight:t.remindAt?700:400, background:"none", border:"none", padding:"2px 0", cursor:"pointer" }}>
                    {t.remindAt ? `🔔 ${formatRemindAt(t.remindAt)}` : "🔔 Remind"}
                  </button>
                )}
              </div>
              {remindEdit?.id===t.id && (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:8 }}>
                  <input type="datetime-local" aria-label="Reminder date and time" value={remindEdit.value} onChange={e=>setRemindEdit({ id:t.id, value:e.target.value })} style={{ padding:"5px 10px", borderRadius:20, border:`1.5px solid ${T.linen}`, background:T.sand, fontFamily:F.sans, fontSize:16, color:T.bark, outline:"none" }}/>
                  <button onClick={()=>saveReminder(t, remindEdit.value)} style={smallBtn(T.esp, "#fff")}>Save</button>
                  {t.remindAt && <button onClick={()=>saveReminder(t, "")} style={smallBtn("#fff", T.bark, T.linen)}>Remove</button>}
                  <button onClick={()=>setRemindEdit(null)} style={smallBtn("#fff", T.bark, T.linen)}>Cancel</button>
                </div>
              )}
            </div>
            {/* Confirm button for unconfirmed tasks per blueprint */}
            {!t.userConfirmed && (
              <button onClick={()=>confirmTask(t.id)} style={{ background:T.gold, color:"#fff", border:"none", borderRadius:8, padding:"5px 10px", fontFamily:F.sans, fontSize:11, cursor:"pointer", flexShrink:0, minHeight:30 }}>Confirm</button>
            )}
            {own?.needsMyAnswer && (
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                <button onClick={()=>answer(t, true)} style={smallBtn(T.esp, "#fff")}>Accept</button>
                <button onClick={()=>answer(t, false)} style={smallBtn("#fff", T.bark, T.linen)}>Decline</button>
              </div>
            )}
            {own?.canFollowUp && (
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                <button onClick={()=>doItMyself(t)} style={smallBtn(T.esp, "#fff")}>I'll do it</button>
                <button onClick={()=>askAgain(t)} style={smallBtn("#fff", T.bark, T.linen)}>Ask again</button>
              </div>
            )}
            <button onClick={()=>deleteTask(t.id)} style={{ background:"none", border:"none", color:T.taupe, cursor:"pointer", fontSize:18, padding:4, minHeight:36 }}>×</button>
          </div>
          );
        })}
      </>}

      {/* ── WEEK TAB: calendar + school + chores, one list ─────────── */}
      {tab==="week" && (
        <WeekView
          people={people}
          chores={chores}
          schoolEvents={schoolEvents as unknown as CalEvent[]}
          tasks={tasks}
        />
      )}

      {/* ── SCHOOL TAB ─────────────────────────────────────────────── */}
      {tab==="school" && <>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 10px" }}>PASTE NEWSLETTER TEXT</p>
          <textarea value={newsletterText} onChange={e=>setNewsletterText(e.target.value)} placeholder="Paste your school newsletter here — Cleo will extract all events, deadlines, permission slips, payments, and action items automatically..." style={{ width:"100%", minHeight:120, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"12px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", resize:"vertical", boxSizing:"border-box", marginBottom:12 }}/>
          <Button onClick={extractFromNewsletter} disabled={!newsletterText.trim()||extracting} variant="gold">
            {extracting?"✦ Cleo is reading...":"✦ Extract Events & Actions"}
          </Button>
        </Card>

        {schoolEvents.length>0 && (
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>SCHOOL EVENTS ({schoolEvents.length})</p>
              <AIBadge label="Extracted by Cleo"/>
            </div>
            {schoolEvents.map(e=>{
              const typeColors: Record<string,string> = { "parent-evening":T.blush, trip:T.gold, deadline:"#dc2626", sport:T.sage };
              return (
                <div key={e.id} style={{ padding:"12px 0", borderBottom:`1px solid ${T.linen}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                    <div style={{ flex:1 }}>
                      <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>{e.title}</p>
                      <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"2px 0 0" }}>
                        {new Date((e.date||"").includes("T")?e.date:(e.date||"")+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}
                        {e.child?` · ${e.child}`:""}
                        {e.type && <span style={{ color:typeColors[e.type]||T.taupe }}> · {e.type}</span>}
                      </p>
                      {e.actionDeadline && e.actionDeadline!==e.date && (
                        <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"2px 0 0" }}>Needs action by {fmtDate(e.actionDeadline)}</p>
                      )}
                    </div>
                    {e.requiresAction && (
                      <span style={{ background:`${T.blush}20`, color:T.blush, fontFamily:F.sans, fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:10, textTransform:"uppercase", letterSpacing:"0.08em", flexShrink:0 }}>
                        {e.actionType||"action"}
                      </span>
                    )}
                  </div>
                  {e.notes && <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"4px 0 0" }}>{e.notes}</p>}
                </div>
              );
            })}
          </Card>
        )}
      </>}

      {/* ── MEALS TAB per blueprint structured format ─────────────── */}
      {tab==="meals" && <>
        <Button onClick={generateMeals} disabled={generatingMeals} variant="gold" style={{ marginBottom:16 }}>
          {generatingMeals?"✦ Planning your week...":"✦ Plan This Week's Meals"}
        </Button>

        {shownMealPlan && <>
          {shownMealPlan.fromFamily && (
            <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 10px", lineHeight:1.5 }}>Your dinner plan from Family. Plan this week's meals to get a fresh plan with a shopping list.</p>
          )}
          {/* Day cards */}
          {shownMealPlan.days.map((day,i)=>{
            const isToday = day.date===today;
            return (
              <Card key={i}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <p style={{ fontFamily:F.sans, fontSize:12, fontWeight:700, color:isToday?T.gold:T.taupe, margin:0, textTransform:"uppercase", letterSpacing:"0.08em" }}>{day.dayName}{isToday?" · TODAY":""}</p>
                  {day.prepTime && <span style={{ fontFamily:F.sans, fontSize:10, color:T.taupe }}>⏱ {day.prepTime}min</span>}
                </div>
                {[
                  { label:"B", meal:day.breakfast, color:T.gold },
                  { label:"L", meal:day.lunch,     color:T.sage },
                  { label:"D", meal:day.dinner,    color:T.esp },
                  { label:"S", meal:day.snack,     color:T.taupe },
                ].filter(m=>m.meal).map(m=>(
                  <div key={m.label} style={{ display:"flex", gap:10, padding:"4px 0" }}>
                    <span style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, color:m.color, width:14, flexShrink:0 }}>{m.label}</span>
                    <span style={{ fontFamily:F.sans, fontSize:13, color:T.esp }}>{m.meal}</span>
                  </div>
                ))}
                {day.prepNotes && <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"8px 0 0", fontStyle:"italic" }}>💡 {day.prepNotes}</p>}
              </Card>
            );
          })}

          {/* Shopping list per blueprint with categories */}
          {mealPlan && mealPlan.shoppingList.length > 0 && <button onClick={()=>setShowShopping(!showShopping)} style={{ width:"100%", padding:"12px", background:T.esp, color:"#fff", border:"none", borderRadius:14, fontFamily:F.sans, fontSize:14, fontWeight:600, cursor:"pointer", marginBottom:showShopping?12:0, minHeight:48, touchAction:"manipulation" }}>
            🛒 Shopping List ({mealPlan.shoppingList.length} items)
          </button>}

          {mealPlan && showShopping && (
            <Card>
              {(["produce","protein","pantry","dairy","frozen","other"] as const).map(cat=>{
                const items = mealPlan.shoppingList.filter(i=>i.category===cat);
                if (!items.length) return null;
                const catLabels = { produce:"🥦 Produce", protein:"🥩 Protein", pantry:"🥫 Pantry", dairy:"🥛 Dairy", frozen:"🧊 Frozen", other:"📦 Other" };
                return (
                  <div key={cat} style={{ marginBottom:12 }}>
                    <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, color:T.taupe, margin:"0 0 6px", textTransform:"uppercase", letterSpacing:"0.08em" }}>{catLabels[cat]}</p>
                    {items.map((item,idx)=>{
                      const globalIdx = mealPlan.shoppingList.indexOf(item);
                      return (
                        <div key={idx} onClick={()=>toggleShoppingItem(globalIdx)} role="button" tabIndex={0} onKeyDown={onEnterSpace} aria-label={`Toggle bought: ${item.item}`} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0", cursor:"pointer", touchAction:"manipulation" }}>
                          <div style={{ width:20, height:20, borderRadius:6, border:`2px solid ${item.checked?T.sage:T.linen}`, background:item.checked?T.sage:"transparent", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12 }}>{item.checked?"✓":""}</div>
                          <span style={{ fontFamily:F.sans, fontSize:13, color:item.checked?T.taupe:T.esp, textDecoration:item.checked?"line-through":"none" }}>
                            {item.quantity} {item.item}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </Card>
          )}
        </>}

        {!shownMealPlan && !generatingMeals && (
          <Card>
            <p style={{ fontFamily:F.sans, fontSize:14, color:T.taupe, textAlign:"center", padding:"20px 0", lineHeight:1.6 }}>
              Cleo will plan 7 days of meals based on your diet preferences, family size, and energy pattern — with a categorized shopping list.
            </p>
          </Card>
        )}
      </>}
    </div>
  );
}
