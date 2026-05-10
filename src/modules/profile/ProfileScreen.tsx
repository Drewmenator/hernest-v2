import React, { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, HeroCard, Button, Input } from "../../shared/components";
import { saveData, loadData } from "../../core/firebase";
import { signOut } from "firebase/auth";
import { auth } from "../../core/firebase";
import { bus } from "../../core/events";
import toast from "react-hot-toast";

// ── Memory Facts ───────────────────────────────────────────────────
interface MemoryFact {
  id: string;
  statement: string;
  type: "family" | "health" | "preference" | "goal" | "schedule" | "temporary";
  source: "user-stated" | "conversation" | "inferred";
  confidence: number;
  createdAt: number;
  expiresAt?: number;
}

const FACT_TYPES = [
  { id: "family",     label: "Family",     emoji: "👨‍👩‍👧", color: T.gold },
  { id: "health",     label: "Health",     emoji: "💊", color: T.blush },
  { id: "preference", label: "Preference", emoji: "✨", color: T.lav },
  { id: "goal",       label: "Goal",       emoji: "🎯", color: T.teal },
  { id: "schedule",   label: "Schedule",   emoji: "📅", color: T.sky },
  { id: "temporary",  label: "Temporary",  emoji: "⏳", color: T.taupe },
];

const PRIORITIES = ["Family", "Career", "Fitness", "Travel", "Finances", "Self-care", "Relationships", "Creativity"];
const ENERGY_PATTERNS = ["morning", "evening", "variable"] as const;
const SECTIONS = ["personal", "family", "style", "health", "memory"] as const;

