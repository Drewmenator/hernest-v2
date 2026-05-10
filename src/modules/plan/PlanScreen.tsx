import React, { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, HeroCard, Pill, Button, Input, ProgressBar, AIBadge } from "../../shared/components";
import { saveData, loadData } from "../../core/firebase";
import { ai } from "../../core/ai";
import { bus } from "../../core/events";
import { buildMemoryContext } from "../../core/memory";
import toast from "react-hot-toast";

// ── Types ──────────────────────────────────────────────────────────
interface Task {
  id: string;
  title: string;
  category: "Family" | "Work" | "Me" | "Home" | "Travel" | "School";
  done: boolean;
  priority: "high" | "medium" | "low";
  source: "manual" | "nora" | "school" | "trip";
  dueDate?: string;
  createdAt: number;
}

interface SchoolEvent {
  id: string;
  title: string;
  date: string;
  child?: string;
  requiresAction: boolean;
  actionType?: string;
  notes?: string;
}

interface Meal {
  b: string; // breakfast
  l: string; // lunch
  d: string; // dinner
}

const CATS = ["Family", "Work", "Me", "Home", "Travel", "School"] as const;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function PlanScreen() {
  const { user, profile } = useStore();
  const [tab, setTab] = useState("tasks");

  // Tasks state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState("");
  const [cat, setCat] = useState<Task["category"]>("Family");
  const [filter, setFilter] = useState("all");

  // School state
  const [schoolEvents, setSchoolEvents] = useState<SchoolEvent[]>([]);
  const [newsletterText, setNewsletterText] = useState("");
  const [extracting, setExtracting] = useState(false);

  // Meals state
  const [meals, setMeals] = useState<Record<string, Meal>>({});
  const [shoppingList, setShoppingList] = useState<string[]>([]);
  const [generatingMeals, setGeneratingMeals] = useState(false);

  const done = tasks.filter(t => t.done).length;
  const total = tasks.length;

  // Load data
  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "tasks").then(d => {
      if (d?.tasks) setTasks(d.tasks as any);
    });
    loadData(user.uid, "school").then(d => {
      if (d?.events) setSchoolEvents(d.events as any);
    });
    loadData(user.uid, "meals").then(d => {
      if (d?.meals) setMeals(d.meals as any);
      if (d?.shoppingList) setShoppingList(d.shoppingList as any);
    });
  }, [user?.uid]);

  // ── Task Actions ──────────────────────────────────────────────────
  const addTask = async () => {
    if (!input.trim()) return;
    const task: Task = {
      id: crypto.randomUUID(),
      title: input.trim(),
      category: cat,
      done: false,
      priority: "medium",
      source: "manual",
      createdAt: Date.now(),
    };
    const updated = [task, ...tasks];
    setTasks(updated);
    setInput("");
    if (user?.uid) {
      await saveData(user.uid, "tasks", { tasks: updated });
      await bus.publish("plan.task.created", task, { userId: user.uid, source: "plan" });
    }
  };

  const toggleTask = async (id: string) => {
    const updated = tasks.map(t => t.id === id ? { ...t, done: !t.done } : t);
    setTasks(updated);
    const task = updated.find(t => t.id === id);
    if (user?.uid) {
      await saveData(user.uid, "tasks", { tasks: updated });
      if (task?.done) {
        await bus.publish("plan.task.completed", task, { userId: user.uid, source: "plan" });
        toast.success("Task complete ✓");
      }
    }
  };

  const deleteTask = async (id: string) => {
    const updated = tasks.filter(t => t.id !== id);
    setTasks(updated);
    if (user?.uid) {
      await saveData(user.uid, "tasks", { tasks: updated });
      await bus.publish("plan.task.deleted", { id }, { userId: user.uid, source: "plan" });
    }
  };

  // ── School Newsletter Extraction ──────────────────────────────────
  const extractFromNewsletter = async () => {
    if (!newsletterText.trim()) return;
    setExtracting(true);
    const sys = `You are Nora extracting school events from a newsletter.
Return ONLY valid JSON array:
[{"title":"string","date":"YYYY-MM-DD","child":"string or null","requiresAction":true/false,"actionType":"permission-slip|payment|rsvp|supply|none","notes":"string"}]
Today is ${new Date().toISOString().split("T")[0]}. Extract all events, deadlines, and action items.`;

    const result = await ai(sys, newsletterText, "school_calendar");
    if (result.error) { toast.error("Couldn't extract events"); setExtracting(false); return; }

    try {
      const extracted = JSON.parse(result.text.replace(/```json|```/g, "").trim());
      const events: SchoolEvent[] = extracted.map((e: any) => ({
        id: crypto.randomUUID(), ...e
      }));
      const updated = [...events, ...schoolEvents];
      setSchoolEvents(updated);
      setNewsletterText("");

      // Auto-create tasks for action items per blueprint
      const actionTasks: Task[] = events
        .filter(e => e.requiresAction)
        .map(e => ({
          id: crypto.randomUUID(),
          title: `${e.actionType === "permission-slip" ? "Sign permission slip" : "Action needed"}: ${e.title}`,
          category: "School" as const,
          done: false,
          priority: "high" as const,
          source: "school" as const,
          dueDate: e.date,
          createdAt: Date.now(),
        }));

      if (actionTasks.length) {
        const updatedTasks = [...actionTasks, ...tasks];
        setTasks(updatedTasks);
        if (user?.uid) await saveData(user.uid, "tasks", { tasks: updatedTasks });
      }

      if (user?.uid) {
        await saveData(user.uid, "school", { events: updated });
        await bus.publish("plan.school.newsletter.parsed", { events, actionItems: actionTasks.length }, { userId: user.uid, source: "plan" });
      }

      toast.success(`Found ${events.length} events, ${actionTasks.length} action items`);
    } catch { toast.error("Couldn't parse events"); }
    setExtracting(false);
  };

  // ── Meal Plan Generation ──────────────────────────────────────────
  const generateMeals = async () => {
    setGeneratingMeals(true);
    const diet = profile?.diet || "no restrictions";
    const kids = profile?.kids?.length || 0;
    const energy = profile?.energyPattern || "morning";
    const memCtx = user?.uid ? await buildMemoryContext(user.uid) : "";

    const sys = `You are Nora, a meal planner. Return ONLY valid JSON:
{"meals":{"Mon":{"b":"","l":"","d":""},"Tue":{"b":"","l":"","d":""},"Wed":{"b":"","l":"","d":""},"Thu":{"b":"","l":"","d":""},"Fri":{"b":"","l":"","d":""},"Sat":{"b":"","l":"","d":""},"Sun":{"b":"","l":"","d":""}},"shoppingList":["item"]}
Keep meal names under 5 words. Shopping list max 20 items.`;

    const ctx = `Diet: ${diet}. Kids: ${kids}. Energy pattern: ${energy} person.${memCtx ? ` Context: ${memCtx}` : ""} Quick practical family meals.`;
    const result = await ai(sys, ctx, "meal_plan");

    if (!result.error) {
      try {
        const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
        if (data.meals) setMeals(data.meals);
        if (data.shoppingList) setShoppingList(data.shoppingList);
        if (user?.uid) {
          await saveData(user.uid, "meals", { meals: data.meals, shoppingList: data.shoppingList });
          await bus.publish("plan.meal.generated", { days: 7 }, { userId: user.uid, source: "plan" });
        }
        toast.success("Meal plan ready ✦");
      } catch { toast.error("Couldn't generate meals"); }
    } else {
      toast.error("Meal planning failed");
    }
    setGeneratingMeals(false);
  };

  const filteredTasks = tasks.filter(t => {
    if (filter === "all") return !t.done;
    if (filter === "done") return t.done;
    return !t.done && t.category === filter;
  });

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle eyebrow={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase()} title="Plan" />

      <HeroCard eyebrow="TODAY'S PROGRESS" title={total ? `${done} of ${total} done` : "Nothing planned yet"} subtitle={total ? `${Math.round(done/total*100)}% complete` : "Add your first task below"} color={T.esp}>
        {total > 0 && <div style={{ marginTop: 12 }}><ProgressBar value={done} max={total} color={T.gold} /></div>}
      </HeroCard>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
        {["tasks", "school", "meals", "calendar"].map(t => (
          <Pill key={t} label={t === "tasks" ? "✓ Tasks" : t === "school" ? "🏫 School" : t === "meals" ? "🍽 Meals" : "📅 Calendar"} active={tab === t} onClick={() => setTab(t)} />
        ))}
      </div>

      {/* ── TASKS TAB ──────────────────────────────────────────────── */}
      {tab === "tasks" && (
        <>
          {/* Category filter */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
            <Pill label="All" active={filter === "all"} onClick={() => setFilter("all")} />
            {CATS.map(c => <Pill key={c} label={c} active={filter === c} onClick={() => setFilter(c)} />)}
            <Pill label="Done" active={filter === "done"} onClick={() => setFilter("done")} />
          </div>

          {/* Add task */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Input value={input} onChange={setInput} placeholder="Add a task..." style={{ flex: 1 }} />
            <button onClick={addTask} disabled={!input.trim()} style={{ width: 44, height: 44, borderRadius: 12, background: input.trim() ? T.esp : T.linen, border: "none", color: "#fff", fontSize: 22, cursor: input.trim() ? "pointer" : "not-allowed", flexShrink: 0 }}>+</button>
          </div>

          {/* Category selector */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 16 }}>
            {CATS.map(c => (
              <button key={c} onClick={() => setCat(c)} style={{ padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${cat === c ? T.gold : T.linen}`, background: cat === c ? T.goldP : "#fff", color: cat === c ? T.gold : T.bark, fontFamily: F.sans, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, fontWeight: cat === c ? 700 : 400 }}>
                {c}
              </button>
            ))}
          </div>

          {/* Task list */}
          {filteredTasks.length === 0 ? (
            <Card><p style={{ fontFamily: F.sans, fontSize: 14, color: T.taupe, textAlign: "center", padding: "20px 0" }}>{filter === "done" ? "No completed tasks yet" : "No tasks here — add one above"}</p></Card>
          ) : (
            filteredTasks.map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: T.ivory, borderRadius: 16, border: `1px solid ${T.linen}`, marginBottom: 8 }}>
                <button onClick={() => toggleTask(t.id)} style={{ width: 24, height: 24, borderRadius: 7, border: `2px solid ${t.done ? T.sage : T.linen}`, background: t.done ? T.sage : "transparent", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13 }}>
                  {t.done ? "✓" : ""}
                </button>
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: F.sans, fontSize: 13, color: t.done ? T.taupe : T.esp, margin: 0, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</p>
                  <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                    <span style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t.category}</span>
                    {t.source !== "manual" && <span style={{ fontFamily: F.sans, fontSize: 10, color: T.gold }}>✦ {t.source}</span>}
                  </div>
                </div>
                <button onClick={() => deleteTask(t.id)} style={{ background: "none", border: "none", color: T.taupe, cursor: "pointer", fontSize: 18, padding: 4 }}>×</button>
              </div>
            ))
          )}
        </>
      )}

      {/* ── SCHOOL TAB ─────────────────────────────────────────────── */}
      {tab === "school" && (
        <>
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" }}>PASTE NEWSLETTER TEXT</p>
            <textarea value={newsletterText} onChange={e => setNewsletterText(e.target.value)} placeholder="Paste your school newsletter here and Nora will extract all events, deadlines, and action items automatically..." style={{ width: "100%", minHeight: 120, background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "12px 14px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none", resize: "vertical", boxSizing: "border-box", marginBottom: 12 }} />
            <Button onClick={extractFromNewsletter} disabled={!newsletterText.trim() || extracting} variant="gold">
              {extracting ? "✦ Nora is reading..." : "✦ Extract Events"}
            </Button>
          </Card>

          {schoolEvents.length > 0 && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: 0 }}>SCHOOL EVENTS ({schoolEvents.length})</p>
                <AIBadge label="Extracted by Nora" />
              </div>
              {schoolEvents.map(e => (
                <div key={e.id} style={{ padding: "10px 0", borderBottom: `1px solid ${T.linen}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>{e.title}</p>
                      <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "2px 0 0" }}>
                        {new Date(e.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        {e.child ? ` · ${e.child}` : ""}
                      </p>
                    </div>
                    {e.requiresAction && (
                      <span style={{ background: `${T.blush}20`, color: T.blush, fontFamily: F.sans, fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 10, textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>
                        {e.actionType || "Action needed"}
                      </span>
                    )}
                  </div>
                  {e.notes && <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "4px 0 0" }}>{e.notes}</p>}
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {/* ── MEALS TAB ──────────────────────────────────────────────── */}
      {tab === "meals" && (
        <>
          <Button onClick={generateMeals} disabled={generatingMeals} variant="gold" style={{ marginBottom: 16 }}>
            {generatingMeals ? "✦ Planning your week..." : "✦ Plan This Week's Meals"}
          </Button>

          {Object.keys(meals).length > 0 && (
            <>
              {DAYS.map(day => {
                const m = meals[day];
                if (!m) return null;
                return (
                  <Card key={day}>
                    <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.gold, margin: "0 0 8px" }}>{day}</p>
                    {[{ label: "Breakfast", val: m.b }, { label: "Lunch", val: m.l }, { label: "Dinner", val: m.d }].map(meal => (
                      <div key={meal.label} style={{ display: "flex", gap: 10, padding: "5px 0" }}>
                        <span style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, width: 60, flexShrink: 0 }}>{meal.label}</span>
                        <span style={{ fontFamily: F.sans, fontSize: 13, color: T.esp }}>{meal.val}</span>
                      </div>
                    ))}
                  </Card>
                );
              })}

              {shoppingList.length > 0 && (
                <Card>
                  <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>SHOPPING LIST</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {shoppingList.map((item, i) => (
                      <span key={i} style={{ background: T.sand, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "5px 12px", fontFamily: F.sans, fontSize: 12, color: T.esp }}>
                        {item}
                      </span>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}

          {Object.keys(meals).length === 0 && !generatingMeals && (
            <Card>
              <p style={{ fontFamily: F.sans, fontSize: 14, color: T.taupe, textAlign: "center", padding: "20px 0", lineHeight: 1.6 }}>
                Nora will plan 7 days of meals based on your diet preferences, family size, and energy pattern.
              </p>
            </Card>
          )}
        </>
      )}

      {/* ── CALENDAR TAB ───────────────────────────────────────────── */}
      {tab === "calendar" && (
        <Card>
          <p style={{ fontFamily: F.sans, fontSize: 14, color: T.taupe, textAlign: "center", padding: "20px 0", lineHeight: 1.6 }}>
            Calendar sync coming.<br />Connect Google Calendar in Profile to see all your events here.
          </p>
        </Card>
      )}
    </div>
  );
}
