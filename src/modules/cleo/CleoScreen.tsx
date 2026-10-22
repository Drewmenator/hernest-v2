import { useState, useEffect, useRef } from "react";
import { trackEvent } from "../../core/analytics";
import { T, F, TYPE } from "../../config/theme";
import { useStore } from "../../core/store";
import { Spinner, Button, CleoActionCard } from "../../shared/components";
import { SparkleIcon, MicIcon, ArrowUpIcon, StopIcon } from "../../shared/components/Icons";
import { askCleo, askCleoStreaming } from "../../core/aiOrchestrator";
import { FLAGS } from "../../config";
import { bus } from "../../core/events";
import { saveData, loadData } from "../../core/firebase";
import { buildHouseholdSnapshot } from "../../core/household/householdSnapshot";
import toast from "react-hot-toast";
import { CLEO_PREFILL_KEY } from "../../shared/utils/openCleo";
import { MemorySuggestionCard } from "./MemorySuggestionCard";
import type { HouseholdMemory } from "../../core/memoryServiceV2";

interface Msg { role: "user"|"assistant"; content: string; type?: "text"|"task-suggestion"|"crisis"; tasks?: ExtractedTask[]; }
interface ExtractedTask { id: string; title: string; category: string; dueDate?: string; confidence: number; }

import { crisisReply } from "../../core/crisis";

const QUICK_REPLIES = [
  "What should I focus on today?",
  "I'm feeling overwhelmed",
  "Are we on track financially?",
  "Help me plan my week",
  "I need to vent",
];

