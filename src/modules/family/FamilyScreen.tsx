import React, { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore, FamilyMember, SchoolInfo }  from "../../core/store";
import { Card, PageTitle, Pill, Spinner, EmptyState } from "../../shared/components";
import { bus } from "../../core/events";
import { saveData, loadData } from "../../core/firebase";
import { displayAge } from "../../core/dateAwareness";
import { ai } from "../../core/ai";
import toast from "react-hot-toast";

const ROLE_COLORS: Record<string, string> = {
  partner: T.blush, child: T.sky, parent: T.sage, inlaw: T.orange, other: T.taupe,
};
const ROLE_ICONS: Record<string, string> = {
  partner: "💛", child: "⭐", parent: "🌿", inlaw: "🌸", other: "✦",
};
const MEMBER_COLORS = [T.gold, T.sage, T.sky, T.blush, T.esp, "#9b7ec8", "#e07b54"];

interface FamilyTask {
  id: string; title: string; assignedTo: string; done: boolean; dueDate?: string;
}
interface MealDay {
  day: string; dinner: string;
}


const COUNTRIES = [
  { id:"US", flag:"🇺🇸", label:"United States" },
  { id:"UK", flag:"🇬🇧", label:"United Kingdom" },
  { id:"AU", flag:"🇦🇺", label:"Australia" },
  { id:"CA", flag:"🇨🇦", label:"Canada" },
  { id:"NG", flag:"🇳🇬", label:"Nigeria" },
  { id:"GH", flag:"🇬🇭", label:"Ghana" },
  { id:"ZA", flag:"🇿🇦", label:"South Africa" },
  { id:"AE", flag:"🇦🇪", label:"UAE" },
  { id:"other", flag:"🌍", label:"Other" },
];

const US_GRADES = ["Pre-K","K","1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th"];
const UK_YEARS  = ["Nursery","Reception","Year 1","Year 2","Year 3","Year 4","Year 5","Year 6","Year 7","Year 8","Year 9","Year 10","Year 11","Year 12","Year 13"];
const AU_YEARS  = ["Prep","Year 1","Year 2","Year 3","Year 4","Year 5","Year 6","Year 7","Year 8","Year 9","Year 10","Year 11","Year 12"];

function getGrades(country: string): string[] {
  if (country === "UK") return UK_YEARS;
  if (country === "AU") return AU_YEARS;
  return US_GRADES;
}


// ── Simple iCal parser ───────────────────────────────────────────
function parseICal(text: string, childName: string, childColor: string) {
  const events: any[] = [];
  const blocks = text.split("BEGIN:VEVENT");
  for (const block of blocks.slice(1)) {
    const get = (key: string) => {
      const match = block.match(new RegExp(key + "[^:]*:([^\r\n]+)"));
      return match ? match[1].trim() : "";
    };
    const title = get("SUMMARY");
    const dtstart = get("DTSTART");
    const dtend = get("DTEND");
    if (!title || !dtstart) continue;
    const formatDate = (d: string) => {
      const clean = d.replace(/T.*/, "");
      return `${clean.slice(0,4)}-${clean.slice(4,6)}-${clean.slice(6,8)}`;
    };
    events.push({
      id: `school_${childName}_${dtstart}_${Math.random().toString(36).slice(2,6)}`,
      title: `${childName}: ${title}`,
      date: formatDate(dtstart),
      endDate: dtend ? formatDate(dtend) : undefined,
      source: "school-term",
      color: childColor,
      child: childName,
    });
  }
  return events;
}

