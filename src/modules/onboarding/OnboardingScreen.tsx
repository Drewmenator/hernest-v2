import React, { useState, useEffect, useRef } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { saveData } from "../../core/firebase";

interface Msg { role: "cleo" | "user"; text: string; }

interface SetupData {
  name?: string;
  income?: number;
  kids?: string;
  goal?: string;
  debt?: number;
  challenge?: string;
}

type SetupStep = "intro" | "name" | "income" | "kids" | "kidDates" | "goal" | "debt" | "challenge" | "done";

const NORA_QUESTIONS: Record<SetupStep, (data: SetupData) => string> = {
  intro:     () => "",
  name:      () => "First things first — what's your name?",
  income:    (d) => `Lovely to meet you, ${d.name} ✦\n\nTo help you properly, I need to understand your household finances. What's your combined monthly household income? (Approximate is completely fine — you can update this any time.)`,
  kids:      () => "Do you have children? If yes, tell me their names and ages — I'll use this to personalise your experience. If not, just say 'no kids'.",
  kidDates:  () => "Lovely. Want to add their birthdays? I'll keep their ages up to date and remember to celebrate 🎂 — totally optional, tap Continue to skip.",
  goal:      (d) => d.kids && d.kids.toLowerCase() !== "no kids" ? `Thank you — knowing about your family helps me a lot.\n\nWhat's your biggest financial goal right now? For example: build an emergency fund, pay off debt, save for a holiday, or something else entirely.` : `Got it.\n\nWhat's your biggest financial goal right now? For example: build an emergency fund, pay off debt, save for a holiday, or something else entirely.`,
  debt:      (d) => `${d.goal ? `"${d.goal}" — that's a great focus.\n\n` : ""}One more financial question, and you can skip this one. Do you have any existing debt? Credit cards, loans, car finance? Just give me a rough total, or say 'skip'.`,
  challenge: () => "Almost done.\n\nWhat's the biggest thing weighing on you right now — the thing that takes up most of your mental energy?",
  done:      (d) => `${d.name}, I have everything I need.\n\nI'm going to set up your household now. From today, I'll help you manage your finances, your schedule, your family, and anything else life throws at you.\n\nLet's go. ✦`,
};

const STEP_ORDER: SetupStep[] = ["name", "income", "kids", "kidDates", "goal", "debt", "challenge", "done"];

function parseKids(input: string): Array<{id: string; name: string; age: number}> {
  if (input.toLowerCase().includes("no kid") || input.toLowerCase() === "none" || input.toLowerCase() === "no") return [];
  // Try to extract names and ages like "Emma 8, Jake 5"
  const parts = input.split(/,|and/i).map(s => s.trim()).filter(Boolean);
  return parts.map(part => {
    const ageMatch = part.match(/\d+/);
    const name = part.replace(/\d+/g, "").replace(/years?|old|age/gi, "").trim();
    return { id: crypto.randomUUID(), name: name || part, age: ageMatch ? parseInt(ageMatch[0]) : 8 };
  }).filter(k => k.name.length > 0);
}

