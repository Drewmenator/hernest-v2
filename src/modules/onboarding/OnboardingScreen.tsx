import React, { useState } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { saveData } from "../../core/firebase";

const STEPS = [
  { id: "name",      title: "Welcome to HerNest",         question: "First, what's your name?",                     placeholder: "Your first name",          type: "text" },
  { id: "income",    title: "Your household finances",     question: "What's your combined monthly household income?", placeholder: "e.g. 8500",               type: "number", hint: "Approximate is fine — you can update this anytime." },
  { id: "budgetGoal",title: "Your biggest money goal",     question: "What's your top financial goal right now?",     placeholder: "e.g. Build emergency fund, pay off car loan, save for holiday", type: "text" },
  { id: "debt",      title: "Existing debt",               question: "Roughly how much total debt do you have? (optional)", placeholder: "e.g. 12000 — or skip", type: "number", optional: true, hint: "Credit cards, loans, mortgage excluded. Skip if not applicable." },
  { id: "challenge", title: "What weighs on you most?",    question: "What's your biggest mental load right now?",    placeholder: "e.g. Juggling work, school pickup and feeling behind on everything", type: "text" },
];

export function OnboardingScreen() {
  const { user, setScreen, setProfile } = useStore();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const current = STEPS[step];
  const value = values[current.id] || "";

  const next = async () => {
    if (!value.trim() && !current.optional) return;
    const updated = { ...values, [current.id]: value };
    setValues(updated);

    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
      return;
    }

    // Complete onboarding — save profile + initial budget data
    setLoading(true);
    const profile = {
      uid:           user?.uid || "",
      name:          updated.name || "",
      email:         user?.email || "",
      avatar:        "👩",
      city: "", role: "",
      kids: [], parents: [], inlaws: [],
      priorities: [],
      tripGoal: "", fitnessGoal: "",
      savingsGoal:   updated.budgetGoal || "",
      challenge:     updated.challenge || "",
      soloParent:    false,
      energyPattern: "morning" as const,
      diet:          "",
      onboardedAt:   Date.now(),
    };

    const monthlyIncome = parseFloat(updated.income || "0");
    const totalDebt = parseFloat(updated.debt || "0");

    // Seed initial budget with income
    const budgetSeed = {
      incomes: monthlyIncome > 0 ? [{
        id: "primary",
        label: "Monthly Income",
        amount: monthlyIncome,
        frequency: "monthly",
      }] : [],
      debts: totalDebt > 0 ? [{
        id: "total_debt",
        label: "Total Debt",
        balance: totalDebt,
        minimumPayment: Math.round(totalDebt * 0.02),
        apr: 0,
      }] : [],
      goals: updated.budgetGoal ? [{
        id: "primary_goal",
        name: updated.budgetGoal,
        targetAmount: 0,
        currentAmount: 0,
        priority: "high",
        riskStatus: "on_track",
      }] : [],
      categories: [],
      onboardedAt: Date.now(),
    };

    setProfile(profile);
    if (user?.uid) {
      await saveData(user.uid, "profile", profile);
      if (monthlyIncome > 0 || totalDebt > 0) {
        await saveData(user.uid, "budget_v2", budgetSeed);
      }
    }
    setScreen("app");
  };

  const skip = () => {
    setStep(s => s + 1);
  };

  return (
    <div style={{ minHeight: "100vh", background: T.cream, display: "flex", flexDirection: "column", padding: "60px 24px 40px" }}>
      {/* Progress */}
      <div style={{ display: "flex", gap: 6, marginBottom: 48 }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 99, background: i <= step ? T.gold : T.linen, transition: "background .3s" }} />
        ))}
      </div>

      {/* Step label */}
      <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.gold, margin: "0 0 12px" }}>
        {current.title}
      </p>

      {/* Question */}
      <h2 style={{ fontFamily: F.serif, fontSize: 28, fontStyle: "italic", color: T.esp, margin: "0 0 8px", lineHeight: 1.3, fontWeight: 500 }}>
        {current.question}
      </h2>

      {current.hint && (
        <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 24px", lineHeight: 1.6 }}>{current.hint}</p>
      )}

      {!current.hint && <div style={{ height: 24 }} />}

      {/* Input */}
      <input
        type={current.type === "number" ? "number" : "text"}
        value={value}
        onChange={e => setValues(v => ({ ...v, [current.id]: e.target.value }))}
        onKeyDown={e => e.key === "Enter" && next()}
        placeholder={current.placeholder}
        autoFocus
        style={{
          width: "100%", background: "#fff", border: `1.5px solid ${T.linen}`,
          borderRadius: 16, padding: "16px 18px", fontFamily: F.sans, fontSize: 16,
          color: T.esp, outline: "none", boxSizing: "border-box" as any,
          boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
        }}
      />

      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, marginTop: 32 }}>
        {current.optional && (
          <button onClick={skip}
            style={{ flex: 1, padding: "16px", background: "none", border: `1.5px solid ${T.linen}`, borderRadius: 16, fontFamily: F.sans, fontSize: 15, color: T.taupe, cursor: "pointer" }}>
            Skip
          </button>
        )}
        <button onClick={next} disabled={(!value.trim() && !current.optional) || loading}
          style={{
            flex: 2, padding: "16px", background: (value.trim() || current.optional) && !loading ? T.esp : T.linen,
            color: "#fff", border: "none", borderRadius: 16, fontFamily: F.sans, fontSize: 15,
            fontWeight: 600, cursor: (value.trim() || current.optional) && !loading ? "pointer" : "not-allowed",
            transition: "background .2s",
          }}>
          {loading ? "Setting up your household..." : step === STEPS.length - 1 ? "Let's go ✦" : "Continue →"}
        </button>
      </div>

      {/* Step counter */}
      <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, textAlign: "center", marginTop: 16 }}>
        {step + 1} of {STEPS.length}
      </p>
    </div>
  );
}