export function FamilyScreen() {
  const { user, profile, familyMembers, setFamilyMembers } = useStore();
  const [tab, setTab] = useState("members");
  const [tasks, setTasks] = useState<FamilyTask[]>([]);
  const [taskInput, setTaskInput] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [meals, setMeals] = useState<MealDay[]>([]);
  const [generatingMeals, setGeneratingMeals] = useState(false);
  const [cleoInput, setCleoInput] = useState("");
  const [cleoResp, setCleoResp] = useState("");
  const [cleoLoading, setCleoLoading] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<FamilyMember["role"]>("child");
  const [newAge, setNewAge] = useState("");
  const [newBirthDate, setNewBirthDate] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [schoolEditId, setSchoolEditId] = useState<string|null>(null);
  const [schoolDraft, setSchoolDraft] = useState<SchoolInfo>({ country:"US", schoolType:"public" });

  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "family").then(async d => {
      if (d?.members && (d.members as any[]).length > 0) {
        // Backfill birthDate onto members that predate date-of-birth tracking,
        // matching profile kids by name. This makes ages self-correct (a child
        // saved as "6" gets their real DOB and computes the current age live).
        let members = d.members as FamilyMember[];
        try {
          const profileData = await loadData(user.uid, "profile");
          const kids = ((profileData?.kids || profileData?.children || []) as any[]);
          let changed = false;
          members = members.map(m => {
            if (m.birthDate || !m.name) return m;
            const kid = kids.find(k => k?.name?.trim().toLowerCase() === m.name.trim().toLowerCase() && k?.birthDate);
            if (kid) { changed = true; return { ...m, birthDate: kid.birthDate }; }
            return m;
          });
          if (changed) await saveData(user.uid, "family", JSON.parse(JSON.stringify({ members, tasks: d.tasks || [], meals: d.meals || [] })));
        } catch { /* non-fatal */ }
        setFamilyMembers(members);
      } else {
        // Seed from profile if no family members yet
        const profileData = await loadData(user.uid, "profile");
        if (profileData) {
          const seeded: FamilyMember[] = [];
          const colors = ["#F472A0","#5BB8E8","#4CAF7D","#F97316","#C9A961","#8B7BB5"];
          let ci = 0;

          // Add partner
          if (profileData.partner && (profileData.partner as any).name) {
            seeded.push({
              id: crypto.randomUUID(),
              name: (profileData.partner as any).name,
              role: "partner",
              color: colors[ci++ % colors.length],
            });
          }

          // Add children
          const kids = (profileData.kids || profileData.children || []) as any[];
          for (const k of kids) {
            if (!k.name) continue;
            seeded.push({
              id: k.id || crypto.randomUUID(),
              name: k.name,
              role: "child",
              // Store the DOB, not a frozen age — age is computed live on display.
              birthDate: k.birthDate || undefined,
              age: typeof k.age === "number" ? k.age : undefined,
              notes: [k.school, (k.allergies||[]).join(", ")].filter(Boolean).join(" · ") || undefined,
              color: colors[ci++ % colors.length],
            });
          }

          if (seeded.length > 0) {
            setFamilyMembers(seeded);
            await saveData(user.uid, "family", JSON.parse(JSON.stringify({ members: seeded, tasks: [], meals: [] })));
          }
        }
      }
      if (d?.tasks) setTasks(d.tasks as FamilyTask[]);
      if (d?.meals) setMeals(d.meals as MealDay[]);
    });
  }, [user?.uid]);

  const saveSchoolInfo = async (memberId: string) => {
    const updated = familyMembers.map(m =>
      m.id === memberId ? { ...m, schoolInfo: schoolDraft } : m
    );
    setFamilyMembers(updated);
    await saveData(user!.uid, "family", JSON.parse(JSON.stringify({ members: updated, tasks, meals })));
    await bus.publish("family.updated", { memberId }, { userId: user!.uid, source: "family" });
    setSchoolEditId(null);
    toast.success("School calendar saved ✦");
  };

  const persistAll = async (members: FamilyMember[], t: FamilyTask[], m: MealDay[]) => {
    if (!user?.uid) return;
    await saveData(user.uid, "family", JSON.parse(JSON.stringify({ members, tasks: t, meals: m })));
  };

  const saveMember = async () => {
    if (!newName.trim()) return;
    let updated: FamilyMember[];
    if (editingId) {
      updated = familyMembers.map(m => m.id === editingId
        ? { ...m, name: newName.trim(), role: newRole, birthDate: newBirthDate || undefined, age: newAge ? parseInt(newAge) : undefined, notes: newNotes || undefined }
        : m
      );
    } else {
      const member: FamilyMember = {
        id: crypto.randomUUID(),
        name: newName.trim(),
        role: newRole,
        birthDate: newBirthDate || undefined,
        age: newAge ? parseInt(newAge) : undefined,
        notes: newNotes || undefined,
        color: MEMBER_COLORS[familyMembers.length % MEMBER_COLORS.length],
      };
      updated = [...familyMembers, member];
    }
    setFamilyMembers(updated);
    await persistAll(updated, tasks, meals);
    setShowAdd(false); setNewName(""); setNewRole("child"); setNewAge(""); setNewBirthDate(""); setNewNotes(""); setEditingId(null);
    toast.success(editingId ? "Updated ✓" : "Family member added ✓");
  };

  const deleteMember = async (id: string) => {
    const updated = familyMembers.filter(m => m.id !== id);
    setFamilyMembers(updated);
    await persistAll(updated, tasks, meals);
  };

  const startEdit = (m: FamilyMember) => {
    setEditingId(m.id); setNewName(m.name); setNewRole(m.role);
    setNewAge(m.age?.toString() || ""); setNewBirthDate(m.birthDate || ""); setNewNotes(m.notes || "");
    setShowAdd(true);
  };

  const addTask = async () => {
    if (!taskInput.trim()) return;
    const task: FamilyTask = {
      id: crypto.randomUUID(), title: taskInput.trim(),
      assignedTo: assignTo || "Everyone", done: false,
    };
    const updated = [task, ...tasks];
    setTasks(updated); setTaskInput(""); setAssignTo("");
    await persistAll(familyMembers, updated, meals);
  };

  const toggleTask = async (id: string) => {
    const updated = tasks.map(t => t.id === id ? { ...t, done: !t.done } : t);
    setTasks(updated);
    await persistAll(familyMembers, updated, meals);
  };

  const deleteTask = async (id: string) => {
    const updated = tasks.filter(t => t.id !== id);
    setTasks(updated);
    await persistAll(familyMembers, updated, meals);
  };

  const generateFamilyMeals = async () => {
    setGeneratingMeals(true);
    const kids = familyMembers.filter(m => m.role === "child").map(m => m.name).join(", ") || "none";
    const diet = (profile as any)?.diet || "no restrictions";
    const sys = `You are Cleo. Return ONLY valid JSON array of 7 objects:
[{"day":"Monday","dinner":"meal name under 6 words"}]
Mon-Sun. Family-friendly, varied, budget-conscious. Kids: ${kids}. Diet: ${diet}.`;
    const familyCtx = familyMembers.map((m: any) => { const a = displayAge(m); return `${m.name} (${m.role}${a != null ? ", age " + a : ""})`; }).join(", ");
    const result = await ai(sys, `Plan this week's family dinners. Family: ${familyCtx || "not specified"}. Keep it practical and family-friendly.`, "meal_plan");
    if (!result.error) {
      try {
        const parsed = (() => { const s=result.text.indexOf("{"); const e=result.text.lastIndexOf("}"); if(s===-1||e===-1) throw new Error("No JSON"); return JSON.parse(result.text.slice(s,e+1)); })();
        setMeals(parsed);
        await persistAll(familyMembers, tasks, parsed);
        toast.success("Dinner plan ready ✦");
      } catch { toast.error("Couldn't parse meal plan"); }
    }
    setGeneratingMeals(false);
  };

  const askCleo = async () => {
    if (!cleoInput.trim() || cleoLoading) return;
    setCleoLoading(true);
    const roster = familyMembers.map(m => { const a = displayAge(m); return `${m.name} (${m.role}${a != null ? ", age " + a : ""}${m.notes ? ", " + m.notes : ""})`; }).join("; ");
    const taskList = tasks.filter((t: any) => !t.done).slice(0, 5).map((t: any) => `- ${t.title}${t.assignedTo ? " → " + t.assignedTo : ""}`).join("\n") || "No tasks";
    const mealList = meals.slice(0, 3).map((m: any) => `${m.dayName}: ${m.dinner}`).join(", ") || "No meals planned";
    const sys = `You are Cleo, family AI chief of staff for ${(profile as any)?.name || "this household"}.

FAMILY: ${roster || "not set up yet"}

THIS WEEK'S TASKS:
${taskList}

MEALS PLANNED: ${mealList}

CRITICAL: Only reference the information above — never invent events, names, dates, or facts not listed here. If asked about something not in the data above, say warmly "I don't have that info yet — want to add it?"
Be warm, direct, and specific. Use family members' names. Answer in 2-4 sentences.`;
    const result = await ai(sys, cleoInput, "cleo_chat");
    if (!result.error) setCleoResp(result.text);
    setCleoLoading(false);
  };

  const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle eyebrow="HOME" title="Family HQ" />

      <div style={{ display: "flex", gap: 8, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
        {[
          { id: "members", label: "👨‍👩‍👧 Members" },
          { id: "tasks",   label: "✓ Chores" },
          { id: "meals",   label: "🍽 Dinners" },
          { id: "cleo",    label: "✦ Ask Cleo" },
        ].map(t => <Pill key={t.id} label={t.label} active={tab === t.id} onClick={() => setTab(t.id)} />)}
      </div>

      {tab === "members" && <>
        {familyMembers.length === 0 && !showAdd && (
          <EmptyState
            icon="◉"
            title="Who's in your nest?"
            body="Add your people and Cleo starts connecting the dots — school events to the right child, plans to the right person."
            actionLabel="Add your first person ✦"
            onAction={() => setShowAdd(true)}
          />
        )}

        {familyMembers.map(m => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: T.ivory, borderRadius: 16, border: `1.5px solid ${T.linen}`, marginBottom: 8 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: `${m.color}25`, border: `2px solid ${m.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
              {ROLE_ICONS[m.role]}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 700, color: T.esp, margin: 0 }}>{m.name}</p>
              <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "2px 0 0" }}>
                {m.role}{displayAge(m) != null ? ` · age ${displayAge(m)}` : ""}{m.notes ? ` · ${m.notes}` : ""}
              </p>
            </div>
            {m.role === "child" && (
              <button onClick={() => { setSchoolEditId(m.id); setSchoolDraft(m.schoolInfo || { country:"US", schoolType:"public" }); }}
                style={{ background:m.schoolInfo?`${T.sage}15`:"none", border:`1px solid ${m.schoolInfo?T.sage:T.linen}`, borderRadius:8, padding:"5px 10px", fontFamily:F.sans, fontSize:11, color:m.schoolInfo?T.sage:T.taupe, cursor:"pointer", minHeight:30 }}>
                {m.schoolInfo ? "✓ School" : "🎒 School"}
              </button>
            )}
            <button onClick={() => startEdit(m)} style={{ background: "none", border: `1px solid ${T.linen}`, borderRadius: 8, padding: "5px 10px", fontFamily: F.sans, fontSize: 11, color: T.taupe, cursor: "pointer", minHeight: 30 }}>Edit</button>
            <button onClick={() => deleteMember(m.id)} style={{ background: "none", border: "none", color: T.taupe, fontSize: 18, cursor: "pointer", padding: 4, minHeight: 36 }}>×</button>
          </div>
        ))}

        {/* School Setup Modal — simple iCal upload */}
        {schoolEditId && (() => {
          const member = familyMembers.find(m => m.id === schoolEditId);
          if (!member) return null;
          return (
            <Card>
              <p style={{ fontFamily:F.serif, fontSize:22, fontStyle:"italic", color:T.esp, margin:"0 0 6px" }}>
                {member.name}'s School Calendar
              </p>
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 16px", lineHeight:1.6 }}>
                Download the .ics calendar file from your school's website and upload it here. Cleo will import all events automatically.
              </p>

              {/* Show existing events count */}
              {member.schoolInfo?.calendarEvents && member.schoolInfo.calendarEvents.length > 0 && (
                <div style={{ background:`${T.sage}10`, border:`1px solid ${T.sage}30`, borderRadius:12, padding:"10px 14px", marginBottom:14 }}>
                  <p style={{ fontFamily:F.sans, fontSize:13, color:T.sage, margin:0 }}>
                    ✓ {member.schoolInfo.calendarEvents.length} events loaded
                  </p>
                </div>
              )}

              {/* Upload button */}
              <label style={{ display:"block", background:T.esp, color:"#fff", borderRadius:14, padding:"14px", textAlign:"center", cursor:"pointer", fontFamily:F.sans, fontSize:14, fontWeight:600, marginBottom:12 }}>
                📅 Upload School Calendar (.ics)
                <input type="file" accept=".ics,.ical" onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  const events = parseICal(text, member.name, member.color);
                  if (events.length === 0) { alert("No events found in file — make sure it's a valid .ics calendar file"); return; }
                  const updated = familyMembers.map(m =>
                    m.id === schoolEditId ? { ...m, schoolInfo: { ...m.schoolInfo, country: m.schoolInfo?.country||"US", schoolType: m.schoolInfo?.schoolType||"public", calendarEvents: events } } : m
                  );
                  setFamilyMembers(updated);
                  await saveData(user!.uid, "family", JSON.parse(JSON.stringify({ members: updated, tasks, meals })));
                  // Sync to master calendar
                  const calendarData = await loadData(user!.uid, "calendar");
                  const existing = ((calendarData?.events as any[]) || []).filter((e:any) => e.child !== member.name);
                  await saveData(user!.uid, "calendar", { events: [...existing, ...events] });
                  await bus.publish("family.updated", { memberId: schoolEditId }, { userId: user!.uid, source: "family" });
                  toast.success(`${events.length} events imported for ${member.name} ✦`);
                  setSchoolEditId(null);
                }} style={{ display:"none" }}/>
              </label>

              <button onClick={() => setSchoolEditId(null)}
                style={{ width:"100%", padding:"12px", background:"none", border:`1.5px solid ${T.linen}`, borderRadius:12, fontFamily:F.sans, fontSize:14, color:T.bark, cursor:"pointer" }}>
                Cancel
              </button>
            </Card>
          );
        })()}

        {showAdd && (
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>
              {editingId ? "EDIT MEMBER" : "ADD FAMILY MEMBER"}
            </p>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "11px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 8, boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {(["partner","child","parent","inlaw","other"] as const).map(r => (
                <button key={r} onClick={() => setNewRole(r)} style={{ padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${newRole === r ? ROLE_COLORS[r] : T.linen}`, background: newRole === r ? `${ROLE_COLORS[r]}15` : "#fff", color: newRole === r ? ROLE_COLORS[r] : T.bark, fontFamily: F.sans, fontSize: 11, cursor: "pointer" }}>
                  {ROLE_ICONS[r]} {r}
                </button>
              ))}
            </div>
            <label style={{ display: "block", fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "0 0 4px 2px" }}>Date of birth (keeps age up to date)</label>
            <input value={newBirthDate} onChange={e => setNewBirthDate(e.target.value)} type="date" max={new Date().toISOString().split("T")[0]} style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "11px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 8, boxSizing: "border-box" }} />
            {!newBirthDate && <input value={newAge} onChange={e => setNewAge(e.target.value)} placeholder="Age (optional, if no date of birth)" type="number" style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "11px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 8, boxSizing: "border-box" }} />}
            <input value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Notes e.g. nut allergy, soccer Tuesdays (optional)" style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "11px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 12, boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveMember} disabled={!newName.trim()} style={{ flex: 1, padding: "12px", background: newName.trim() ? T.esp : T.linen, color: "#fff", border: "none", borderRadius: 12, fontFamily: F.sans, fontSize: 14, fontWeight: 600, cursor: newName.trim() ? "pointer" : "not-allowed", minHeight: 48 }}>
                {editingId ? "Save Changes" : "Add Member"}
              </button>
              <button onClick={() => { setShowAdd(false); setEditingId(null); setNewName(""); setNewAge(""); setNewNotes(""); }} style={{ padding: "12px 20px", background: "none", border: `1px solid ${T.linen}`, borderRadius: 12, fontFamily: F.sans, fontSize: 14, color: T.taupe, cursor: "pointer", minHeight: 48 }}>
                Cancel
              </button>
            </div>
          </Card>
        )}

        {!showAdd && (
          <button onClick={() => setShowAdd(true)} style={{ width: "100%", padding: "14px", background: T.ivory, border: `1.5px dashed ${T.linen}`, borderRadius: 16, fontFamily: F.sans, fontSize: 14, color: T.taupe, cursor: "pointer", marginTop: 4, minHeight: 52 }}>
            + Add family member
          </button>
        )}
      </>}

      {tab === "tasks" && <>
        <Card>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={taskInput} onChange={e => setTaskInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addTask()} placeholder="Add a chore or task..." style={{ flex: 1, background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "11px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", minHeight: 44 }} />
            <button onClick={addTask} disabled={!taskInput.trim()} style={{ width: 44, height: 44, borderRadius: 12, background: taskInput.trim() ? T.esp : T.linen, border: "none", color: "#fff", fontSize: 22, cursor: taskInput.trim() ? "pointer" : "not-allowed", flexShrink: 0 }}>+</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Everyone", ...familyMembers.map(m => m.name)].map(name => (
              <button key={name} onClick={() => setAssignTo(name)} style={{ padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${assignTo === name ? T.gold : T.linen}`, background: assignTo === name ? T.goldP : "#fff", color: assignTo === name ? T.gold : T.bark, fontFamily: F.sans, fontSize: 11, cursor: "pointer" }}>
                {name}
              </button>
            ))}
          </div>
        </Card>

        {tasks.length === 0 ? (
          <Card><p style={{ fontFamily: F.sans, fontSize: 14, color: T.taupe, textAlign: "center", padding: "20px 0" }}>No family tasks yet</p></Card>
        ) : tasks.map(t => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: T.ivory, borderRadius: 16, border: `1.5px solid ${T.linen}`, marginBottom: 8 }}>
            <button onClick={() => toggleTask(t.id)} style={{ width: 24, height: 24, borderRadius: 7, border: `2px solid ${t.done ? T.sage : T.linen}`, background: t.done ? T.sage : "transparent", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, minHeight: 24 }}>
              {t.done ? "✓" : ""}
            </button>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: F.sans, fontSize: 13, color: t.done ? T.taupe : T.esp, margin: 0, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</p>
              <p style={{ fontFamily: F.sans, fontSize: 11, color: T.gold, margin: "2px 0 0" }}>→ {t.assignedTo}</p>
            </div>
            <button onClick={() => deleteTask(t.id)} style={{ background: "none", border: "none", color: T.taupe, fontSize: 18, cursor: "pointer", padding: 4, minHeight: 36 }}>×</button>
          </div>
        ))}
      </>}

      {tab === "meals" && <>
        <button onClick={generateFamilyMeals} disabled={generatingMeals} style={{ width: "100%", padding: "14px", background: generatingMeals ? T.linen : T.esp, color: "#fff", border: "none", borderRadius: 16, fontFamily: F.sans, fontSize: 14, fontWeight: 600, cursor: generatingMeals ? "not-allowed" : "pointer", marginBottom: 16, minHeight: 52, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {generatingMeals ? <><Spinner size={16} color="#fff" /> Planning dinners...</> : "✦ Plan This Week's Dinners"}
        </button>

        {meals.length > 0 ? meals.map((m, i) => {
          const isToday = DAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1] === m.day;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: isToday ? `${T.gold}10` : T.ivory, borderRadius: 16, border: `1.5px solid ${isToday ? T.gold : T.linen}`, marginBottom: 8 }}>
              <div style={{ width: 44, textAlign: "center", flexShrink: 0 }}>
                <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color: isToday ? T.gold : T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>{m.day.slice(0, 3)}</p>
                {isToday && <p style={{ fontFamily: F.sans, fontSize: 9, color: T.gold, margin: "2px 0 0", fontWeight: 700 }}>TODAY</p>}
              </div>
              <p style={{ fontFamily: F.sans, fontSize: 14, color: T.esp, margin: 0, flex: 1 }}>{m.dinner}</p>
            </div>
          );
        }) : !generatingMeals && (
          <Card><p style={{ fontFamily: F.sans, fontSize: 14, color: T.taupe, textAlign: "center", padding: "20px 0", lineHeight: 1.6 }}>Cleo will plan 7 family dinners based on your kids, diet preferences, and budget.</p></Card>
        )}
      </>}

      {tab === "cleo" && <>
        <div style={{ background: `linear-gradient(135deg,${T.esp},#4a2e18)`, borderRadius: 20, padding: "20px", marginBottom: 16 }}>
          <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: "0 0 6px" }}>CLEO · FAMILY MODE</p>
          <p style={{ fontFamily: F.serif, fontSize: 16, fontStyle: "italic", color: "rgba(255,255,255,0.85)", margin: 0, lineHeight: 1.6 }}>
            Ask me anything about your family's week — prep, logistics, who needs what.
          </p>
        </div>

        {cleoResp && (
          <Card>
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ color: T.gold, flexShrink: 0, fontSize: 18 }}>✦</span>
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0, lineHeight: 1.7 }}>{cleoResp}</p>
            </div>
          </Card>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {[
            "What does the family need this week?",
            "Who needs attention right now?",
            "Help me prep for the weekend",
            "What am I forgetting?",
          ].map(q => (
            <button key={q} onClick={() => setCleoInput(q)} style={{ padding: "8px 14px", borderRadius: 20, border: `1px solid ${T.linen}`, background: T.ivory, fontFamily: F.sans, fontSize: 12, color: T.bark, cursor: "pointer", touchAction: "manipulation", minHeight: 36 }}>{q}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input value={cleoInput} onChange={e => setCleoInput(e.target.value)} onKeyDown={e => e.key === "Enter" && askCleo()} placeholder="Ask Cleo about your family..." style={{ flex: 1, background: T.ivory, border: `1.5px solid ${T.linen}`, borderRadius: 16, padding: "12px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", minHeight: 48 }} />
          <button onClick={askCleo} disabled={!cleoInput.trim() || cleoLoading} style={{ width: 48, height: 48, borderRadius: 16, background: cleoInput.trim() ? T.esp : T.linen, border: "none", color: "#fff", fontSize: 18, cursor: cleoInput.trim() ? "pointer" : "not-allowed", flexShrink: 0 }}>
            {cleoLoading ? <Spinner size={16} color="#fff" /> : "→"}
          </button>
        </div>
      </>}
    </div>
  );
}
