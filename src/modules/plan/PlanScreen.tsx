import React, { useState, useEffect } from "react";
import { trackEvent } from "../../core/analytics";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, HeroCard, Pill, Button, Input, ProgressBar, AIBadge, EmptyState } from "../../shared/components";
import { todayLocal } from "../../core/dateAwareness";
import { saveData, loadData } from "../../core/firebase";
import { ai } from "../../core/ai";
import { bus } from "../../core/events";
import { buildMemoryContext } from "../../core/memory";
import { buildMemoryContextV2 } from "../../core/memoryServiceV2";
import toast from "react-hot-toast";
import { onEnterSpace } from "../../shared/utils/a11y";

// ── Types per blueprint ────────────────────────────────────────────
interface Task {
  id: string; title: string;
  category: "family"|"work"|"home"|"travel"|"personal"|"School";
  priority: "must"|"nice"|"critical"|"high"|"medium"|"low";
  status: "pending"|"completed";
  source: "manual"|"cleo"|"school"|"trip";
  energyRequired: "high"|"medium"|"low";
  userConfirmed: boolean;
  dueDate?: string; estimatedMinutes?: number;
  createdAt: number;
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
interface MealPlan { days: DayMeal[]; shoppingList: ShoppingItem[]; generatedAt: number; }

const CATS = ["family","work","home","travel","personal"] as const;
const PRIORITY_COLORS: Record<string,string> = { must:T.esp, nice:T.sage, critical:"#dc2626", high:T.gold, medium:T.esp, low:T.taupe };
const ENERGY_ICONS: Record<string,string> = { high:"⚡", medium:"◦", low:"🌿" };

const DAYS_OF_WEEK = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

// Friendly short date (e.g. "Jul 3") from an ISO yyyy-mm-dd string.
const fmtDate = (d: string) => { try { return new Date(d+"T00:00:00").toLocaleDateString("en-GB",{month:"short",day:"numeric"}); } catch { return d; } };

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

export function PlanScreen() {
  const { user, profile, householdSnapshot } = useStore();
  const [tab, setTab] = useState("tasks");

  // Tasks
  const [tasks, setTasks]     = useState<Task[]>([]);
  const [input, setInput]     = useState("");
  const [cat, setCat]         = useState<Task["category"]>("family");
  const [priority, setPriority] = useState<Task["priority"]>("must");
  const [energy, setEnergy]   = useState<Task["energyRequired"]>("medium");
  const [dueDate, setDueDate] = useState("");
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
  const done = tasks.filter(t=>t.status==="completed").length;
  const total = tasks.length;
  const pending = tasks.filter(t=>t.status==="pending");
  const energyPattern = (profile as any)?.energyPattern || "morning";

  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "tasks").then(d => { if(d?.tasks) setTasks(d.tasks as any); });
    loadData(user.uid, "school").then(d => { if(d?.events) setSchoolEvents(d.events as any); });
    loadData(user.uid, "meals").then(d => { if(d?.mealPlan) setMealPlan(d.mealPlan as any); });
  }, [user?.uid]);

  const persist = async (updated: Task[]) => {
    if (!user?.uid) { console.error("[Plan] No user uid — cannot save tasks"); return; }
    try {
      await saveData(user.uid, "tasks", { tasks: updated });
      console.log("[Plan] Saved", updated.length, "tasks for", user.uid);
    } catch(e) {
      console.error("[Plan] Save failed:", e);
    }
  };

  // ── Add task with energy level per blueprint ───────────────────────
  const addTask = async () => {
    if (!input.trim()) return;
    const task: Task = {
      id: crypto.randomUUID(), title: input.trim(), category: cat,
      priority, status: "pending", source: "manual",
      energyRequired: energy, userConfirmed: true,
      ...(dueDate ? { dueDate } : {}),
      createdAt: Date.now(),
    };
    const updated = [task, ...tasks];
    setTasks(updated); setInput(""); setDueDate("");
    await persist(updated);
    await bus.publish("plan.task.created", task, { userId: user!.uid, source: "plan" });
  };

  // ── Confirm AI-extracted task per blueprint ────────────────────────
  const confirmTask = async (id: string) => {
    const updated = tasks.map(t => t.id===id ? { ...t, userConfirmed:true } : t);
    setTasks(updated); await persist(updated);
    trackEvent("task_confirmed");
    toast.success("Task confirmed ✓");
  };

  const toggleTask = async (id: string) => {
    const updated = tasks.map(t => t.id===id ? { ...t, status: t.status==="completed"?"pending":"completed" as any } : t);
    setTasks(updated); await persist(updated);
    const t = updated.find(t=>t.id===id);
    if (t?.status==="completed") {
      await bus.publish("plan.task.completed", t, { userId:user!.uid, source:"plan" });
      toast.success("Task complete ✓");
    }
  };

  const deleteTask = async (id: string) => {
    const updated = tasks.filter(t=>t.id!==id);
    setTasks(updated); await persist(updated);
  };

  // ── School newsletter extraction per blueprint ──────────────────────
  const extractFromNewsletter = async () => {
    if (!newsletterText.trim() || !user?.uid) return;
    setExtracting(true);

    try {
      const { extractSchoolEvents } = await import("../../core/schoolNewsletterService");
      const { events, allEvents, error } = await extractSchoolEvents(user.uid, newsletterText);
      if (error) { toast.error("Couldn't extract events"); setExtracting(false); return; }
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

      if (actionTasks.length) {
        const updatedTasks = [...actionTasks, ...tasks];
        setTasks(updatedTasks);
        await persist(updatedTasks);
      }

      toast.success(`Found ${events.length} events · ${events.filter(e=>e.requiresAction).length} need action`);
    } catch(e) { console.error('[Plan] newsletter parse:', e); toast.error("Couldn't read newsletter — try pasting plain text only"); }
    setExtracting(false);
  };

  // ── Meal plan per blueprint with structured format ─────────────────
  const generateMeals = async () => {
    setGeneratingMeals(true);
    const p = profile as any;
    const diet = p?.diet || "no restrictions";
    const kids = p?.kids?.length || 0;
    const energy = p?.energyPattern || "morning";
    const memCtx = user?.uid ? await buildMemoryContextV2(user.uid, { maxResults: 10 }).catch(() => buildMemoryContext(user.uid)) : "";

    const sys = `You are Cleo, a meal planner. Return ONLY valid JSON:
{
  "days": [
    {"dayName":"Monday","date":"YYYY-MM-DD","breakfast":"string","lunch":"string","dinner":"string","snack":"string","prepNotes":"string","prepTime":30}
  ],
  "shoppingList": [
    {"item":"string","quantity":"string","category":"produce|protein|pantry|dairy|frozen|other","checked":false}
  ]
}
7 days Mon-Sun. Keep meal names under 6 words. Shopping list max 25 items, categorized.
Consider: easier meals on busy weekdays, more elaborate on weekends.`;

    const prompt = `Diet: ${diet}. Kids: ${kids}. Energy: ${energy} person. Budget-conscious. ${memCtx?"Context: "+memCtx:""}`;
    const result = await ai(sys, prompt, "meal_plan");

    if (!result.error) {
      try {
        const raw = JSON.parse(result.text.replace(/```json\s*/gi,"").replace(/```/g,"").trim());
        // Add actual dates per blueprint
        const now = new Date();
        const monday = new Date(now);
        monday.setDate(monday.getDate() - monday.getDay() + 1);

        const days: DayMeal[] = (raw.days||[]).map((d:any, i:number) => {
          const date = new Date(monday);
          date.setDate(monday.getDate() + i);
          return { ...d, date: date.toISOString().split("T")[0], dayName: DAYS_OF_WEEK[i] };
        });

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
  const sortedPending = [...pending].sort((a,b) => scoreTask(b,energyPattern) - scoreTask(a,energyPattern));

  const filteredTasks = filter==="all" ? sortedPending
    : filter==="done" ? tasks.filter(t=>t.status==="completed")
    : filter==="unconfirmed" ? tasks.filter(t=>!t.userConfirmed&&t.status==="pending")
    : sortedPending.filter(t=>t.category===filter);

  const unconfirmedCount = tasks.filter(t=>!t.userConfirmed&&t.status==="pending").length;
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
        </Card>

        {/* Task list sorted by priority score per blueprint */}
        {filteredTasks.length===0 ? (
          <EmptyState
            icon={filter==="done" ? "✓" : "◈"}
            title={filter==="done" ? "Nothing completed yet" : "Your list is clear"}
            body={filter==="done" ? "Tasks you complete will show up here." : "Add a task below or ask Cleo to pull tasks from a message — I'll keep them in order for you ✦"}
          />
        ) : filteredTasks.map(t=>(
          <div key={t.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", background:t.status==="completed"?"#fff":t.priority==="must"?`${T.esp}06`:`${T.sage}06`, borderRadius:16, border:`1.5px solid ${t.status==="completed"?T.linen:t.priority==="must"?`${T.esp}20`:`${T.sage}20`}`, marginBottom:8 }}>
            <button onClick={()=>toggleTask(t.id)} style={{ width:24, height:24, borderRadius:7, border:`2px solid ${t.status==="completed"?T.sage:PRIORITY_COLORS[t.priority]||T.linen}`, background:t.status==="completed"?T.sage:"transparent", flexShrink:0, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:13, minHeight:24, touchAction:"manipulation" }}>
              {t.status==="completed"?"✓":""}
            </button>
            <div style={{ flex:1 }}>
              <p style={{ fontFamily:F.sans, fontSize:13, color:t.status==="completed"?T.taupe:T.esp, margin:0, textDecoration:t.status==="completed"?"line-through":"none" }}>{t.title}</p>
              <div style={{ display:"flex", gap:6, marginTop:4, flexWrap:"wrap", alignItems:"center" }}>
                <span style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, color:t.priority==="must"?T.esp:T.sage, padding:"2px 8px", borderRadius:10, background:t.priority==="must"?`${T.esp}10`:`${T.sage}10` }}>{t.priority==="must"?"✦ must":t.priority==="nice"?"◦ nice":t.priority}</span>
                <span style={{ fontFamily:F.sans, fontSize:10, color:T.taupe }}>{t.category}</span>
                {t.dueDate && <span style={{ fontFamily:F.sans, fontSize:10, color:t.dueDate<today?T.taupe:T.taupe, fontWeight:t.dueDate<today?700:400 }}>{t.dueDate<today?`was due ${fmtDate(t.dueDate)}`:`due ${fmtDate(t.dueDate)}`}</span>}
                {t.source!=="manual" && <span style={{ fontFamily:F.sans, fontSize:10, color:T.gold }}>✦ {t.source}</span>}
              </div>
            </div>
            {/* Confirm button for unconfirmed tasks per blueprint */}
            {!t.userConfirmed && (
              <button onClick={()=>confirmTask(t.id)} style={{ background:T.gold, color:"#fff", border:"none", borderRadius:8, padding:"5px 10px", fontFamily:F.sans, fontSize:11, cursor:"pointer", flexShrink:0, minHeight:30 }}>Confirm</button>
            )}
            <button onClick={()=>deleteTask(t.id)} style={{ background:"none", border:"none", color:T.taupe, cursor:"pointer", fontSize:18, padding:4, minHeight:36 }}>×</button>
          </div>
        ))}
      </>}

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

        {mealPlan && <>
          {/* Day cards */}
          {mealPlan.days.map((day,i)=>{
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
          <button onClick={()=>setShowShopping(!showShopping)} style={{ width:"100%", padding:"12px", background:T.esp, color:"#fff", border:"none", borderRadius:14, fontFamily:F.sans, fontSize:14, fontWeight:600, cursor:"pointer", marginBottom:showShopping?12:0, minHeight:48, touchAction:"manipulation" }}>
            🛒 Shopping List ({mealPlan.shoppingList.length} items)
          </button>

          {showShopping && (
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

        {!mealPlan && !generatingMeals && (
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