export function CleoSetupScreen({ onComplete }: { onComplete?: () => void }) {
  const { user, setProfile } = useStore();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [step, setStep] = useState<SetupStep>("name");
  const [data, setData] = useState<SetupData>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  // Parsed kids held between the "kids" text step and the "kidDates" picker step.
  const [kidsList, setKidsList] = useState<Array<{ id: string; name: string; age?: number; birthDate?: string }>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Escape hatch — never trap a user in the questions. Writes a flag so the
  // gate doesn't re-prompt on the next sign-in; the contextual setup on Home
  // is the backup path.
  const skip = async () => {
    if (user?.uid) {
      try { await saveData(user.uid, "profile", { onboardingSkipped: true }); } catch { /* non-fatal */ }
    }
    if (onComplete) onComplete();
  };

  // Opening message
  useEffect(() => {
    const intro = `Hi ✦ I'm Cleo — your household's AI chief of staff.\n\nI'm going to ask you a few quick questions so I can set up your household properly. The more you tell me, the more useful I'll be from day one.\n\nThis takes about 2 minutes.`;
    setMsgs([{ role: "cleo", text: intro }]);
    setTimeout(() => {
      setMsgs(prev => [...prev, { role: "cleo", text: NORA_QUESTIONS.name(data) }]);
      inputRef.current?.focus();
    }, 1200);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // Advance from the birthday-picker step to the goal question.
  const finishKidDates = () => {
    setStep("goal");
    setTimeout(() => {
      setMsgs(prev => [...prev, { role: "cleo", text: NORA_QUESTIONS.goal(data) }]);
      inputRef.current?.focus();
    }, 300);
  };

  const send = async () => {
    if (!input.trim() || loading || done) return;
    const userMsg = input.trim();
    setInput("");

    // Add user message
    setMsgs(prev => [...prev, { role: "user", text: userMsg }]);

    // Process answer
    const newData = { ...data };
    let nextStep: SetupStep;

    if (step === "name") {
      newData.name = userMsg.split(" ")[0]; // First name only
      nextStep = "income";
    } else if (step === "income") {
      const num = parseFloat(userMsg.replace(/[^0-9.]/g, ""));
      newData.income = isNaN(num) ? 0 : num;
      nextStep = "kids";
    } else if (step === "kids") {
      newData.kids = userMsg;
      const parsed = parseKids(userMsg);
      setKidsList(parsed);
      // Offer the optional birthday picker only if we actually found kids.
      nextStep = parsed.length > 0 ? "kidDates" : "goal";
    } else if (step === "goal") {
      newData.goal = userMsg;
      nextStep = "debt";
    } else if (step === "debt") {
      const isSkip = userMsg.toLowerCase().includes("skip") || userMsg.toLowerCase() === "no" || userMsg.toLowerCase() === "none";
      const num = parseFloat(userMsg.replace(/[^0-9.]/g, ""));
      newData.debt = isSkip || isNaN(num) ? 0 : num;
      nextStep = "challenge";
    } else if (step === "challenge") {
      newData.challenge = userMsg;
      nextStep = "done";
    } else {
      return;
    }

    setData(newData);
    setStep(nextStep);

    // Show Cleo response after brief delay
    setTimeout(async () => {
      const cleoResponse = NORA_QUESTIONS[nextStep](newData);
      setMsgs(prev => [...prev, { role: "cleo", text: cleoResponse }]);

      if (nextStep === "done") {
        setDone(true);
        setLoading(true);

        // Save everything
        try {
          // Prefer the picker list (carries birthDate); fall back to re-parsing.
          const kids = kidsList.length ? kidsList : parseKids(newData.kids || "");
          const profile = {
            uid:           user?.uid || "",
            name:          newData.name || "",
            email:         user?.email || "",
            avatar:        "👩",
            city: "", role: "",
            kids,
            parents: [], inlaws: [],
            priorities: [],
            tripGoal: "", fitnessGoal: "",
            savingsGoal:   newData.goal || "",
            challenge:     newData.challenge || "",
            soloParent:    false,
            energyPattern: "morning" as const,
            diet:          "",
            onboardedAt:   Date.now(),
          };

          const budgetSeed = {
            incomes: newData.income && newData.income > 0 ? [{
              id: "primary", label: "Monthly Income",
              amount: newData.income, frequency: "monthly",
            }] : [],
            debts: newData.debt && newData.debt > 0 ? [{
              id: "total_debt", label: "Total Debt",
              balance: newData.debt,
              minimumPayment: Math.round(newData.debt * 0.02), apr: 0,
            }] : [],
            goals: newData.goal ? [{
              id: "primary_goal", name: newData.goal,
              targetAmount: 0, currentAmount: 0,
              priority: "high", riskStatus: "on_track",
            }] : [],
            categories: [],
          };

          setProfile(profile as any);
          if (user?.uid) {
            await saveData(user.uid, "profile", profile);
            await saveData(user.uid, "budget_v2", budgetSeed);
          }

          // Enter app after showing done message
          setTimeout(() => {
            if (onComplete) onComplete();
          }, 2500);
        } catch (e) {
          console.error("[Setup] failed:", e);
        }
        setLoading(false);
      }
    }, 600);
  };

  return (
    <div style={{ minHeight: "100svh", background: T.cream, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "calc(52px + env(safe-area-inset-top, 0px)) 24px 16px", borderBottom: `1px solid ${T.linen}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontFamily: F.serif, fontSize: 22, fontStyle: "italic", color: T.esp, margin: 0 }}>Meet Cleo ✦</p>
          <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "4px 0 0" }}>Your household AI chief of staff</p>
        </div>
        {!done && (
          <button onClick={skip} style={{ background: "none", border: "none", fontFamily: F.sans, fontSize: 12, color: T.taupe, cursor: "pointer", padding: "4px 0", textDecoration: "underline", flexShrink: 0 }}>
            Skip for now
          </button>
        )}
      </div>

      {/* Chat */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {msgs.map((msg, i) => (
          <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
            {msg.role === "cleo" && (
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: T.esp, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginRight: 10, marginTop: 4 }}>
                <span style={{ fontSize: 14 }}>✦</span>
              </div>
            )}
            <div style={{
              maxWidth: "78%",
              background: msg.role === "user" ? T.esp : "#fff",
              color: msg.role === "user" ? "#fff" : T.esp,
              borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              padding: "12px 16px",
              fontFamily: F.sans,
              fontSize: 14,
              lineHeight: 1.6,
              border: msg.role === "cleo" ? `1px solid ${T.linen}` : "none",
              whiteSpace: "pre-wrap",
            }}>
              {msg.text}
            </div>
          </div>
        ))}

        {/* Progress indicator */}
        {!done && msgs.length > 1 && (
          <div style={{ display: "flex", gap: 4, justifyContent: "center", padding: "4px 0" }}>
            {STEP_ORDER.slice(0, -1).map((s, i) => (
              <div key={s} style={{ width: 6, height: 6, borderRadius: "50%", background: STEP_ORDER.indexOf(step) > i ? T.gold : T.linen, transition: "background .3s" }} />
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Birthday picker (optional structured step) */}
      {!done && step === "kidDates" && (
        <div style={{ padding: "12px 16px 32px", borderTop: `1px solid ${T.linen}`, background: T.cream }}>
          {kidsList.map((k, i) => (
            <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ flex: 1, fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.esp }}>{k.name}</span>
              <input
                type="date"
                max={new Date().toISOString().split("T")[0]}
                value={k.birthDate || ""}
                onChange={e => setKidsList(list => list.map((x, j) => j === i ? { ...x, birthDate: e.target.value } : x))}
                style={{ background: "#fff", border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none" }}
              />
            </div>
          ))}
          <button onClick={finishKidDates} style={{ width: "100%", marginTop: 8, padding: "13px", background: T.esp, border: "none", color: "#fff", borderRadius: 14, fontFamily: F.sans, fontSize: 15, fontWeight: 600, cursor: "pointer", minHeight: 48 }}>
            Continue
          </button>
        </div>
      )}

      {/* Input */}
      {!done && step !== "kidDates" && (
        <div style={{ padding: "12px 16px 32px", borderTop: `1px solid ${T.linen}`, background: T.cream, display: "flex", gap: 10 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            placeholder={
              step === "name" ? "Your first name..." :
              step === "income" ? "Monthly income..." :
              step === "kids" ? "e.g. Emma 8, Jake 5 — or 'no kids'" :
              step === "goal" ? "Your top financial goal..." :
              step === "debt" ? "Total debt — or 'skip'" :
              "What's weighing on you most..."
            }
            autoFocus
            style={{
              flex: 1, background: "#fff", border: `1.5px solid ${T.linen}`,
              borderRadius: 14, padding: "12px 16px", fontFamily: F.sans,
              fontSize: 16, color: T.esp, outline: "none",
            }}
          />
          <button onClick={send} disabled={!input.trim()}
            style={{
              width: 48, height: 48, borderRadius: 14,
              background: input.trim() ? T.esp : T.linen,
              border: "none", color: "#fff", fontSize: 18,
              cursor: input.trim() ? "pointer" : "not-allowed", flexShrink: 0,
            }}>
            →
          </button>
        </div>
      )}
    </div>
  );
}

// Default export wraps with store navigation
export function OnboardingScreen() {
  const { setScreen } = useStore();
  return <CleoSetupScreen onComplete={() => setScreen("app")} />;
}
