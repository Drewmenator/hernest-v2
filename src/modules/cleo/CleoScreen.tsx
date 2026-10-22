import { useState, useEffect, useRef } from "react";
import { trackEvent } from "../../core/analytics";
import { T, F, TYPE, ATMOS, ATMOS_TEXT2, SHADOWS, alpha } from "../../config/theme";
import { useStore, type HouseholdSnapshot } from "../../core/store";
import { todayLocal } from "../../core/dateAwareness";
import { Spinner, CleoActionCard, GlowCard, Headline, Detail } from "../../shared/components";
import { Target, HeartHandshake, Wallet, CalendarDays, MessageCircleHeart, SquarePen, ThumbsUp, ThumbsDown } from "lucide-react";
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
  { text: "What should I focus on today?", Icon: Target },
  { text: "I'm feeling overwhelmed", Icon: HeartHandshake },
  { text: "Are we on track financially?", Icon: Wallet },
  { text: "Help me plan my week", Icon: CalendarDays },
  { text: "I need to vent", Icon: MessageCircleHeart },
];

// The household snapshot (trip countdown, calendar load) is reused for 10
// minutes on the same local day, then rebuilt.
const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
function snapshotIsFresh(snap: HouseholdSnapshot, now: Date = new Date()): boolean {
  const built = new Date(snap.lastRefreshed);
  if (Number.isNaN(built.getTime())) return false;
  const age = now.getTime() - built.getTime();
  return age >= 0 && age < SNAPSHOT_MAX_AGE_MS && todayLocal(built) === todayLocal(now);
}

// The chat kept for this app session, tagged with the local day it was saved.
// Older saves were a plain list of messages with no day, so they count as stale.
interface SavedSession { date: string; msgs: Msg[] }
function readSavedSession(raw: string | null, today: string = todayLocal()): Msg[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SavedSession | Msg[] | null;
    if (!parsed || Array.isArray(parsed)) return null;
    return parsed.date === today && Array.isArray(parsed.msgs) && parsed.msgs.length ? parsed.msgs : null;
  } catch { return null; }
}

