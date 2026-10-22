import React, { useState, useEffect, useMemo } from "react";
import { trackEvent } from "../../core/analytics";
import { T, F, S, TYPE, ATMOS, ATMOS_TEXT2 } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, Pill, Button, Input, AIBadge, GlowCard, Headline, ProgressRing, EmptyState, Segmented, CheckBox, StatusChip, SectionHeader, ListRow, TextButton } from "../../shared/components";
import { PlusIcon, SparkleIcon } from "../../shared/components/Icons";
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

// Ownership labels as status chips (the words carry the meaning).
const R_CARD = 18;
const OWNERSHIP_STATUS: Record<string, "dueSoon" | "neutral" | "overdue" | "handled"> = { ask: "dueSoon", waiting: "neutral", warn: "overdue", ok: "handled", done: "handled" };

const REMIND_INPUT: React.CSSProperties = { minHeight:36, padding:"6px 12px", borderRadius:99, border:`1px solid ${T.divider}`, background:T.surface, fontFamily:F.sans, fontSize:16, color:T.text, outline:"none" };

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
  const [showAllOk, setShowAllOk] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [remindAt, setRemindAt] = useState("");     // "" = no reminder
  const [remindEdit, setRemindEdit] = useState<{ id: string; value: string } | null>(null);

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
    // Only what she told us: no made-up defaults, and only food preferences from memory.
    const diet = p?.diet || "";
    const kidList = people.filter(m => m.role === "child");
    const kids = kidList.length
      ? kidList.map(k => k.name + (k.notes ? ` (${k.notes})` : "")).join(", ")
      : (p?.kids?.length ? String(p.kids.length) : "");
    const memCtx = user?.uid ? await buildMemoryContextV2(user.uid, { maxResults: 10, memoryTypes: ["preference"] }).catch(() => "") : "";

    const sys = `You are Cleo, a meal planner.
7 days Mon-Sun. Keep meal names under 6 words. prepTime is minutes. Shopping list max 25 items, categorized, all unchecked.
Consider: easier meals on busy weekdays, more elaborate on weekends.
Never include an ingredient named as an allergy or dislike anywhere in the notes below.`;
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

    const prompt = [diet && `Diet: ${diet}.`, kids && `Kids: ${kids}.`, "Budget-conscious.", memCtx && `Food preferences: ${memCtx}`].filter(Boolean).join(" ");
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

  // Plan at a glance: what needs her OK first, then her own tasks by when.
  const viewOf = (t: Task) => (uid && !t.isChore ? ownershipView(t, uid, nowMs) : null);
  const needsOk = sortedPending.filter(t => !t.userConfirmed || viewOf(t)?.needsMyAnswer || viewOf(t)?.canFollowUp);
  const okIds = new Set(needsOk.map(t => t.id));
  const mine = sortedPending.filter(t => !okIds.has(t.id));
  const dueNow = mine.filter(t => t.dueDate && t.dueDate <= today);
  const comingUp = mine.filter(t => t.dueDate && t.dueDate > today).sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  const anytime = mine.filter(t => !t.dueDate);
  const doneList = allTasks.filter(t => t.status === "completed");
  const cleoSuggestions = needsOk.filter(t => !t.userConfirmed && !viewOf(t)?.needsMyAnswer && !viewOf(t)?.canFollowUp);
  const OK_SHOWN = 3;

  // Meals: the saved plan, or Family's old dinner plan until a new one is made.
  const shownMealPlan: MealPlan | null = mealPlan || (familyDinnersToPlan(familyDinners) as MealPlan | null);
  const urgentSchool = schoolEvents.filter(e=>e.requiresAction).length;

  // One compact row per task: check it off, title, one line of detail.
  const taskRow = (t: Task, i: number) => {
    const own = viewOf(t);
    const doneNow = t.status === "completed";
    const late = !doneNow && !!t.dueDate && t.dueDate < today;
    const forWho = t.who || (t.assigneeUid && t.assigneeUid !== uid ? t.assigneeName : "");
    const bits = [
      forWho ? `For ${forWho}` : "",
      t.dueDate && !late ? (t.dueDate === today ? "Today" : `Due ${fmtDate(t.dueDate)}`) : "",
      t.category ? t.category.charAt(0).toUpperCase() + t.category.slice(1) : "",
    ].filter(Boolean).join(" · ");
    return (
      <ListRow key={t.id} divider={i > 0}
        leading={<CheckBox checked={doneNow} onToggle={()=>toggleTask(t.id)} label={doneNow ? `Mark ${t.title} not done` : `Mark ${t.title} done`} />}
        title={<span style={{ textDecoration:doneNow?"line-through":"none", color:doneNow?T.text2:T.text }}>{t.title}</span>}
        detail={<span style={{ display:"inline-flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          {late && <StatusChip status="overdue">Was due {fmtDate(t.dueDate!)}</StatusChip>}
          {t.priority === "must" && !doneNow && <StatusChip status="neutral">Must do</StatusChip>}
          {own && own.tone !== "ok" && !doneNow && <StatusChip status={OWNERSHIP_STATUS[own.tone] || "neutral"}>{own.label}</StatusChip>}
          {doneNow && t.completedByName ? `Done by ${t.completedByName}` : bits}
          {!t.isChore && !doneNow && (
            <button onClick={()=>setRemindEdit(remindEdit?.id===t.id ? null : { id:t.id, value:t.remindAt || defaultRemindAt() })}
              aria-label={t.remindAt ? `Change reminder for ${t.title}` : `Add a reminder for ${t.title}`}
              style={{ background:"none", border:"none", padding:"2px 0", fontFamily:F.sans, fontSize:TYPE.support, fontWeight:600, color:t.remindAt?T.planInk:T.action, cursor:"pointer" }}>
              {t.remindAt ? `Reminder ${formatRemindAt(t.remindAt)}` : "Remind me"}
            </button>
          )}
        </span>}
        actions={remindEdit?.id===t.id ? <>
          <input type="datetime-local" aria-label="Reminder date and time" value={remindEdit.value} onChange={e=>setRemindEdit({ id:t.id, value:e.target.value })} style={REMIND_INPUT}/>
          <Button size="sm" onClick={()=>saveReminder(t, remindEdit.value)} style={{ width:"auto" }}>Save</Button>
          {t.remindAt && <Button size="sm" variant="secondary" onClick={()=>saveReminder(t, "")} style={{ width:"auto" }}>Remove</Button>}
          <Button size="sm" variant="secondary" onClick={()=>setRemindEdit(null)} style={{ width:"auto" }}>Cancel</Button>
        </> : undefined}
        trailing={<button onClick={()=>deleteTask(t.id)} aria-label={`Delete ${t.title}`} style={{ background:"none", border:"none", color:T.text2, cursor:"pointer", fontSize:20, width:36, height:36, flexShrink:0 }}>×</button>} />
    );
  };

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle collapse eyebrow={new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})} title="Plan"/>

      {/* Plan's color is pale blue: today's progress as a ring */}
      <GlowCard tint="plan" reveal={false} style={{ padding:"16px 20px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:S.lg }}>
          <ProgressRing value={total ? done/total : 0} size={76} stroke={7} color={ATMOS.plan.chart} track={ATMOS.plan.chartSoft}>
            <span style={{ fontFamily:F.sans, fontSize:18, fontWeight:800, color:T.text, fontVariantNumeric:"tabular-nums" }}>{total ? `${Math.round(done/total*100)}%` : "0"}</span>
          </ProgressRing>
          <div style={{ minWidth:0 }}>
            <Headline size={21}>{total ? (pending.length ? `${pending.length} left to do` : "All done. Nice work.") : "Nothing planned yet"}</Headline>
            <p style={{ fontFamily:F.sans, fontSize:TYPE.support, color:ATMOS_TEXT2, margin:"4px 0 0" }}>{total ? `${done} of ${total} done today` : "Add a task below to get started."}</p>
          </div>
        </div>
      </GlowCard>

      {/* School alert */}
      {urgentSchool > 0 && (
        <div role="status" style={{ background:T.warnBg, borderRadius:R_CARD, padding:"12px 16px", marginBottom:S.md, display:"flex", alignItems:"center", gap:S.sm }}>
          <StatusChip status="dueSoon">Needs you</StatusChip>
          <p style={{ fontFamily:F.sans, fontSize:15, color:T.text, margin:0 }}>{urgentSchool} school item{urgentSchool>1?"s":""} need{urgentSchool>1?"":"s"} action</p>
        </div>
      )}

      <Segmented label="Plan views" value={tab as "tasks"|"week"|"school"|"meals"} onChange={v=>setTab(v)} options={[
        { id:"tasks", label:"Tasks" },
        { id:"week", label:"Week" },
        { id:"school", label:"School", badge: urgentSchool },
        { id:"meals", label:"Meals" },
      ]} />

      {/* ── TASKS TAB ──────────────────────────────────────────────── */}
      {tab==="tasks" && <>
        {/* Add task */}
        <Card>
          <div style={{ display:"flex", gap:8, marginBottom:(input.trim() || who !== "") ? 12 : 0 }}>
            <Input value={input} onChange={setInput} placeholder="Add a task" style={{ flex:1 }}/>
            <button onClick={addTask} disabled={!input.trim()} aria-label="Add task" style={{ width:48, height:48, borderRadius:12, background:input.trim()?T.action:T.divider, border:"none", color:"#fff", cursor:input.trim()?"pointer":"not-allowed", flexShrink:0, display:"grid", placeItems:"center" }}><PlusIcon size={22} color="#fff" strokeWidth={2.4}/></button>
          </div>
          {/* The details appear once she starts typing, so the form stays one line until needed. */}
          {(input.trim() || who !== "") && <>
          {/* Priority — 2 levels */}
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            {([{ id:"must", label:"Must do" }, { id:"nice", label:"Nice to do" }] as const).map(p=>(
              <button key={p.id} onClick={()=>setPriority(p.id as any)} aria-pressed={priority===p.id} style={{ flex:1, minHeight:44, padding:"10px", borderRadius:12, border:`1.5px solid ${priority===p.id?T.planInk:T.divider}`, background:priority===p.id?T.planBg:T.surface, color:priority===p.id?T.planInk:T.text, fontFamily:F.sans, fontSize:14, fontWeight:priority===p.id?700:500, cursor:"pointer", touchAction:"manipulation" }}>
                {p.label}
              </button>
            ))}
          </div>
          {/* Category + date row */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            {CATS.map(c=>(
              <Pill key={c} label={c.charAt(0).toUpperCase()+c.slice(1)} active={cat===c} onClick={()=>setCat(c)} color={T.planInk} />
            ))}
            <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} aria-label="Due date" style={{ minHeight:36, padding:"6px 12px", borderRadius:99, border:`1px solid ${T.divider}`, background:T.surface, fontFamily:F.sans, fontSize:16, color:T.text, outline:"none" }}/>
          </div>
          {/* Reminder: an alert on her phone at this time (tasks only, not family chores) */}
          {(!who || who.startsWith("uid:")) && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:10 }}>
              {remindAt ? <>
                <span style={{ fontFamily:F.sans, fontSize:14, fontWeight:600, color:T.text2 }}>Remind me:</span>
                <input type="datetime-local" aria-label="Reminder date and time" value={remindAt} onChange={e=>setRemindAt(e.target.value)} style={REMIND_INPUT}/>
                <Pill label="No reminder" onClick={()=>setRemindAt("")} color={T.planInk} />
              </> : (
                <Pill label="Remind me" onClick={()=>setRemindAt(defaultRemindAt())} color={T.planInk} />
              )}
            </div>
          )}
          {/* Who does it: another adult is asked first; kids and "Everyone" make a family chore */}
          {who.startsWith("uid:") && (
            <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"8px 0 0" }}>They'll be asked to accept or decline. It shows as waiting until they say yes.</p>
          )}
          {whoOptions.length > 1 && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:10 }}>
              <span style={{ fontFamily:F.sans, fontSize:14, fontWeight:600, color:T.text2 }}>Who:</span>
              {whoOptions.map(o=>(
                <Pill key={o.value||"me"} label={o.label} active={who===o.value} onClick={()=>setWho(o.value)} color={T.planInk} />
              ))}
            </div>
          )}
          </>}
        </Card>

        {/* Needs your OK: Cleo's suggestions and tasks someone asked her to take */}
        {needsOk.length > 0 && (
          <section aria-label="Needs your OK">
            <SectionHeader title={`Needs your OK · ${needsOk.length}`}
              action={cleoSuggestions.length > 1 ? "Add all from Cleo" : undefined}
              onAction={() => cleoSuggestions.forEach(t => confirmTask(t.id))} />
            <Card style={{ padding:`${S.xs}px ${S.lg}px` }}>
              {(showAllOk ? needsOk : needsOk.slice(0, OK_SHOWN)).map((t, i) => {
                const own = viewOf(t);
                // A task someone asked her to take is answered, not "added".
                const suggestion = !t.userConfirmed && !own?.needsMyAnswer && !own?.canFollowUp;
                return (
                  <ListRow key={t.id} divider={i > 0}
                    leading={<span aria-hidden="true" style={{ width:36, height:36, borderRadius:11, background:suggestion?T.cleoBg:T.planBg, display:"grid", placeItems:"center", flexShrink:0 }}>
                      {suggestion ? <SparkleIcon size={18} color={T.action} filled/> : <span style={{ fontFamily:F.sans, fontWeight:700, fontSize:15, color:T.planInk }}>{(t.createdByName || t.assigneeName || "?").charAt(0)}</span>}
                    </span>}
                    title={t.title}
                    detail={suggestion ? `Cleo suggested this${t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ""}` : own?.label}
                    trailing={suggestion ? (
                      <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                        <Button size="sm" variant="gentle" onClick={()=>confirmTask(t.id)} style={{ width:"auto" }} ariaLabel={`Add ${t.title} to your list`}>Add</Button>
                        <button onClick={()=>deleteTask(t.id)} aria-label={`Dismiss ${t.title}`} style={{ width:40, height:40, border:"none", background:"none", color:T.text2, fontSize:20, cursor:"pointer" }}>×</button>
                      </div>
                    ) : undefined}
                    actions={!suggestion && (own?.needsMyAnswer || own?.canFollowUp) ? (own?.needsMyAnswer ? <>
                      <Button size="sm" onClick={()=>answer(t, true)} style={{ width:"auto" }}>Accept</Button>
                      <Button size="sm" variant="secondary" onClick={()=>answer(t, false)} style={{ width:"auto" }}>Decline</Button>
                    </> : <>
                      <Button size="sm" onClick={()=>doItMyself(t)} style={{ width:"auto" }}>I'll do it</Button>
                      <Button size="sm" variant="secondary" onClick={()=>askAgain(t)} style={{ width:"auto" }}>Ask again</Button>
                    </>) : undefined} />
                );
              })}
              {needsOk.length > OK_SHOWN && (
                <div style={{ borderTop:`1px solid ${T.divider}` }}>
                  <TextButton onClick={()=>setShowAllOk(v=>!v)}>{showAllOk ? "Show fewer" : `Show ${needsOk.length - OK_SHOWN} more`}</TextButton>
                </div>
              )}
            </Card>
          </section>
        )}

        {mine.length === 0 && needsOk.length === 0 && (
          <EmptyState tint="plan" title="Your list is clear" body="Add a task above, or ask Cleo to pull tasks out of a message." />
        )}

        {([["Today", dueNow], ["Coming up", comingUp], ["Anytime", anytime]] as const).map(([title, list]) => list.length > 0 && (
          <section key={title} aria-label={title}>
            <SectionHeader title={`${title} · ${list.length}`} />
            <Card style={{ padding:`${S.xs}px ${S.lg}px` }}>
              {list.map((t, i) => taskRow(t, i))}
            </Card>
          </section>
        ))}

        {doneList.length > 0 && (
          <section aria-label="Done">
            <SectionHeader title={`Done · ${doneList.length}`} action={showDone ? "Hide" : "Show"} onAction={()=>setShowDone(v=>!v)} />
            {showDone && <Card style={{ padding:`${S.xs}px ${S.lg}px` }}>{doneList.map((t, i) => taskRow(t, i))}</Card>}
          </section>
        )}
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
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 10px" }}>Paste newsletter text</p>
          <textarea value={newsletterText} onChange={e=>setNewsletterText(e.target.value)} placeholder="Paste your school newsletter here — Cleo will extract all events, deadlines, permission slips, payments, and action items automatically..." style={{ width:"100%", minHeight:120, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"12px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", resize:"vertical", boxSizing:"border-box", marginBottom:12 }}/>
          <Button onClick={extractFromNewsletter} disabled={!newsletterText.trim()||extracting} variant="gold">
            {extracting?"✦ Cleo is reading...":"✦ Extract Events & Actions"}
          </Button>
        </Card>

        {schoolEvents.length>0 && (
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:0 }}>SCHOOL EVENTS ({schoolEvents.length})</p>
              <AIBadge label="Extracted by Cleo"/>
            </div>
            {schoolEvents.map(e=>{
              const typeColors: Record<string,string> = { "parent-evening":T.blush, trip:T.gold, deadline:"#dc2626", sport:T.sage };
              return (
                <div key={e.id} style={{ padding:"12px 0", borderBottom:`1px solid ${T.linen}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                    <div style={{ flex:1 }}>
                      <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>{e.title}</p>
                      <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"2px 0 0" }}>
                        {new Date((e.date||"").includes("T")?e.date:(e.date||"")+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}
                        {e.child?` · ${e.child}`:""}
                        {e.type && <span style={{ color:typeColors[e.type]||T.taupe }}> · {e.type}</span>}
                      </p>
                      {e.actionDeadline && e.actionDeadline!==e.date && (
                        <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"2px 0 0" }}>Needs action by {fmtDate(e.actionDeadline)}</p>
                      )}
                    </div>
                    {e.requiresAction && (
                      <span style={{ background:`${T.blush}20`, color:T.blush, fontFamily:F.sans, fontSize: 14, fontWeight: 600, padding:"3px 8px", borderRadius:10, flexShrink:0 }}>
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
                  <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:isToday?T.gold:T.taupe, margin:0 }}>{day.dayName}{isToday?" · TODAY":""}</p>
                  {day.prepTime && <span style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe }}>⏱ {day.prepTime}min</span>}
                </div>
                {[
                  { label:"B", meal:day.breakfast, color:T.gold },
                  { label:"L", meal:day.lunch,     color:T.sage },
                  { label:"D", meal:day.dinner,    color:T.esp },
                  { label:"S", meal:day.snack,     color:T.taupe },
                ].filter(m=>m.meal).map(m=>(
                  <div key={m.label} style={{ display:"flex", gap:10, padding:"4px 0" }}>
                    <span style={{ fontFamily:F.sans, fontSize: 12, fontWeight:700, color:m.color, width:14, flexShrink:0 }}>{m.label}</span>
                    <span style={{ fontFamily:F.sans, fontSize:13, color:T.esp }}>{m.meal}</span>
                  </div>
                ))}
                {day.prepNotes && <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"8px 0 0", fontStyle:"italic" }}>💡 {day.prepNotes}</p>}
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
                    <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 6px" }}>{catLabels[cat]}</p>
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
