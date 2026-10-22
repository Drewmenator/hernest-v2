// ─── Your family: the one people list ────────────────────────────
// Partner, kids, grandparents and close friends, each with birthday, gift
// ideas, school (kids) and an optional check-in reminder. Opened from the You
// menu. Chores and dinners now live in Plan; school dates are added in
// Plan → School. On first open, Circle and Profile people are copied in
// (ensurePeopleMerged) — the old data is never deleted.
import { useState, useEffect } from "react";
import { T, F, TYPE, S, R, alpha, ATMOS_TEXT2 } from "../../config/theme";
import { useStore, type FamilyMember } from "../../core/store";
import { Card, PageTitle, SectionHeader, ListRow, TextButton, Button, Pill, Input, EmptyState, GlowCard, Headline, Detail, Emoji } from "../../shared/components";
import { Plus } from "lucide-react";
import { bus } from "../../core/events";
import { saveData, loadData } from "../../core/firebase";
import { displayAge, daysUntilBirthday, todayLocal } from "../../core/dateAwareness";
import { ensurePeopleMerged } from "../../core/familyPeopleSync";
import { relationLabel, checkInDueIn, type Person, type CheckInEvery } from "../../core/familyPeople";
import { openCleo } from "../../shared/utils/openCleo";
import { PartnerInvite } from "./PartnerInvite";
import toast from "react-hot-toast";

const ROLE_ICONS: Record<string, string> = { partner: "💛", child: "⭐", parent: "🌿", inlaw: "🌸", other: "✦" };
const MEMBER_COLORS = [T.gold, T.sage, T.sky, T.blush, T.esp, T.lav, T.orange];
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