export function ProfileScreen() {
  const { user, profile, updateProfile, reset } = useStore();
  const [activeSection, setActiveSection] = useState<string>("personal");
  const [saving, setSaving] = useState(false);
  const [memories, setMemories] = useState<MemoryFact[]>([]);
  const [newFact, setNewFact] = useState("");
  const [factType, setFactType] = useState<MemoryFact["type"]>("preference");

  // Local edit state
  const [name, setName]       = useState(profile?.name || "");
  const [city, setCity]       = useState(profile?.city || "");
  const [role, setRole]       = useState(profile?.role || "");
  const [challenge, setChallenge] = useState(profile?.challenge || "");
  const [tripGoal, setTripGoal]   = useState(profile?.tripGoal || "");
  const [fitnessGoal, setFitnessGoal] = useState(profile?.fitnessGoal || "");
  const [diet, setDiet]       = useState(profile?.diet || "");
  const [energyPattern, setEnergyPattern] = useState<typeof ENERGY_PATTERNS[number]>(profile?.energyPattern || "morning");
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>(profile?.priorities || []);
  const [kids, setKids]       = useState<any[]>(profile?.kids || []);
  const [partner, setPartner] = useState(profile?.partner || "");

  useEffect(() => {
    if (!user?.uid) return;
    // Load profile
    loadData(user.uid, "profile").then(d => {
      if (!d) return;
      const p = d as any;
      setName(p.name || ""); setCity(p.city || ""); setRole(p.role || "");
      setChallenge(p.challenge || ""); setTripGoal(p.tripGoal || "");
      setFitnessGoal(p.fitnessGoal || ""); setDiet(p.diet || "");
      setEnergyPattern(p.energyPattern || "morning");
      setSelectedPriorities(p.priorities || []);
      setKids(p.kids || []); setPartner(p.partner || "");
    });
    // Load memory facts
    loadData(user.uid, "nora_memory").then(d => {
      if (d?.facts) setMemories(d.facts as MemoryFact[]);
    });
  }, [user?.uid]);

  const save = async () => {
    setSaving(true);
    const updated = {
      ...profile,
      uid: user?.uid || "",
      email: user?.email || "",
      name, city, role, challenge, tripGoal, fitnessGoal,
      diet, energyPattern, priorities: selectedPriorities,
      kids, partner,
    };
    updateProfile(updated as any);
    if (user?.uid) {
      await saveData(user.uid, "profile", updated);
      await bus.publish("profile.updated", updated, { userId: user.uid, source: "profile" });
    }
    setSaving(false);
    toast.success("Profile saved ✓");
  };

  const addFact = async () => {
    if (!newFact.trim()) return;
    const fact: MemoryFact = {
      id: crypto.randomUUID(),
      statement: newFact.trim(),
      type: factType,
      source: "user-stated",
      confidence: 1.0,
      createdAt: Date.now(),
    };
    const updated = [fact, ...memories];
    setMemories(updated);
    setNewFact("");
    if (user?.uid) {
      await saveData(user.uid, "nora_memory", { facts: updated });
      await bus.publish("nora.memory.updated", { fact }, { userId: user.uid, source: "profile" });
    }
    toast.success("Nora will remember that ✦");
  };

  const deleteFact = async (id: string) => {
    const updated = memories.filter(f => f.id !== id);
    setMemories(updated);
    if (user?.uid) await saveData(user.uid, "nora_memory", { facts: updated });
  };

  const handleSignOut = async () => {
    await signOut(auth);
    reset();
  };

  const togglePriority = (p: string) => {
    setSelectedPriorities(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p].slice(0, 5)
    );
  };

  const addKid = () => {
    setKids(prev => [...prev, { id: crypto.randomUUID(), name: "", age: 0, school: "" }]);
  };

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle eyebrow="YOUR ACCOUNT" title="Profile" />

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 16 }}>
        {SECTIONS.map(s => (
          <button key={s} onClick={() => setActiveSection(s)} style={{
            padding: "7px 14px", borderRadius: 20, border: `1.5px solid ${activeSection === s ? T.esp : T.linen}`,
            background: activeSection === s ? T.esp : "#fff", color: activeSection === s ? "#fff" : T.bark,
            fontFamily: F.sans, fontSize: 12, fontWeight: activeSection === s ? 700 : 400,
            cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Personal */}
      {activeSection === "personal" && (
        <>
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: `linear-gradient(135deg, ${T.gold}, #8B6914)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>
                {profile?.avatar || "👩"}
              </div>
              <div>
                <h2 style={{ fontFamily: F.serif, fontSize: 22, fontStyle: "italic", color: T.esp, margin: 0 }}>{name || "Your name"}</h2>
                <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "2px 0 0" }}>{user?.email}</p>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Input value={name} onChange={setName} placeholder="Your first name" />
              <Input value={city} onChange={setCity} placeholder="City you live in" />
              <Input value={role} onChange={setRole} placeholder="Your role / job title" />
              <Input value={challenge} onChange={setChallenge} placeholder="Biggest challenge right now" />
            </div>
          </Card>
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>YOUR PRIORITIES (pick up to 5)</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PRIORITIES.map(p => (
                <button key={p} onClick={() => togglePriority(p)} style={{
                  padding: "7px 14px", borderRadius: 20,
                  border: `1.5px solid ${selectedPriorities.includes(p) ? T.gold : T.linen}`,
                  background: selectedPriorities.includes(p) ? T.goldP : "#fff",
                  color: selectedPriorities.includes(p) ? T.gold : T.bark,
                  fontFamily: F.sans, fontSize: 12, cursor: "pointer",
                  fontWeight: selectedPriorities.includes(p) ? 700 : 400,
                }}>
                  {p}
                </button>
              ))}
            </div>
          </Card>
          <Button onClick={save} variant="gold" disabled={saving}>{saving ? "Saving..." : "Save Profile"}</Button>
        </>
      )}

      {/* Family */}
      {activeSection === "family" && (
        <>
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>PARTNER</p>
            <Input value={partner} onChange={setPartner} placeholder="Partner's name (optional)" />
          </Card>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: 0 }}>CHILDREN</p>
              <button onClick={addKid} style={{ background: T.goldP, border: `1px solid ${T.gold}40`, borderRadius: 10, padding: "5px 12px", fontFamily: F.sans, fontSize: 11, color: T.gold, cursor: "pointer" }}>+ Add</button>
            </div>
            {kids.map((k, i) => (
              <div key={k.id} style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
                <span style={{ fontSize: 20 }}>👧</span>
                <input value={k.name} onChange={e => setKids(prev => prev.map((c, ci) => ci === i ? { ...c, name: e.target.value } : c))} placeholder="Name" style={{ flex: 2, background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "8px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }} />
                <input value={k.age || ""} onChange={e => setKids(prev => prev.map((c, ci) => ci === i ? { ...c, age: parseInt(e.target.value) || 0 } : c))} placeholder="Age" type="number" style={{ flex: 1, background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "8px 12px", fontFamily: F.sans, fontSize: 13, color: T.esp, outline: "none" }} />
                <button onClick={() => setKids(prev => prev.filter((_, ci) => ci !== i))} style={{ background: "none", border: "none", color: T.taupe, cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
            ))}
          </Card>
          <Button onClick={save} variant="gold" disabled={saving}>{saving ? "Saving..." : "Save Family"}</Button>
        </>
      )}

      {/* Health */}
      {activeSection === "health" && (
        <>
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>ENERGY PATTERN</p>
            <div style={{ display: "flex", gap: 8 }}>
              {ENERGY_PATTERNS.map(e => (
                <button key={e} onClick={() => setEnergyPattern(e)} style={{
                  flex: 1, padding: "10px", borderRadius: 12,
                  border: `1.5px solid ${energyPattern === e ? T.sky : T.linen}`,
                  background: energyPattern === e ? T.skyP : "#fff",
                  color: energyPattern === e ? T.sky : T.bark,
                  fontFamily: F.sans, fontSize: 12, cursor: "pointer",
                  fontWeight: energyPattern === e ? 700 : 400,
                }}>
                  {e === "morning" ? "🌅 Morning" : e === "evening" ? "🌙 Evening" : "〰 Variable"}
                </button>
              ))}
            </div>
          </Card>
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>DIET & FITNESS</p>
            <Input value={diet} onChange={setDiet} placeholder="Dietary preferences (e.g. vegetarian, gluten-free)" style={{ marginBottom: 10 }} />
            <Input value={fitnessGoal} onChange={setFitnessGoal} placeholder="Fitness goal (e.g. run 5k, yoga daily)" style={{ marginBottom: 10 }} />
            <Input value={tripGoal} onChange={setTripGoal} placeholder="Next trip goal (e.g. Bali in December)" />
          </Card>
          <Button onClick={save} variant="gold" disabled={saving}>{saving ? "Saving..." : "Save Health"}</Button>
        </>
      )}

      {/* Nora's Memory */}
      {activeSection === "memory" && (
        <>
          <HeroCard eyebrow="NORA'S BRAIN" title="What Nora knows about you" subtitle="Add facts, edit, or delete anything" color={T.esp} />
          <Card>
            <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>ADD A FACT</p>
            <Input value={newFact} onChange={setNewFact} placeholder="e.g. Maya is allergic to nuts" style={{ marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {FACT_TYPES.map(t => (
                <button key={t.id} onClick={() => setFactType(t.id as any)} style={{
                  padding: "5px 12px", borderRadius: 20,
                  border: `1.5px solid ${factType === t.id ? t.color : T.linen}`,
                  background: factType === t.id ? `${t.color}15` : "#fff",
                  color: factType === t.id ? t.color : T.bark,
                  fontFamily: F.sans, fontSize: 11, cursor: "pointer",
                }}>
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
            <Button onClick={addFact} disabled={!newFact.trim()} variant="secondary">Tell Nora ✦</Button>
          </Card>
          {memories.length > 0 && (
            <Card>
              <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 12px" }}>NORA KNOWS ({memories.length})</p>
              {memories.map(f => {
                const meta = FACT_TYPES.find(t => t.id === f.type);
                return (
                  <div key={f.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.linen}` }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{meta?.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0 }}>{f.statement}</p>
                      <p style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe, margin: "2px 0 0", textTransform: "uppercase", letterSpacing: "0.08em" }}>{f.source} · {meta?.label}</p>
                    </div>
                    <button onClick={() => deleteFact(f.id)} style={{ background: "none", border: "none", color: T.taupe, cursor: "pointer", fontSize: 16, flexShrink: 0 }}>×</button>
                  </div>
                );
              })}
            </Card>
          )}
          {memories.length === 0 && (
            <Card>
              <p style={{ fontFamily: F.sans, fontSize: 14, color: T.taupe, textAlign: "center", padding: "20px 0", lineHeight: 1.6 }}>
                Nora's memory is empty.<br />Chat with Nora or add facts above to help her know you better.
              </p>
            </Card>
          )}
        </>
      )}

      {/* Style section placeholder */}
      {activeSection === "style" && (
        <Card>
          <p style={{ fontFamily: F.sans, fontSize: 14, color: T.taupe, textAlign: "center", padding: "20px 0" }}>Style profile coming — this helps Nora give better outfit recommendations</p>
        </Card>
      )}

      {/* Sign out */}
      <button onClick={handleSignOut} style={{ width: "100%", padding: "12px", background: "none", border: `1px solid ${T.linen}`, borderRadius: 14, fontFamily: F.sans, fontSize: 13, color: T.taupe, cursor: "pointer", marginTop: 8 }}>
        Sign out
      </button>
    </div>
  );
}