// Cleo's mark: the sparkle inside a soft halo of light. Large in the
// opening hero, small beside her messages.
function CleoMark({ size = 32 }: { size?: number }) {
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
      background: `radial-gradient(circle at 35% 30%, ${T.glassStrong} 0%, ${alpha(ATMOS.cleo.chart, 0.28)} 55%, ${alpha(ATMOS.cleo.chart, 0.12)} 100%)`,
      boxShadow: `0 0 0 1px ${alpha(ATMOS.cleo.chart, 0.25)}, 0 ${Math.round(size / 6)}px ${Math.round(size / 2)}px ${alpha(ATMOS.cleo.chart, 0.30)}`,
    }}>
      <SparkleIcon size={Math.round(size * 0.5)} color={ATMOS.cleo.ink} filled />
    </span>
  );
}

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

  const name = String((profile as any)?.name || "").trim().split(/\s+/)[0] || "there";

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

  // The saved snapshot is reused only while fresh (see snapshotIsFresh), so
  // a trip countdown or a busy week doesn't go stale over days. Both effects
  // below share one rebuild.
  const snapBuild = useRef<Promise<HouseholdSnapshot> | null>(null);
  const freshSnapshot = (uid: string): Promise<HouseholdSnapshot> => {
    if (householdSnapshot && snapshotIsFresh(householdSnapshot)) return Promise.resolve(householdSnapshot);
    if (!snapBuild.current) {
      snapBuild.current = buildHouseholdSnapshot(uid)
        .then(snap => { setHouseholdSnapshot(snap); return snap; })
        .finally(() => { snapBuild.current = null; });
    }
    return snapBuild.current;
  };

  // ── Load household context on mount ──────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;

    // Use the saved snapshot while it's fresh, otherwise build a new one
    const buildCtx = async () => {
      try {
        const snap = await freshSnapshot(user.uid);

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
  // Only today's chat comes back; yesterday's (and its "Good morning") is dropped.
  useEffect(() => {
    const key = `cleo_session_${user?.uid}`;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(key); } catch { /* private mode */ }
    const restored = readSavedSession(saved);
    if (restored) { setMsgs(restored); return; }
    if (saved) { try { sessionStorage.removeItem(key); } catch { /* private mode */ } }
    // Build proactive opening based on household state
    const buildProactiveOpening = async () => {
      try {
        const snap = await freshSnapshot(user?.uid || "");
        const observations: string[] = [];

        // Check stress level
        if (snap?.householdStressLevel === "high") {
          observations.push("Things look pretty full right now. I want to make sure you're not carrying too much alone.");
        }

        // Check calendar load
        if (snap?.calendarLoad === "critical" || snap?.calendarLoad === "heavy") {
          observations.push(`Your calendar looks ${snap.calendarLoad} this week. Want me to help you simplify or prioritize?`);
        }

        // Check upcoming trip
        if (snap?.upcomingTrip) {
          const { name: dest, daysUntil } = snap.upcomingTrip;
          observations.push(`${dest} is ${daysUntil} day${daysUntil === 1 ? "" : "s"} away. Anything left to sort before you go?`);
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

  // Follow the conversation; the opening hero stays at the top. Scrolls
  // only the message list (scrollIntoView would also move the page).
  useEffect(() => {
    if (msgs.length <= 1 && !loading) return;
    const log = bottomRef.current?.parentElement;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  }, [msgs, loading, memSuggestions.length]);

  useEffect(() => {
    if (user?.uid && msgs.length > 1) {
      try {
        sessionStorage.setItem(`cleo_session_${user.uid}`, JSON.stringify({ date: todayLocal(), msgs } satisfies SavedSession));
      } catch { /* private mode or full */ }
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

  // The opening: Cleo's greeting as a hero until the conversation starts.
  const opening = msgs.length <= 1 && !loading && msgs.every(m => m.role === "assistant");
  const openingText = msgs[0]?.content || `Good ${getTimeOfDay()}, ${name}.\n\nWhat's on your mind today?`;
  const [openLine, ...openRest] = openingText.split("\n").filter(l => l.trim());
  const newChat = () => { setMsgs([]); setMemSuggestions([]); sessionStorage.removeItem(`cleo_session_${user?.uid}`); };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100svh - 152px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))", animation:"fadeUp .3s ease both" }}>

      {/* Header */}
      <header style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14, flexShrink:0 }}>
        <CleoMark size={40} />
        <div style={{ flex:1, minWidth:0 }}>
          <h1 style={{ fontFamily:F.display, fontSize:26, fontWeight:500, letterSpacing:"-0.015em", color:T.text, margin:0, lineHeight:1.1 }}>Cleo</h1>
          <p style={{ fontFamily:F.sans, fontSize:TYPE.meta + 1, color:T.text2, margin:"2px 0 0" }}>
            {householdCtxStr ? "Knows your household" : "Your assistant"}
          </p>
        </div>
        {!opening && (
          <button onClick={newChat}
            style={{ display:"inline-flex", alignItems:"center", gap:6, minHeight:40, padding:"0 14px", borderRadius:99, border:`1px solid ${T.glass}`, background:T.frost, backdropFilter:"blur(16px)", WebkitBackdropFilter:"blur(16px)", fontFamily:F.sans, fontSize:14, fontWeight:600, color:T.text, cursor:"pointer", touchAction:"manipulation", boxShadow:SHADOWS.sm }}>
            <SquarePen size={16} strokeWidth={1.9} aria-hidden="true" /> New chat
          </button>
        )}
      </header>

      {/* Messages */}
      <div role="log" aria-live="polite" style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch" as never, padding:"2px 2px 0" }}>
        {opening ? (
          <GlowCard tint="cleo" reveal={false} style={{ padding:"24px 20px 20px" }}>
            <CleoMark size={56} />
            <Headline size={27} style={{ marginTop:16 }}>{openLine}</Headline>
            {openRest.map((l, i) => <Detail key={i} style={{ fontSize:TYPE.body, marginTop:8 }}>{l}</Detail>)}
            <p style={{ fontFamily:F.sans, fontSize:TYPE.support, fontWeight:600, color:ATMOS_TEXT2, margin:"20px 0 10px" }}>Try asking</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {QUICK_REPLIES.map(({ text, Icon })=>(
                <button key={text} onClick={()=>send(text)}
                  style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"0 14px", borderRadius:99, border:`1px solid ${T.glass}`, background:T.glassStrong, fontFamily:F.sans, fontSize:14, fontWeight:600, color:T.text, cursor:"pointer", touchAction:"manipulation", minHeight:44 }}>
                  <Icon size={16} color={ATMOS.cleo.ink} strokeWidth={1.9} aria-hidden="true" />{text}
                </button>
              ))}
            </div>
          </GlowCard>
        ) : msgs.map((m,i)=>{
          const mine = m.role==="user";
          const crisis = m.type==="crisis";
          // Cleo's mark sits beside the first of her messages in a row.
          const firstOfRun = !mine && (i === 0 || msgs[i-1].role !== "assistant");
          return (
          <div key={i} style={{ display:"flex", justifyContent:mine?"flex-end":"flex-start", alignItems:"flex-end", gap:8, marginBottom:12 }}>
            {!mine && <span style={{ width:28, flexShrink:0, alignSelf:"flex-start", marginTop:2 }}>{firstOfRun && <CleoMark size={28} />}</span>}
            <div style={{ maxWidth:"84%", display:"flex", flexDirection:"column", gap:6, alignItems:mine?"flex-end":"flex-start" }}>
              <div style={{
                background: mine ? T.action : crisis ? T.personalBg : T.surface,
                border: mine ? "none" : `1px solid ${crisis ? alpha(T.personalInk, 0.2) : T.hairline}`,
                borderRadius: mine ? "22px 22px 8px 22px" : "8px 22px 22px 22px",
                padding: "12px 16px",
                boxShadow: mine ? `0 6px 16px -8px ${alpha(T.action, 0.6)}` : SHADOWS.sm,
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
                  {(["up","down"] as const).map(kind=>{
                    const on = feedback[i]===kind;
                    const Icon = kind==="up" ? ThumbsUp : ThumbsDown;
                    return (
                      <button key={kind} onClick={()=>saveFeedback(i,kind,m.content)} aria-pressed={on}
                        style={{ display:"inline-flex", alignItems:"center", gap:5, background:on?T.cleoBg:"none", border:"none", borderRadius:99, padding:"4px 10px", minHeight:32, fontFamily:F.sans, fontSize:12, fontWeight:600, color:on?T.action:T.text2, cursor:"pointer" }}>
                        <Icon size={13} strokeWidth={2} aria-hidden="true" />{kind==="up" ? "Helpful" : "Not helpful"}
                      </button>
                    );
                  })}
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
          <div role="status" aria-label="Cleo is thinking" style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
            <CleoMark size={28} />
            <div style={{ background:T.surface, border:`1px solid ${T.hairline}`, borderRadius:"8px 22px 22px 22px", padding:"14px 18px", boxShadow:SHADOWS.sm }}>
              <div style={{ display:"flex", gap:6 }}>
                {[0,1,2].map(i=><div key={i} style={{ width:8, height:8, borderRadius:"50%", background:ATMOS.cleo.chart, opacity:0.75, animation:`breathe 1.4s ease-in-out ${i*0.22}s infinite` }}/>)}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{ paddingTop:10, flexShrink:0 }}>
        <div style={{ display:"flex", gap:6, alignItems:"flex-end", background:T.frost, backdropFilter:"blur(22px) saturate(170%)", WebkitBackdropFilter:"blur(22px) saturate(170%)", border:`1px solid ${T.glass}`, borderRadius:28, padding:6, boxShadow:`0 1px 0 ${T.glassStrong} inset, ${SHADOWS.md}` }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e=>{ setInput(e.target.value); e.target.style.height="auto"; e.target.style.height=Math.min(e.target.scrollHeight,120)+"px"; }}
            onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); } }}
            placeholder="Message Cleo"
            aria-label="Message Cleo"
            rows={1}
            disabled={loading}
            style={{ flex:1, background:"transparent", border:"none", padding:"10px 8px 10px 14px", fontFamily:F.sans, fontSize:16, color:T.text, outline:"none", resize:"none", lineHeight:1.5, minHeight:44, WebkitOverflowScrolling:"touch" as never }}
          />
          <button onClick={startVoice} disabled={loading} aria-label={recording ? "Stop recording" : "Speak to Cleo"}
            style={{ width:44, height:44, borderRadius:22, background:recording?T.dangerBg:"transparent", border:"none", cursor:"pointer", flexShrink:0, touchAction:"manipulation", display:"grid", placeItems:"center" }}>
            {recording ? <StopIcon size={20} color={T.danger} filled /> : <MicIcon size={22} color={T.text2} />}
          </button>
          <button onClick={()=>send()} disabled={!input.trim()||loading} aria-label="Send"
            style={{ width:44, height:44, borderRadius:22, background:input.trim()?`linear-gradient(160deg, ${T.action}, ${T.actionPress})`:T.divider, border:"none", cursor:input.trim()?"pointer":"not-allowed", flexShrink:0, touchAction:"manipulation", display:"grid", placeItems:"center", boxShadow:input.trim()?SHADOWS.gold:"none", transition:"background .2s" }}>
            {loading?<Spinner size={16} color={T.onAction}/>:<ArrowUpIcon size={20} color={input.trim()?T.onAction:T.text2} strokeWidth={2.4}/>}
          </button>
        </div>
      </div>
    </div>
  );
}
