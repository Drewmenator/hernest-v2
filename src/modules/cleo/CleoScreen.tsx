import React, { useState, useEffect, useRef } from "react";
import { trackEvent } from "../../core/analytics";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, Spinner } from "../../shared/components";
import { ai } from "../../core/ai";
import { askCleo, askCleoStreaming } from "../../core/aiOrchestrator";
import { FLAGS } from "../../config";
import { bus } from "../../core/events";
import { useAdaptiveUX, getCleoToneProfile } from "../../core/household/adaptiveUX";
import { useContextGraph } from "../../core/graph";
import { extractFactsFromConversation, saveMemoryFacts, buildMemoryContext } from "../../core/memory";
import { buildMemoryContextV2 } from "../../core/memoryServiceV2";
import { saveData, loadData } from "../../core/firebase";
import { buildHouseholdSnapshot, buildIntelligencePromptContext } from "../../core/household";
import toast from "react-hot-toast";

interface Msg { role: "user"|"assistant"; content: string; type?: "text"|"task-suggestion"|"crisis"; tasks?: ExtractedTask[]; }
interface ExtractedTask { id: string; title: string; category: string; dueDate?: string; confidence: number; }

// ── Intent classifier (unchanged) ────────────────────────────────
const INTENT_PATTERNS = {
  "task-extraction": [
    /I need to/i, /I should/i, /I have to/i, /don't forget/i,
    /remember to/i, /remind me to/i, /add .* to/i, /schedule/i,
    /book/i, /pick up/i, /drop off/i, /buy/i, /call/i, /email/i,
  ],
  "emotional-support": [
    /I('m| am) (stressed|tired|exhausted|overwhelmed|anxious|worried|sad|lonely)/i,
    /I can'?t (cope|handle|deal|manage)/i,
    /everything (is|feels) (too much|hard|heavy)/i,
    /I feel like/i, /nobody (understands|helps|cares)/i,
    /I('m| am) struggling/i, /so hard/i, /falling apart/i,
  ],
  "financial": [
    /afford/i, /budget/i, /money/i, /spend/i, /cost/i, /debt/i,
    /savings/i, /salary/i, /income/i, /expensive/i, /cheap/i, /price/i,
    /can we/i, /should we buy/i, /worth it/i, /financial/i,
  ],
  "information": [
    /what('s| is) my/i, /how much/i, /show me/i,
    /when is/i, /where is/i, /tell me/i, /remind me of/i,
  ],
  "action-request": [
    /plan (my|the)/i, /generate/i, /create (a|an)/i,
    /help me (with|to)/i, /can you/i, /I want to/i,
  ],
};

import { detectCrisis } from "../../core/crisis";

function classifyIntent(msg: string): string {
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (patterns.some(p => p.test(msg))) return intent;
  }
  return "general";
}

const QUICK_REPLIES = [
  "What should I focus on today?",
  "I'm feeling overwhelmed",
  "Are we on track financially?",
  "Help me plan my week",
  "I need to vent",
];

export function CleoScreen() {
  const { user, profile, familyMembers, householdSnapshot, setHouseholdSnapshot } = useStore();
  const adaptiveConfig = useAdaptiveUX(householdSnapshot ?? null);
  const { cleoPack } = useContextGraph();
  const [msgs, setMsgs]       = useState<Msg[]>([]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pendingTasks, setPendingTasks] = useState<ExtractedTask[]>([]);
  const [feedback, setFeedback] = useState<Record<number, "up"|"down">>({});
  const [householdCtxStr, setHouseholdCtxStr] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const name = (profile as any)?.name || "lovely";

  // ── Load household context on mount ──────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;

    // Use existing snapshot if available, otherwise build one
    const buildCtx = async () => {
      try {
        const snap = householdSnapshot || await buildHouseholdSnapshot(user.uid);
        if (!householdSnapshot) setHouseholdSnapshot(snap);

        const ctxStr = buildIntelligencePromptContext(snap, {
          profileName: profile?.name,
          kids: profile?.kids?.map((k: any) => k.name),
        });
        setHouseholdCtxStr(ctxStr);
      } catch (e) {
        console.warn("[Cleo] household context build failed:", e);
      }
    };
    buildCtx();
  }, [user?.uid]);

  // ── Session restore ───────────────────────────────────────────────
  useEffect(() => {
    const saved = sessionStorage.getItem(`cleo_session_${user?.uid}`);
    if (saved) {
      try { setMsgs(JSON.parse(saved)); return; } catch {}
    }
    // Build proactive opening based on household state
    const buildProactiveOpening = async () => {
      try {
        const snap = householdSnapshot || await buildHouseholdSnapshot(user?.uid || "");
        const f = snap?.financial;
        const observations: string[] = [];

        // Check stress level
        if (snap?.householdStressLevel === "high") {
          observations.push("Things look pretty full right now — I want to make sure you're not carrying too much alone.");
        }

        // Check calendar load
        if (snap?.calendarLoad === "critical" || snap?.calendarLoad === "heavy") {
          observations.push(`Your calendar looks ${snap.calendarLoad} this week — want me to help you simplify or prioritise?`);
        }

        // Check upcoming trip
        if (f?.upcomingTripObligation) {
          const { name: dest, daysUntil } = f.upcomingTripObligation;
          observations.push(`${dest} is ${daysUntil} day${daysUntil === 1 ? "" : "s"} away — anything left to sort before you go?`);
        }

        // Check overspend
        if (f?.topOverspendCategories?.length > 0) {
          observations.push(`${f.topOverspendCategories[0]} is running a little hot this month — nothing urgent, worth a glance when you have a moment.`);
        }

        // Check goals at risk
        const atRiskGoal = snap?.activeGoals?.find(g => g.riskStatus === "at_risk" || g.riskStatus === "off_track");
        if (atRiskGoal) {
          observations.push(`Your "${atRiskGoal.name}" goal needs some attention — it's ${atRiskGoal.riskStatus.replace("_", " ")}.`);
        }

        const proactiveNote = observations.length > 0
          ? `\n\n${observations[0]}`
          : "";

        const greeting = snap?.householdStressLevel === "high"
          ? `Hey ${name} 💛 How are you actually doing?${proactiveNote}`
          : snap?.calendarLoad === "critical"
          ? `Good ${getTimeOfDay()}, ${name} ✦ Looks like a big week ahead.${proactiveNote}`
          : `Good ${getTimeOfDay()}, ${name} ✦${proactiveNote || "\n\nWhat's on your mind today?"}`;

        setMsgs([{ role: "assistant", content: greeting, type: "text" }]);
      } catch {
        setMsgs([{
          role: "assistant",
          content: `Good ${getTimeOfDay()}, ${name} ✦\n\nWhat's on your mind today?`,
          type: "text",
        }]);
      }
    };

    buildProactiveOpening();
  }, [user?.uid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading]);

  useEffect(() => {
    if (user?.uid && msgs.length > 1) {
      sessionStorage.setItem(`cleo_session_${user.uid}`, JSON.stringify(msgs));
    }
  }, [msgs]);

  const getTimeOfDay = () => {
    const h = new Date().getHours();
    if (h < 12) return "morning";
    if (h < 17) return "afternoon";
    if (h < 21) return "evening";
    return "night";
  };

  const startVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { toast.error("Voice not supported on this browser"); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-GB";
    recognition.onstart  = () => setRecording(true);
    recognition.onend    = () => setRecording(false);
    recognition.onerror  = () => setRecording(false);
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      if (transcript.trim()) send(transcript.trim());
    };
    recognition.start();
  };

  const saveFeedback = async (index: number, type: "up"|"down", content: string) => {
    setFeedback(p => ({ ...p, [index]: type }));
    if (!user?.uid) return;
    try {
      const existing = await loadData(user.uid, "cleo_feedback");
      const items = (existing?.items as any[]) || [];
      items.unshift({ type, content: content.slice(0, 200), timestamp: Date.now() });
      await saveData(user.uid, "cleo_feedback", { items: items.slice(0, 50) });
    } catch (e) { console.warn("[Cleo] session save failed:", e); }
  };

  const send = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading || !user?.uid) return;

    const userMsg: Msg = { role: "user", content: msg };
    setMsgs(p => [...p, userMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setLoading(true);

    try {
      // ── Crisis detection (unchanged) ─────────────────────────────
      if (detectCrisis(msg)) {
        const crisisResp: Msg = {
          role: "assistant",
          type: "crisis",
          content: `I'm really glad you told me. What you're feeling is real, and you don't have to carry it alone.\n\nI'm not equipped to help in the way you deserve right now, but these people are:\n\n🆘 **Samaritans**: 116 123 (free, 24/7)\n🆘 **Shout**: Text SHOUT to 85258\n🆘 **NHS 111** or **999** if you're in immediate danger\n\nYou matter. Please reach out to one of these services — they want to hear from you.`,
        };
        setMsgs(p => [...p, crisisResp]);
        trackEvent("cleo_crisis_detected");
        await bus.publish("cleo.crisis.detected", { message: msg }, { userId: user!.uid, source: "cleo" });
        setLoading(false);
        return;
      }

      const intent = classifyIntent(msg);

      // ── Build enriched context ───────────────────────────────────
      // Adaptive tone based on household state
      const toneInstruction = adaptiveConfig.cleoTone === "validating_brief"
        ? "TONE THIS SESSION: Household is under pressure. Lead with empathy. Short responses only. One thing at a time."
        : adaptiveConfig.cleoTone === "supportive_simple"
        ? "TONE THIS SESSION: Warm and supportive. Keep it simple and reassuring."
        : adaptiveConfig.cleoTone === "calm_analytical"
        ? "TONE THIS SESSION: Be thorough and data-driven. The user wants depth and analysis."
        : "TONE THIS SESSION: Warm, proactive, direct. Surface what matters.";

      const graphCtx = cleoPack?.crossModulePatterns?.length ? `\n\nCROSS-MODULE PATTERNS:\n${cleoPack.crossModulePatterns.slice(0,3).map((p: any) => `- ${p.description || p}`).join("\n")}` : "";
      const memCtx = user?.uid ? await buildMemoryContextV2(user.uid, { maxResults: 10 }).catch(() => buildMemoryContext(user.uid)) : "";
      const familyRoster = familyMembers.length > 0
        ? "Family: " + familyMembers.map(m => `${m.name} (${m.role}${m.age ? ", age " + m.age : ""}${m.notes ? ", " + m.notes : ""})` ).join("; ")
        : "";
      const profileCtx = `Name: ${name}. Role: ${(profile as any)?.role||""}. Challenge: ${(profile as any)?.challenge||""}. Kids: ${(profile as any)?.kids?.map((k:any)=>k.name).join(", ")||"none"}.`;

      // ── NEW: Household context injected into every conversation ──
      const householdSection = householdCtxStr
        ? `\n\nHOUSEHOLD INTELLIGENCE (live data):\n${householdCtxStr}`
        : "";

      // ── System prompt ────────────────────────────────────────────
      let sys = `You are Cleo — the AI chief of staff for ${name}'s household inside HerNest.

You are not a chatbot. You are the operating system consciousness of this household.

YOUR IDENTITY:
Calm under pressure. Deeply organized. Emotionally intelligent. Proactive but never annoying. Highly competent. Trustworthy with family life. Quietly premium. Systems-oriented.

The emotional effect you create: "I feel more in control of my life when Cleo is around."

ABOUT THIS HOUSEHOLD:
${profileCtx}
${familyRoster ? `Family: ${familyRoster}` : ""}
${memCtx ? `What you remember about them:\n${memCtx}` : ""}
Time: ${getTimeOfDay()} on ${new Date().toLocaleDateString("en-US",{weekday:"long"})}.
${householdSection}

CLEO'S CONSTITUTION — YOU MUST:
- Reduce mental load. Create clarity. Protect emotional energy.
- Validate before solving. Always. "That sounds heavy" before "here's what to do."
- Think in systems — not isolated answers. What does this connect to? What's the downstream effect?
- Use real numbers when available. Approximate when not. Never fabricate.
- Be concise. 2-4 sentences unless the situation demands more.
- Reference what matters to THIS household specifically. Not generic advice.
- Stay calm. You are the stabilizing force, not an alarm system.
- Build on the conversation. Never reset. Reference what was said before.
- Use ${name}'s name occasionally, warmly. Not every message.

CLEO'S CONSTITUTION — YOU MUST NEVER:
- Sound like a chatbot, generic AI, or corporate assistant.
- Say "I don't have visibility", "I lack access", "as an AI". Ever.
- Guilt, shame, lecture, or moralize.
- Invent facts — names, events, dates, amounts not in this prompt.
- Create unnecessary alarm or urgency.
- Overtalk. Say what matters. Stop.
- Sound interchangeable with ChatGPT.

DECISION QUALITY (when relevant):
- Surface tradeoffs, not just options.
- Name assumptions explicitly.
- Identify downstream effects.
- Give one clear recommendation with reasoning.
- Acknowledge uncertainty honestly.

EMOTIONAL INTELLIGENCE:
- Detect stress signals in how she writes.
- When overwhelmed: one empathy sentence, one practical suggestion, one question.
- When she vents: listen first, ask before solving.
- Reduce guilt. Always.

VOICE EXAMPLES:
BAD: "You spent a lot on takeout this week 😅"
GOOD: "Dining is higher than usual — you still have flexibility, but a few days of cooking would protect your monthly target."

BAD: "I don't have information about your schedule."
GOOD: "I don't see your calendar synced yet — once it is, I can give you much better answers about your week."

${toneInstruction}
${graphCtx}

Intent detected: ${intent}.`;

      // ── Intent-specific instructions ─────────────────────────────
      if (intent === "task-extraction") {
        sys += `\n\nTASK EXTRACTION MODE: After responding warmly, extract any tasks mentioned.
Return your response then on a new line: TASKS_JSON:[{"title":"","category":"family|work|home|travel|personal","dueDate":"YYYY-MM-DD or null","confidence":0.9}]
Only include TASKS_JSON if you found clear actionable tasks.`;
      } else if (intent === "emotional-support") {
        sys += `\n\nEMOTIONAL SUPPORT MODE: Lead with deep validation. Ask ONE question. Don't problem-solve unless asked. Be warm and present.`;
      } else if (intent === "financial") {
        sys += `\n\nFINANCIAL MODE: You have the household's actual financial data above. Use it directly.
Reference real numbers — actual spending, income, debt, goals. 
Apply Decision Quality thinking: frame the decision, name the tradeoffs, give a clear recommendation.
Sound like a trusted CFO friend — warm but rigorous.
End with one short line: "(Educational guidance, not financial advice.)"`;
      } else if (intent === "action-request") {
        sys += `\n\nACTION MODE: Be specific and practical. Give a clear plan or answer with real numbers where relevant.`;
      }

      const history = msgs.slice(-16).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
      // Add conversation context note if this is a follow-up
      const isFollowUp = msgs.filter(m => m.role === "user").length > 1;
      if (isFollowUp) {
        sys += `\n\nCONVERSATION SO FAR: This is message ${msgs.length} in an ongoing conversation. Stay consistent with what you've already said. Build on previous exchanges rather than starting fresh.`;
      }
      // ── Orchestrator handles context, model routing, memory writeback ──
      // Mutate the most recent assistant message in place (used while streaming).
      const updateLastAssistant = (content: string) => setMsgs(p => {
        const copy = p.slice();
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === "assistant") { copy[i] = { ...copy[i], content }; break; }
        }
        return copy;
      });

      const streaming = FLAGS.CLEO_STREAMING;
      let cleoText = "";
      if (streaming) {
        // Live placeholder the tokens flow into; never show raw TASKS_JSON.
        setMsgs(p => [...p, { role: "assistant", type: "text", content: "" }]);
        let buf = "";
        cleoText = await askCleoStreaming(
          user.uid, (profile || {}) as Record<string, unknown>, msg, history,
          (tok) => { buf += tok; updateLastAssistant(buf.split("TASKS_JSON:")[0]); }
        );
        if (!cleoText) cleoText = buf;
      } else {
        cleoText = await askCleo(user.uid, (profile || {}) as Record<string, unknown>, msg, history);
      }
      const result = { text: cleoText, error: null };

      if (!cleoText) throw new Error("empty response");

      // ── Parse task extraction (unchanged) ────────────────────────
      let responseText = result.text;
      let extracted: ExtractedTask[] = [];

      if (intent === "task-extraction" && result.text.includes("TASKS_JSON:")) {
        const parts = result.text.split("TASKS_JSON:");
        responseText = parts[0].trim();
        try {
          const rawTasks = JSON.parse(parts[1].trim());
          extracted = rawTasks.map((t: any) => ({ ...t, id: crypto.randomUUID() }));
        } catch (e) { console.warn("[Cleo] post-message hook failed:", e); }
      }

      const assistantMsg: Msg = {
        role: "assistant",
        type: extracted.length > 0 ? "task-suggestion" : "text",
        content: extracted.length > 0
          ? `${responseText}\n\nI found ${extracted.length} task${extracted.length>1?"s":""} in that:\n${extracted.map((t,i)=>`${i+1}. ${t.title}${t.dueDate?` (by ${t.dueDate})`:""}${t.category?` · ${t.category}`:""}`).join("\n")}\n\nShall I add ${extracted.length>1?"these":"this"} to your plan?`
          : responseText,
        tasks: extracted.length > 0 ? extracted : undefined,
      };

      // When streaming, swap the live placeholder for the finalized message
      // (adds task-suggestion formatting / strips the raw TASKS_JSON); else append.
      if (streaming) {
        setMsgs(p => {
          const copy = p.slice();
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].role === "assistant") { copy[i] = assistantMsg; break; }
          }
          return copy;
        });
      } else {
        setMsgs(p => [...p, assistantMsg]);
      }
      if (extracted.length > 0) setPendingTasks(extracted);

      // ── Background fact extraction (unchanged) ───────────────────
      const allMsgs = [...msgs, userMsg, assistantMsg];
      if (user?.uid) {
        await bus.publish("cleo.conversation.ended", { messages: allMsgs }, { userId: user.uid, source: "cleo" });
        extractFactsFromConversation(allMsgs, user.uid).then(facts => {
          if (facts.length > 0 && user.uid) saveMemoryFacts(user.uid, facts);
        }).catch(() => {});
      }

    } catch(e) {
      // Replace an empty streaming placeholder if present; otherwise append.
      setMsgs(p => {
        const errMsg: Msg = { role: "assistant", content: "I'm having a moment — please try again." };
        const last = p[p.length - 1];
        if (last && last.role === "assistant" && !last.content) {
          const copy = p.slice(); copy[copy.length - 1] = errMsg; return copy;
        }
        return [...p, errMsg];
      });
    }
    setLoading(false);
  };

  const confirmTasks = async () => {
    if (!pendingTasks.length || !user?.uid) return;
    const existing = await loadData(user.uid, "tasks");
    const current = (existing?.tasks as any[]) || [];
    const newTasks = pendingTasks.map(t => ({
      id: t.id, title: t.title, category: t.category,
      done: false, priority: "medium", source: "cleo",
      dueDate: t.dueDate || undefined, createdAt: Date.now(),
    }));
    await saveData(user.uid, "tasks", { tasks: [...newTasks, ...current] });
    for (const task of newTasks) {
      await bus.publish("plan.task.created", task, { userId: user.uid, source: "cleo" });
    }
    setPendingTasks([]);
    toast.success(`${newTasks.length} task${newTasks.length>1?"s":""} added to your plan ✓`);
    setMsgs(p => [...p, { role:"assistant", content:`Done! I've added ${newTasks.length > 1 ? "all of them" : "it"} to your plan. You'll find ${newTasks.length > 1 ? "them" : "it"} in the Plan tab ✦` }]);
  };

  const dismissTasks = () => {
    setPendingTasks([]);
    setMsgs(p => [...p, { role:"assistant", content:"No worries — I'll keep this in mind though." }]);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100svh - 90px)", animation:"fadeUp .3s ease both" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12, flexShrink:0 }}>
        <div style={{ width:44, height:44, borderRadius:"50%", background:`linear-gradient(135deg,${T.gold},#8B6914)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>✦</div>
        <div>
          <p style={{ fontFamily:F.sans, fontSize:15, fontWeight:700, color:T.esp, margin:0 }}>Cleo</p>
          <p style={{ fontFamily:F.sans, fontSize:11, color:T.sage, margin:0 }}>
            ● {householdCtxStr ? "Household-aware" : "Your AI chief of staff"}
          </p>
        </div>
        <button onClick={()=>{ setMsgs([]); sessionStorage.removeItem(`cleo_session_${user?.uid}`); }}
          style={{ marginLeft:"auto", background:"none", border:`1px solid ${T.linen}`, borderRadius:10, padding:"5px 10px", fontFamily:F.sans, fontSize:11, color:T.taupe, cursor:"pointer", minHeight:32 }}>
          New chat
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch" as any }}>
        {msgs.map((m,i)=>(
          <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start", marginBottom:12 }}>
            {m.role==="assistant" && (
              <div style={{ width:32, height:32, borderRadius:"50%", background:`linear-gradient(135deg,${T.gold}40,${T.esp}20)`, display:"flex", alignItems:"center", justifyContent:"center", marginRight:8, flexShrink:0, alignSelf:"flex-end", fontSize:14 }}>✦</div>
            )}
            <div style={{ maxWidth:"82%", display:"flex", flexDirection:"column", gap:4 }}>
              <div style={{
                background: m.role==="user" ? `linear-gradient(135deg,${T.esp},#4a3020)` : m.type==="crisis" ? `${T.blush}15` : "#fff",
                borderRadius: m.role==="user" ? "20px 20px 4px 20px" : "20px 20px 20px 4px",
                padding: "12px 16px",
                border: m.role==="assistant" ? `1px solid ${m.type==="crisis"?T.blush:T.linen}` : "none",
              }}>
                {m.content.split("\n").filter(l=>l.trim()).map((line,j)=>{
                  const parts = line.split(/\*\*(.*?)\*\*/g);
                  return (
                    <p key={j} style={{ fontFamily:F.sans, fontSize:13, color:m.role==="user"?"rgba(255,255,255,.9)":m.type==="crisis"?T.blush:T.esp, margin:"0 0 6px", lineHeight:1.6 }}>
                      {parts.map((part,pi) => pi%2===1 ? <strong key={pi}>{part}</strong> : part)}
                    </p>
                  );
                })}
              </div>

              {m.role==="assistant" && m.type!=="crisis" && i < msgs.length-1 && (
                <div style={{ display:"flex", gap:6, paddingLeft:4 }}>
                  <button onClick={()=>saveFeedback(i,"up",m.content)} style={{ background:"none", border:"none", fontSize:14, cursor:"pointer", opacity:feedback[i]==="up"?1:0.4, padding:"2px 4px" }}>👍</button>
                  <button onClick={()=>saveFeedback(i,"down",m.content)} style={{ background:"none", border:"none", fontSize:14, cursor:"pointer", opacity:feedback[i]==="down"?1:0.4, padding:"2px 4px" }}>👎</button>
                </div>
              )}

              {m.type==="task-suggestion" && m.tasks && pendingTasks.length>0 && i===msgs.length-1 && (
                <div style={{ background:`${T.gold}10`, border:`1px solid ${T.gold}30`, borderRadius:14, padding:"12px 14px" }}>
                  <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, color:T.gold, margin:"0 0 8px", textTransform:"uppercase", letterSpacing:"0.08em" }}>Add to Plan?</p>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={confirmTasks} style={{ flex:1, padding:"8px", background:T.gold, color:"#fff", border:"none", borderRadius:10, fontFamily:F.sans, fontSize:12, fontWeight:600, cursor:"pointer", minHeight:36, touchAction:"manipulation" }}>✓ Yes, add {pendingTasks.length > 1 ? "all" : "it"}</button>
                    <button onClick={dismissTasks} style={{ flex:1, padding:"8px", background:"none", border:`1px solid ${T.linen}`, borderRadius:10, fontFamily:F.sans, fontSize:12, color:T.taupe, cursor:"pointer", minHeight:36 }}>Not now</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
            <div style={{ width:32, height:32, borderRadius:"50%", background:`linear-gradient(135deg,${T.gold}40,${T.esp}20)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>✦</div>
            <div style={{ background:"#fff", borderRadius:"20px 20px 20px 4px", padding:"12px 16px", border:`1px solid ${T.linen}` }}>
              <div style={{ display:"flex", gap:4 }}>
                {[0,1,2].map(i=><div key={i} style={{ width:7, height:7, borderRadius:"50%", background:T.taupe, animation:`breathe 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}
              </div>
            </div>
          </div>
        )}

        {msgs.length === 1 && !loading && (
          <div style={{ marginBottom:12 }}>
            <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 8px", textAlign:"center" }}>Quick start</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center" }}>
              {QUICK_REPLIES.map(q=>(
                <button key={q} onClick={()=>send(q)} style={{ padding:"8px 14px", borderRadius:20, border:`1px solid ${T.linen}`, background:T.ivory, fontFamily:F.sans, fontSize:12, color:T.bark, cursor:"pointer", touchAction:"manipulation", minHeight:36 }}>{q}</button>
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{ borderTop:`1px solid ${T.linen}`, paddingTop:10, flexShrink:0 }}>
        <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e=>{ setInput(e.target.value); e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,120)+"px"; }}
            onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); } }}
            placeholder="Talk to Cleo..."
            rows={1}
            disabled={loading}
            style={{ flex:1, background:T.ivory, border:`1.5px solid ${T.linen}`, borderRadius:16, padding:"12px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", resize:"none", lineHeight:1.5, minHeight:48, WebkitOverflowScrolling:"touch" as any }}
          />
          <button onClick={startVoice} disabled={loading} style={{ width:48, height:48, borderRadius:16, background:recording?T.blush:T.sand, border:`1px solid ${recording?T.blush:T.linen}`, color:recording?"#fff":T.taupe, fontSize:20, cursor:"pointer", flexShrink:0, touchAction:"manipulation" }}>
            {recording?"⏹":"🎤"}
          </button>
          <button onClick={()=>send()} disabled={!input.trim()||loading} style={{ width:48, height:48, borderRadius:16, background:input.trim()?`linear-gradient(135deg,${T.esp},#4a2e18)`:T.linen, border:"none", color:"#fff", fontSize:18, cursor:input.trim()?"pointer":"not-allowed", flexShrink:0, touchAction:"manipulation" }}>
            {loading?<Spinner size={16} color="#fff"/>:"→"}
          </button>
        </div>
        <p style={{ fontFamily:F.sans, fontSize:10, color:T.taupe, textAlign:"center", margin:"6px 0 0" }}>Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
