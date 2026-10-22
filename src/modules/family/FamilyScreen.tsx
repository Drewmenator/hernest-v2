// ─── Your family: the one people list ────────────────────────────
// Partner, kids, grandparents and close friends, each with birthday, gift
// ideas, school (kids) and an optional check-in reminder. Opened from the You
// menu. Chores and dinners now live in Plan; school dates are added in
// Plan → School. On first open, Circle and Profile people are copied in
// (ensurePeopleMerged) — the old data is never deleted.
import { useState, useEffect } from "react";
import { T, F, alpha } from "../../config/theme";
import { useStore, type FamilyMember } from "../../core/store";
import { Card, PageTitle, EmptyState, Emoji } from "../../shared/components";
import { bus } from "../../core/events";
import { saveData, loadData } from "../../core/firebase";
import { displayAge, daysUntilBirthday, todayLocal } from "../../core/dateAwareness";
import { ensurePeopleMerged } from "../../core/familyPeopleSync";
import { relationLabel, checkInDueIn, type Person, type CheckInEvery } from "../../core/familyPeople";
import { openCleo } from "../../shared/utils/openCleo";
import { PartnerInvite } from "./PartnerInvite";
import toast from "react-hot-toast";

const ROLE_ICONS: Record<string, string> = { partner: "💛", child: "⭐", parent: "🌿", inlaw: "🌸", other: "✦" };
const MEMBER_COLORS = [T.gold, T.sage, T.sky, T.blush, T.esp, "#9b7ec8", "#e07b54"];
const US_GRADES = ["Pre-K", "K", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"];

// The relation chips map onto the stored role (+ a finer label).
const RELATIONS: Array<{ id: string; label: string; role: FamilyMember["role"]; relation?: string }> = [
  { id: "partner", label: "Partner", role: "partner" },
  { id: "child", label: "Child", role: "child" },
  { id: "grandparent", label: "Grandparent", role: "parent", relation: "grandparent" },
  { id: "inlaw", label: "In-law", role: "inlaw" },
  { id: "sibling", label: "Sibling", role: "other", relation: "sibling" },
  { id: "friend", label: "Friend", role: "other", relation: "friend" },
  { id: "other", label: "Other", role: "other", relation: "other" },
];
const relationIdOf = (p: Person) =>
  p.role === "partner" ? "partner" : p.role === "child" ? "child" : p.role === "parent" ? "grandparent"
  : p.role === "inlaw" ? "inlaw" : (RELATIONS.find(r => r.relation === p.relation)?.id || "friend");

const CHECK_INS: Array<{ id: CheckInEvery | ""; label: string }> = [
  { id: "", label: "Off" }, { id: "weekly", label: "Weekly" }, { id: "biweekly", label: "Every 2 weeks" },
  { id: "monthly", label: "Monthly" }, { id: "quarterly", label: "Every 3 months" },
];

const GROUPS: Array<{ title: string; match: (p: Person) => boolean }> = [
  { title: "Partner & kids", match: p => p.role === "partner" || p.role === "child" },
  { title: "Grandparents & family", match: p => p.role === "parent" || p.role === "inlaw" || (p.role === "other" && p.relation !== "friend" && p.relation !== "colleague" && !!p.relation) },
  { title: "Close friends", match: p => p.role === "other" && (!p.relation || p.relation === "friend" || p.relation === "colleague") },
];

interface Draft {
  name: string; relationId: string; birthDate: string; age: string; notes: string;
  giftIdeas: string; checkIn: CheckInEvery | ""; schoolName: string; grade: string;
}
const EMPTY_DRAFT: Draft = { name: "", relationId: "child", birthDate: "", age: "", notes: "", giftIdeas: "", checkIn: "", schoolName: "", grade: "" };

const inputStyle = { width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "11px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 8, boxSizing: "border-box" as const };
const labelStyle = { display: "block", fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 4px 2px" };
const chip = (on: boolean, color: string = T.esp) => ({ padding: "6px 12px", borderRadius: 20, border: `1.5px solid ${on ? color : T.linen}`, background: on ? `${alpha(color, 0.08)}` : T.surface, color: on ? color : T.bark, fontFamily: F.sans, fontSize: 12, cursor: "pointer", minHeight: 32 });

export function FamilyScreen() {
  const { user, familyMembers, setFamilyMembers } = useStore();
  const people = familyMembers as Person[];
  const [editingId, setEditingId] = useState<string | null>(null);   // "new" for a new person
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const today = todayLocal();

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    (async () => {
      const merged = await ensurePeopleMerged(user.uid);
      const d = merged ? null : await loadData(user.uid, "family");
      const members = merged || (d?.members as Person[]) || [];
      if (alive) setFamilyMembers(members);
    })();
    return () => { alive = false; };
  }, [user?.uid, setFamilyMembers]);

  const persist = async (updated: Person[]) => {
    setFamilyMembers(updated);
    if (!user?.uid) return;
    await saveData(user.uid, "family", { members: JSON.parse(JSON.stringify(updated)) });
    await bus.publish("family.updated", { count: updated.length }, { userId: user.uid, source: "family" });
  };

  const startEdit = (p: Person | null) => {
    if (!p) { setEditingId("new"); setDraft(EMPTY_DRAFT); return; }
    setEditingId(p.id);
    setDraft({
      name: p.name, relationId: relationIdOf(p), birthDate: p.birthDate || "", age: p.age?.toString() || "",
      notes: p.notes || "", giftIdeas: p.giftIdeas || "", checkIn: p.checkIn || "",
      schoolName: p.schoolInfo?.schoolName || "", grade: p.schoolInfo?.grade || "",
    });
  };
  const closeEdit = () => { setEditingId(null); setDraft(EMPTY_DRAFT); };

  const savePerson = async () => {
    if (!draft.name.trim()) return;
    const rel = RELATIONS.find(r => r.id === draft.relationId) || RELATIONS[1];
    const base = editingId && editingId !== "new" ? people.find(p => p.id === editingId) : undefined;
    const isChild = rel.role === "child";
    const person: Person = {
      ...(base || { id: crypto.randomUUID(), color: MEMBER_COLORS[people.length % MEMBER_COLORS.length] }),
      name: draft.name.trim(),
      role: rel.role,
      relation: rel.relation,
      birthDate: draft.birthDate || undefined,
      // A year-less birthday from Circle stays unless a full date replaces it.
      birthday: draft.birthDate ? undefined : base?.birthday,
      age: !draft.birthDate && draft.age ? parseInt(draft.age, 10) : undefined,
      notes: draft.notes.trim() || undefined,
      giftIdeas: draft.giftIdeas.trim() || undefined,
      checkIn: draft.checkIn || undefined,
      schoolInfo: isChild && (draft.schoolName || draft.grade || base?.schoolInfo)
        ? { ...(base?.schoolInfo || { country: "US", schoolType: "public" }), schoolName: draft.schoolName || undefined, grade: draft.grade || undefined }
        : base?.schoolInfo,
    };
    const updated = base ? people.map(p => p.id === base.id ? person : p) : [...people, person];
    await persist(updated);
    toast.success(base ? "Saved" : `${person.name} added`);
    closeEdit();
  };

  const deletePerson = async (p: Person) => {
    if (!window.confirm(`Remove ${p.name} from your family list?`)) return;
    await persist(people.filter(m => m.id !== p.id));
    closeEdit();
  };

  const markTalked = async (p: Person) => {
    await persist(people.map(m => m.id === p.id ? { ...m, lastCheckIn: today } : m));
    toast.success(`Nice — checked in with ${p.name}`);
  };

  const askGiftIdeas = (p: Person) => {
    const age = displayAge(p);
    const bits = [
      `${p.name} (${relationLabel(p)}${age != null ? `, age ${age}` : ""})`,
      p.notes ? `Notes: ${p.notes}.` : "",
      p.giftIdeas ? `Ideas I already have: ${p.giftIdeas}.` : "",
    ].filter(Boolean).join(" ");
    openCleo(`Can you suggest 5 thoughtful gift ideas for ${bits} Include rough prices in dollars.`);
  };

  const bdayOf = (p: Person) => daysUntilBirthday(p.birthDate || p.birthday);
  const upcoming = people.filter(p => { const d = bdayOf(p); return d != null && d <= 30; })
    .sort((a, b) => (bdayOf(a) ?? 999) - (bdayOf(b) ?? 999));
  const checkInsDue = people.filter(p => { const d = checkInDueIn(p, today); return d != null && d <= 0; });

  const editor = (
    <Card>
      <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.taupe, margin: "0 0 12px" }}>
        {editingId === "new" ? "Add someone" : `EDIT ${draft.name.toUpperCase()}`}
      </p>
      <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Name" style={inputStyle} />
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {RELATIONS.map(r => (
          <button key={r.id} onClick={() => setDraft({ ...draft, relationId: r.id })} style={chip(draft.relationId === r.id, T.gold)}>{r.label}</button>
        ))}
      </div>
      <label style={labelStyle}>Birthday</label>
      <input value={draft.birthDate} onChange={e => setDraft({ ...draft, birthDate: e.target.value })} type="date" max={today} style={inputStyle} />
      {!draft.birthDate && draft.relationId === "child" && (
        <input value={draft.age} onChange={e => setDraft({ ...draft, age: e.target.value })} placeholder="Age (if you'd rather not add a birthday)" type="number" style={inputStyle} />
      )}
      {draft.relationId === "child" && (
        <>
          <label style={labelStyle}>School</label>
          <input value={draft.schoolName} onChange={e => setDraft({ ...draft, schoolName: e.target.value })} placeholder="School name (optional)" style={inputStyle} />
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
            {US_GRADES.map(g => (
              <button key={g} onClick={() => setDraft({ ...draft, grade: draft.grade === g ? "" : g })} style={{ ...chip(draft.grade === g, T.sky), padding: "4px 9px", fontSize: 12, minHeight: 28 }}>{g}</button>
            ))}
          </div>
          <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 10px 2px", lineHeight: 1.5 }}>
            School dates and newsletters go in Plan → School.
          </p>
        </>
      )}
      <input value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="Notes, e.g. nut allergy, soccer Tuesdays" style={inputStyle} />
      <label style={labelStyle}>Gift ideas</label>
      <textarea value={draft.giftIdeas} onChange={e => setDraft({ ...draft, giftIdeas: e.target.value })} placeholder="Jot ideas down as you think of them" rows={2} style={{ ...inputStyle, resize: "vertical", fontFamily: F.sans }} />
      {draft.relationId !== "child" && draft.relationId !== "partner" && (
        <>
          <label style={labelStyle}>Remind me to check in</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {CHECK_INS.map(c => (
              <button key={c.id || "off"} onClick={() => setDraft({ ...draft, checkIn: c.id })} style={chip(draft.checkIn === c.id, T.sage)}>{c.label}</button>
            ))}
          </div>
        </>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={savePerson} disabled={!draft.name.trim()} style={{ flex: 1, padding: "12px", background: draft.name.trim() ? T.esp : T.linen, color: T.onAction, border: "none", borderRadius: 12, fontFamily: F.sans, fontSize: 14, fontWeight: 600, cursor: draft.name.trim() ? "pointer" : "not-allowed", minHeight: 48 }}>
          {editingId === "new" ? "Add" : "Save"}
        </button>
        <button onClick={closeEdit} style={{ padding: "12px 20px", background: "none", border: `1px solid ${T.linen}`, borderRadius: 12, fontFamily: F.sans, fontSize: 14, color: T.taupe, cursor: "pointer", minHeight: 48 }}>Cancel</button>
      </div>
      {editingId !== "new" && (() => {
        const p = people.find(m => m.id === editingId);
        return p ? (
          <button onClick={() => deletePerson(p)} style={{ width: "100%", marginTop: 10, background: "none", border: "none", fontFamily: F.sans, fontSize: 12, color: T.taupe, cursor: "pointer", minHeight: 36 }}>Remove {p.name}</button>
        ) : null;
      })()}
    </Card>
  );

  const row = (p: Person) => {
    if (editingId === p.id) return <div key={p.id}>{editor}</div>;
    const age = displayAge(p);
    const bday = bdayOf(p);
    const schoolBits = p.role === "child" ? [p.schoolInfo?.grade, p.schoolInfo?.schoolName].filter(Boolean).join(" · ") : "";
    const details = [relationLabel(p), age != null ? `age ${age}` : "", bday != null && bday <= 30 ? `Birthday in ${bday}d` : "", schoolBits].filter(Boolean).join(" · ");
    return (
      <div key={p.id} style={{ padding: "14px 16px", background: T.ivory, borderRadius: 16, border: `1.5px solid ${T.linen}`, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: `${alpha(p.color, 0.15)}`, border: `2px solid ${alpha(p.color, 0.25)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
            <Emoji e={p.emoji || ROLE_ICONS[p.role] || "✦"} size={22} color={p.color} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 700, color: T.esp, margin: 0 }}>{p.name}</p>
            <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "2px 0 0" }}>{details}</p>
            {p.notes && <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "2px 0 0", fontStyle: "italic" }}>{p.notes}</p>}
          </div>
          <button onClick={() => startEdit(p)} style={{ background: "none", border: `1px solid ${T.linen}`, borderRadius: 8, padding: "5px 10px", fontFamily: F.sans, fontSize: 12, color: T.taupe, cursor: "pointer", minHeight: 30 }}>Edit</button>
        </div>
        {(p.giftIdeas || (bday != null && bday <= 30)) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingLeft: 56 }}>
            {p.giftIdeas && <p style={{ flex: 1, fontFamily: F.sans, fontSize: 12, color: T.bark, margin: 0 }}><Emoji e="🎁" /> {p.giftIdeas}</p>}
            <button onClick={() => askGiftIdeas(p)} style={{ marginLeft: "auto", background: T.goldP, border: `1px solid ${alpha(T.gold, 0.25)}`, borderRadius: 8, padding: "5px 10px", fontFamily: F.sans, fontSize: 12, color: T.gold, cursor: "pointer", minHeight: 30, flexShrink: 0 }}><Emoji e="✦" size={14} /> Gift ideas</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle eyebrow="YOU" title="Your family" />

      {upcoming.length > 0 && (
        <div style={{ background: `linear-gradient(135deg,${alpha(T.blush, 0.08)},${alpha(T.gold, 0.06)})`, border: `1px solid ${alpha(T.blush, 0.19)}`, borderRadius: 16, padding: "12px 16px", marginBottom: 12 }}>
          <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.blush, margin: "0 0 8px" }}><Emoji e="🎂" /> Coming up</p>
          {upcoming.map(p => {
            const d = bdayOf(p);
            return (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0 }}>{p.name}</p>
                <span style={{ fontFamily: F.sans, fontSize: 12, color: T.blush, fontWeight: 600 }}>{d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`}</span>
              </div>
            );
          })}
        </div>
      )}

      {checkInsDue.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.taupe, margin: "0 0 8px" }}>Time to check in</p>
          {checkInsDue.map(p => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: T.ivory, borderRadius: 14, border: `1.5px solid ${alpha(T.sage, 0.19)}`, marginBottom: 6 }}>
              <p style={{ flex: 1, fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0 }}>
                {p.name} <span style={{ color: T.taupe, fontSize: 12 }}>· {p.lastCheckIn ? `last ${p.lastCheckIn.slice(5).replace("-", "/")}` : "no check-in yet"}</span>
              </p>
              <button onClick={() => markTalked(p)} style={{ background: T.sage, color: T.onAction, border: "none", borderRadius: 8, padding: "6px 12px", fontFamily: F.sans, fontSize: 12, cursor: "pointer", minHeight: 32 }}><Emoji e="✓" size={14} /> Talked</button>
            </div>
          ))}
        </div>
      )}

      {people.length === 0 && editingId !== "new" && (
        <EmptyState
          icon={<Emoji e="👫" size={26} />}
          title="Who's in your nest?"
          body="Add your partner, kids, grandparents and close friends. HerNest remembers birthdays, gift ideas and school details for you."
          actionLabel="Add your first person"
          onAction={() => startEdit(null)}
        />
      )}

      {GROUPS.map(g => {
        const list = people.filter(g.match);
        if (!list.length) return null;
        return (
          <div key={g.title} style={{ marginBottom: 14 }}>
            <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.taupe, margin: "0 0 8px" }}>{g.title}</p>
            {list.map(row)}
          </div>
        );
      })}

      {editingId === "new" ? editor : (
        <button onClick={() => startEdit(null)} style={{ width: "100%", padding: "14px", background: T.ivory, border: `1.5px dashed ${T.linen}`, borderRadius: 16, fontFamily: F.sans, fontSize: 14, color: T.taupe, cursor: "pointer", marginTop: 4, minHeight: 52 }}>
          + Add someone
        </button>
      )}

      <PartnerInvite />

      {people.length > 0 && (
        <button onClick={() => openCleo("Looking at my family this week, what should I be thinking about or preparing for?")}
          style={{ width: "100%", marginTop: 12, padding: "12px", background: "none", border: `1px solid ${T.linen}`, borderRadius: 14, fontFamily: F.sans, fontSize: 13, color: T.esp, cursor: "pointer", minHeight: 44 }}>
          <Emoji e="✦" size={14} /> Ask Cleo about your family
        </button>
      )}
    </div>
  );
}