export function CleoScreen() {
  const { user, profile, householdSnapshot, setHouseholdSnapshot } = useStore();
  const [msgs, setMsgs]       = useState<Msg[]>([]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pendingTasks, setPendingTasks] = useState<ExtractedTask[]>([]);
  const [feedback, setFeedback] = useState<Record<number, "up"|"down">>({});
  const [householdCtxStr, setHouseholdCtxStr] = useState<string>("");
  // "Want me to remember that?" suggestions from this chat (one or two at a time).
  const [memSuggestions, setMemSuggestions] = useState<HouseholdMemory[]>([]);
  const memSuggestionsRef = useRef<HouseholdMemory[]>([]);
  const chatStartedAt = useRef(new Date().toISOString());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const name = (profile as any)?.name || "lovely";

  // Another screen's "Ask Cleo" button can leave a message ready to send.
  // Put it in the box (don't auto-send) and clear it so it only shows once.
  useEffect(() => {
    let prefill: string | null = null;
    try {
      prefill = sessionStorage.getItem(CLEO_PREFILL_KEY);
      if (prefill) sessionStorage.removeItem(CLEO_PREFILL_KEY);
    } catch { /* private mode */ }
    if (!prefill) return;
    setInput(prefill);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
      el.focus();
      el.setSelectionRange(prefill!.length, prefill!.length);
    });
  }, []);

  // ── Load household context on mount ──────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;

    // Use existing snapshot if available, otherwise build one
    const buildCtx = async () => {
      try {
        const snap = householdSnapshot || await buildHouseholdSnapshot(user.uid);
        if (!householdSnapshot) setHouseholdSnapshot(snap);

        // Only used for the "Household-aware" label; Cleo's real context is
        // built per message by the orchestrator.
        setHouseholdCtxStr(snap.lastRefreshed);
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
        const observations: string[] = [];

        // Check stress level
        if (snap?.householdStressLevel === "high") {
          observations.push("Things look pretty full right now — I want to make sure you're not carrying too much alone.");
        }

        // Check calendar load
        if (snap?.calendarLoad === "critical" || snap?.calendarLoad === "heavy") {
          observations.push(`Your calendar looks ${snap.calendarLoad} this week — want me to help you simplify or prioritize?`);
        }

        // Check upcoming trip
        if (snap?.upcomingTrip) {
          const { name: dest, daysUntil } = snap.upcomingTrip;
          observations.push(`${dest} is ${daysUntil} day${daysUntil === 1 ? "" : "s"} away — anything left to sort before you go?`);
        }

        const proactiveNote = observations.length > 0
          ? `\n\n${observations[0]}`
          : "";

        const greeting = snap?.householdStressLevel === "high"
          ? `Hey ${name}, how are you actually doing?${proactiveNote}`
          : snap?.calendarLoad === "critical"
          ? `Good ${getTimeOfDay()}, ${name}. Looks like a big week ahead.${proactiveNote}`
          : `Good ${getTimeOfDay()}, ${name}.${proactiveNote || "\n\nWhat's on your mind today?"}`;

        setMsgs([{ role: "assistant", content: greeting, type: "text" }]);
      } catch {
        setMsgs([{
          role: "assistant",
          content: `Good ${getTimeOfDay()}, ${name}.\n\nWhat's on your mind today?`,
          type: "text",
        }]);
      }
    };

    buildProactiveOpening();
  }, [user?.uid]);

  // ── Memory suggestions ───────────────────────────────────────────
  // After a reply, Cleo may have picked up something worth remembering. It is
  // saved as a suggestion that waits for a yes; ask about new ones here. A
  // card already showing is never topped up, so she doesn't nag.
  useEffect(() => { memSuggestionsRef.current = memSuggestions; }, [memSuggestions]);
  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;
    return bus.subscribe("cleo.memory.updated", async () => {
      if (memSuggestionsRef.current.length) return;
      try {
        const { takeChatSuggestions } = await import("../../core/memoryServiceV2");
        const picked = await takeChatSuggestions(uid, chatStartedAt.current, 2);
        if (picked.length) setMemSuggestions(picked);
      } catch (e) { console.warn("[Cleo] memory suggestions failed:", e); }
    });
  }, [user?.uid]);

  const answerMemory = async (m: HouseholdMemory, remember: boolean) => {
    if (!user?.uid) return;
    setMemSuggestions(p => p.filter(x => x.id !== m.id));
    try {
      const { confirmMemory, rejectMemory } = await import("../../core/memoryServiceV2");
      if (remember) {
        await confirmMemory(user.uid, m.id);
        toast.success("Got it. I'll remember that.");
      } else {
        await rejectMemory(user.uid, m.id);
      }
    } catch {
      toast.error("Couldn't save that. You can answer in What Cleo knows.");
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading, memSuggestions.length]);

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
    recognition.lang = "en-US";
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
      // ── Crisis check: helplines instead of the AI (core/crisis.ts) ──
      const crisisText = crisisReply(msg);
      if (crisisText) {
        const crisisResp: Msg = {
          role: "assistant",
          type: "crisis",
          content: crisisText,
        };
        setMsgs(p => [...p, crisisResp]);
        trackEvent("cleo_crisis_detected");
        await bus.publish("cleo.crisis.detected", { message: msg }, { userId: user!.uid, source: "cleo" });
        setLoading(false);
        return;
      }

      // NOTE: this screen used to hand-build a large system prompt here, but it
      // was never passed to askCleo — the orchestrator builds the real prompt
      // (see aiOrchestrator buildSystemPrompt, where the useful pieces now live).
      const history = msgs.slice(-16).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

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

      // Strip TASKS_JSON whatever this screen guessed the intent was (the
      // orchestrator classifies on its own, so the two can disagree).
      if (result.text.includes("TASKS_JSON:")) {
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
        // Memory writeback happens in the orchestrator (V2 governance) —
        // the V1 extraction that used to run here double-wrote every fact.
        await bus.publish("cleo.conversation.ended", { messages: allMsgs }, { userId: user.uid, source: "cleo" });
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
    const newTasks = pendingTasks.map(t => ({
      id: t.id, title: t.title, category: t.category,
      status: "pending", priority: "must", source: "cleo",
      energyRequired: "medium", userConfirmed: true,
      ...(t.dueDate ? { dueDate: t.dueDate } : {}), createdAt: Date.now(),
    }));
    const { createItem } = await import("../../core/householdItems");
    await Promise.all(newTasks.map(t => createItem(user.uid!, "tasks", t)));
    for (const task of newTasks) {
      await bus.publish("plan.task.created", task, { userId: user.uid, source: "cleo" });
    }
    setPendingTasks([]);
    toast.success(`${newTasks.length} task${newTasks.length>1?"s":""} added to your plan`);
    setMsgs(p => [...p, { role:"assistant", content:`Done! I've added ${newTasks.length > 1 ? "all of them" : "it"} to your plan. You'll find ${newTasks.length > 1 ? "them" : "it"} in the Plan tab.` }]);
  };

  const dismissTasks = () => {
    setPendingTasks([]);
    setMsgs(p => [...p, { role:"assistant", content:"No worries — I'll keep this in mind though." }]);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100svh - 152px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))", animation:"fadeUp .3s ease both" }}>

      {/* Header */}
      <header style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12, flexShrink:0 }}>
        <div aria-hidden="true" style={{ width:44, height:44, borderRadius:14, background:T.cleoBg, display:"grid", placeItems:"center" }}>
          <SparkleIcon size={22} color={T.action} filled />
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <h1 style={{ fontFamily:F.sans, fontSize:TYPE.section, fontWeight:700, color:T.text, margin:0 }}>Cleo</h1>
          <p style={{ fontFamily:F.sans, fontSize:TYPE.support, color:T.text2, margin:0 }}>
            {householdCtxStr ? "Knows your household" : "Your assistant"}
          </p>
        </div>
        <Button size="sm" variant="secondary" style={{ width:"auto" }}
          onClick={()=>{ setMsgs([]); setMemSuggestions([]); sessionStorage.removeItem(`cleo_session_${user?.uid}`); }}>
          New chat
        </Button>
      </header>

      {/* Messages */}
      <div role="log" aria-live="polite" style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch" as never }}>
        {msgs.map((m,i)=>{
          const mine = m.role==="user";
          const crisis = m.type==="crisis";
          return (
          <div key={i} style={{ display:"flex", justifyContent:mine?"flex-end":"flex-start", marginBottom:12 }}>
            <div style={{ maxWidth:"86%", display:"flex", flexDirection:"column", gap:6, alignItems:mine?"flex-end":"flex-start" }}>
              <div style={{
                background: mine ? T.text : crisis ? T.personalBg : T.surface,
                borderRadius: mine ? "20px 20px 6px 20px" : "20px 20px 20px 6px",
                padding: "12px 16px",
                boxShadow: mine ? "none" : "0 1px 2px rgba(28,61,90,0.05), 0 4px 14px rgba(28,61,90,0.05)",
              }}>
                {m.content.split("\n").filter(l=>l.trim()).map((line,j,arr)=>{
                  const parts = line.split(/\*\*(.*?)\*\*/g);
                  return (
                    <p key={j} style={{ fontFamily:F.sans, fontSize:TYPE.body, color:mine?T.onAction:T.text, margin:j===arr.length-1?0:"0 0 8px", lineHeight:1.5 }}>
                      {parts.map((part,pi) => pi%2===1 ? <strong key={pi}>{part}</strong> : part)}
                    </p>
                  );
                })}
              </div>

              {m.role==="assistant" && !crisis && i < msgs.length-1 && (
                <div style={{ display:"flex", gap:4 }}>
                  {(["up","down"] as const).map(kind=>(
                    <button key={kind} onClick={()=>saveFeedback(i,kind,m.content)} aria-pressed={feedback[i]===kind}
                      style={{ background:feedback[i]===kind?T.cleoBg:"none", border:"none", borderRadius:99, padding:"4px 10px", minHeight:32, fontFamily:F.sans, fontSize:13, fontWeight:600, color:feedback[i]===kind?T.action:T.text2, cursor:"pointer" }}>
                      {kind==="up" ? "Helpful" : "Not helpful"}
                    </button>
                  ))}
                </div>
              )}

              {m.type==="task-suggestion" && m.tasks && pendingTasks.length>0 && i===msgs.length-1 && (
                <div style={{ alignSelf:"stretch" }}>
                  <CleoActionCard state="waiting"
                    title={`Add ${pendingTasks.length > 1 ? `these ${pendingTasks.length} tasks` : "this task"} to Plan?`}
                    confirmLabel={pendingTasks.length > 1 ? "Add all" : "Add it"}
                    onConfirm={confirmTasks} onDecline={dismissTasks} />
                </div>
              )}
            </div>
          </div>
          );
        })}

        {!loading && <MemorySuggestionCard suggestions={memSuggestions} onAnswer={answerMemory} />}

        {loading && (
          <div role="status" aria-label="Cleo is thinking" style={{ display:"flex", marginBottom:12 }}>
            <div style={{ background:T.surface, borderRadius:"20px 20px 20px 6px", padding:"14px 18px", boxShadow:"0 1px 2px rgba(28,61,90,0.05)" }}>
              <div style={{ display:"flex", gap:5 }}>
                {[0,1,2].map(i=><div key={i} style={{ width:8, height:8, borderRadius:"50%", background:T.wisteria, animation:`breathe 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}
              </div>
            </div>
          </div>
        )}

        {msgs.length === 1 && !loading && (
          <div style={{ marginBottom:12 }}>
            <p style={{ fontFamily:F.sans, fontSize:TYPE.support, fontWeight:600, color:T.text2, margin:"4px 0 8px" }}>Try asking</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {QUICK_REPLIES.map(q=>(
                <button key={q} onClick={()=>send(q)} style={{ padding:"9px 14px", borderRadius:99, border:"none", background:T.cleoBg, fontFamily:F.sans, fontSize:14, fontWeight:600, color:T.action, cursor:"pointer", touchAction:"manipulation", minHeight:40 }}>{q}</button>
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{ paddingTop:10, flexShrink:0 }}>
        <div style={{ display:"flex", gap:8, alignItems:"flex-end", background:T.surface, borderRadius:24, padding:6, boxShadow:"0 2px 10px rgba(28,61,90,0.08)" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e=>{ setInput(e.target.value); e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,120)+"px"; }}
            onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); } }}
            placeholder="Message Cleo"
            aria-label="Message Cleo"
            rows={1}
            disabled={loading}
            style={{ flex:1, background:"transparent", border:"none", padding:"10px 8px 10px 12px", fontFamily:F.sans, fontSize:16, color:T.text, outline:"none", resize:"none", lineHeight:1.5, minHeight:44, WebkitOverflowScrolling:"touch" as never }}
          />
          <button onClick={startVoice} disabled={loading} aria-label={recording ? "Stop recording" : "Speak to Cleo"}
            style={{ width:44, height:44, borderRadius:22, background:recording?T.dangerBg:"transparent", border:"none", cursor:"pointer", flexShrink:0, touchAction:"manipulation", display:"grid", placeItems:"center" }}>
            {recording ? <StopIcon size={20} color={T.danger} filled /> : <MicIcon size={22} color={T.text2} />}
          </button>
          <button onClick={()=>send()} disabled={!input.trim()||loading} aria-label="Send"
            style={{ width:44, height:44, borderRadius:22, background:input.trim()?T.action:T.divider, border:"none", cursor:input.trim()?"pointer":"not-allowed", flexShrink:0, touchAction:"manipulation", display:"grid", placeItems:"center" }}>
            {loading?<Spinner size={16} color={T.onAction}/>:<ArrowUpIcon size={20} color={T.onAction} strokeWidth={2.4}/>}
          </button>
        </div>
      </div>
    </div>
  );
}