const fieldLabel = { display: "block", fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text, margin: "0 0 6px" } as const;
const fieldBox = { width: "100%", background: T.surface, border: `1.5px solid ${T.divider}`, borderRadius: R.button, padding: "12px 14px", fontFamily: F.sans, fontSize: 16, color: T.text, outline: "none", boxSizing: "border-box" } as const;
const group = { marginBottom: S.lg } as const;
const pillRow = { display: "flex", gap: 6, flexWrap: "wrap" } as const;

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
    toast.success(`Nice, checked in with ${p.name}`);
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

  const editor = (bare: boolean) => {
    const body = (
      <>
        <h3 style={{ fontFamily: F.sans, fontSize: TYPE.card, fontWeight: 600, color: T.text, margin: `0 0 ${S.md}px` }}>
          {editingId === "new" ? "Add someone" : `Edit ${draft.name || "person"}`}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: S.md }}>
          <Input label="Name" value={draft.name} onChange={v => setDraft({ ...draft, name: v })} placeholder="Name" />
          <div>
            <p style={fieldLabel}>Relation</p>
            <div style={pillRow}>
              {RELATIONS.map(r => (
                <Pill key={r.id} label={r.label} active={draft.relationId === r.id} onClick={() => setDraft({ ...draft, relationId: r.id })} />
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="family-birthday" style={fieldLabel}>Birthday</label>
            <input id="family-birthday" value={draft.birthDate} onChange={e => setDraft({ ...draft, birthDate: e.target.value })} type="date" max={today} style={{ ...fieldBox, minHeight: 48 }} />
          </div>
          {!draft.birthDate && draft.relationId === "child" && (
            <Input label="Age" value={draft.age} onChange={v => setDraft({ ...draft, age: v })} placeholder="Age (if you'd rather not add a birthday)" type="number" />
          )}
          {draft.relationId === "child" && (
            <>
              <Input label="School" value={draft.schoolName} onChange={v => setDraft({ ...draft, schoolName: v })} placeholder="School name (optional)" />
              <div>
                <p style={fieldLabel}>Grade</p>
                <div style={pillRow}>
                  {US_GRADES.map(g => (
                    <Pill key={g} label={g} active={draft.grade === g} onClick={() => setDraft({ ...draft, grade: draft.grade === g ? "" : g })} />
                  ))}
                </div>
                <p style={{ fontFamily: F.sans, fontSize: TYPE.meta, color: T.text2, margin: "8px 0 0", lineHeight: 1.5 }}>
                  Upload school calendars and newsletters in Plan, School.
                </p>
              </div>
            </>
          )}
          <Input label="Notes" value={draft.notes} onChange={v => setDraft({ ...draft, notes: v })} placeholder="Notes, e.g. nut allergy, soccer Tuesdays" />
          <div>
            <label htmlFor="family-gifts" style={fieldLabel}>Gift ideas</label>
            <textarea id="family-gifts" value={draft.giftIdeas} onChange={e => setDraft({ ...draft, giftIdeas: e.target.value })} placeholder="Jot ideas down as you think of them" rows={2} style={{ ...fieldBox, resize: "vertical" }} />
          </div>
          {draft.relationId !== "child" && draft.relationId !== "partner" && (
            <div>
              <p style={fieldLabel}>Remind me to check in</p>
              <div style={pillRow}>
                {CHECK_INS.map(c => (
                  <Pill key={c.id || "off"} label={c.label} active={draft.checkIn === c.id} onClick={() => setDraft({ ...draft, checkIn: c.id })} />
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: S.sm }}>
            <Button onClick={savePerson} disabled={!draft.name.trim()} style={{ flex: 1 }}>{editingId === "new" ? "Add" : "Save"}</Button>
            <Button onClick={closeEdit} variant="secondary" style={{ flex: "none", width: "auto" }}>Cancel</Button>
          </div>
          {editingId !== "new" && (() => {
            const p = people.find(m => m.id === editingId);
            return p ? (
              <TextButton onClick={() => deletePerson(p)} color={T.text2} style={{ justifyContent: "center" }}>Remove {p.name}</TextButton>
            ) : null;
          })()}
        </div>
      </>
    );
    return bare
      ? <div key="editor" style={{ background: T.sand, borderRadius: R.card - 4, padding: S.lg, margin: `${S.sm}px 0` }}>{body}</div>
      : <Card>{body}</Card>;
  };

  const row = (p: Person, first: boolean) => {
    if (editingId === p.id) return editor(true);
    const age = displayAge(p);
    const bday = bdayOf(p);
    const schoolBits = p.role === "child" ? [p.schoolInfo?.grade, p.schoolInfo?.schoolName].filter(Boolean).join(" · ") : "";
    const details = [relationLabel(p), age != null ? `age ${age}` : "", bday != null && bday <= 30 ? `Birthday in ${bday}d` : "", schoolBits].filter(Boolean).join(" · ");
    const hasGift = !!p.giftIdeas || (bday != null && bday <= 30);
    return (
      <ListRow
        key={p.id}
        divider={!first}
        leading={
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: alpha(p.color, 0.15), border: `2px solid ${alpha(p.color, 0.25)}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Emoji e={p.emoji || ROLE_ICONS[p.role] || "✦"} size={22} color={p.color} />
          </div>
        }
        title={p.name}
        detail={<>{details}{p.notes && <span style={{ display: "block", fontStyle: "italic" }}>{p.notes}</span>}</>}
        trailing={<TextButton onClick={() => startEdit(p)}>Edit</TextButton>}
        actions={hasGift ? (
          <>
            {p.giftIdeas && <span style={{ flex: 1, minWidth: 0, alignSelf: "center", fontFamily: F.sans, fontSize: TYPE.support, color: T.text2 }}><Emoji e="🎁" /> {p.giftIdeas}</span>}
            <Button size="sm" variant="gentle" onClick={() => askGiftIdeas(p)} style={{ width: "auto", marginLeft: "auto" }}><Emoji e="✦" size={14} /> Gift ideas</Button>
          </>
        ) : undefined}
      />
    );
  };

  const when = (d: number | null) => d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
  const soonest = upcoming[0];
  const soonestAge = soonest ? displayAge(soonest) : null;
  const soonestD = soonest ? bdayOf(soonest) : null;
  const headline = soonest
    ? soonestAge != null
      ? `${soonest.name} turns ${soonestD === 0 ? soonestAge : soonestAge + 1} ${when(soonestD)}`
      : `${soonest.name}'s birthday is ${when(soonestD)}`
    : "";

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle title="Your family" />

      {upcoming.length > 0 && (
        <GlowCard tint="personal" eyebrow={<><Emoji e="🎂" size={16} /> Coming up</>}>
          <Headline>{headline}</Headline>
          {upcoming.length > 1 && (
            <div style={{ marginTop: S.md }}>
              {upcoming.slice(1).map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: S.md, padding: "6px 0", fontFamily: F.sans, fontSize: TYPE.support }}>
                  <span style={{ color: T.text, fontWeight: 600 }}>{p.name}</span>
                  <span style={{ color: ATMOS_TEXT2 }}>{when(bdayOf(p))}</span>
                </div>
              ))}
            </div>
          )}
          {upcoming.length === 1 && <Detail>Worth a card or a small gift.</Detail>}
        </GlowCard>
      )}

      {checkInsDue.length > 0 && (
        <>
          <SectionHeader title="Time to check in" style={{ marginTop: S.md }} />
          <Card>
            {checkInsDue.map((p, i) => (
              <ListRow
                key={p.id}
                divider={i > 0}
                leading={<Emoji e={p.emoji || ROLE_ICONS[p.role] || "✦"} tile />}
                title={p.name}
                detail={p.lastCheckIn ? `Last ${p.lastCheckIn.slice(5).replace("-", "/")}` : "No check-in yet"}
                trailing={<Button size="sm" variant="completed" onClick={() => markTalked(p)} style={{ width: "auto" }}>Talked</Button>}
              />
            ))}
          </Card>
        </>
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
          <div key={g.title} style={group}>
            <SectionHeader title={g.title} style={{ marginTop: S.md }} />
            <Card>{list.map((p, i) => row(p, i === 0))}</Card>
          </div>
        );
      })}

      {editingId === "new" ? editor(false) : (
        <Button variant="secondary" onClick={() => startEdit(null)} style={{ marginTop: S.xs }}><Plus size={18} strokeWidth={2} aria-hidden="true" /> Add someone</Button>
      )}

      <PartnerInvite />

      {people.length > 0 && (
        <Button variant="gentle" onClick={() => openCleo("Looking at my family this week, what should I be thinking about or preparing for?")} style={{ marginTop: S.md }}>
          <Emoji e="✦" size={16} /> Ask Cleo about your family
        </Button>
      )}
    </div>
  );
}
