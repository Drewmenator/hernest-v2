import React, { useState, useRef, useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { ai } from "../../core/ai";
import { Spinner } from "./index";
import { buildMemoryContext, extractFactsFromConversation, saveMemoryFacts } from "../../core/memory";
import { detectCrisis, CRISIS_RESPONSE } from "../../core/crisis";

interface Msg { role: "user" | "assistant"; content: string; }

export function CleoMini() {
  const { user, profile, familyMembers, activeTab } = useStore();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Record<number, "up"|"down">>({});
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const name = (profile as any)?.name || "lovely";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading]);

  useEffect(() => {
    if (open && msgs.length === 0) {
      setMsgs([{ role: "assistant", content: `Hi ${name} ✦ What do you need right now?` }]);
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  const saveFeedback = async (index: number, type: "up"|"down", content: string) => {
    setFeedback(p => ({ ...p, [index]: type }));
    if (!user?.uid) return;
    try {
      const { saveData, loadData } = await import("../../core/firebase");
      const existing = await loadData(user.uid, "cleo_feedback");
      const items = (existing?.items as any[]) || [];
      items.unshift({ type, content: content.slice(0, 200), timestamp: Date.now() });
      await saveData(user.uid, "cleo_feedback", { items: items.slice(0, 50) });
    } catch (e) { console.warn("[CleoMini] feedback save failed:", e); }
  };

  const startVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.lang = "en-GB";
    r.onstart = () => setRecording(true);
    r.onend = () => setRecording(false);
    r.onerror = () => setRecording(false);
    r.onresult = (e: any) => { const t = e.results[0][0].transcript; if (t.trim()) send(t.trim()); };
    r.start();
  };

  const send = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setMsgs(p => [...p, { role: "user", content: msg }]);
    setInput("");
    // Crisis check BEFORE any AI call — same safety net as the full screen
    if (detectCrisis(msg)) {
      setMsgs(p => [...p, { role: "assistant", content: CRISIS_RESPONSE }]);
      return;
    }
    setLoading(true);
    const familyRoster = familyMembers.length > 0
      ? "Family: " + familyMembers.map(m => `${m.name} (${m.role}${m.age ? ", age " + m.age : ""})`).join("; ")
      : "";
    const memCtx = user?.uid ? await buildMemoryContext(user.uid) : "";
    const sys = `You are Cleo, ${name}'s AI chief of staff. ${familyRoster}
${memCtx ? `Context: ${memCtx}` : ""}
Be concise — 2-3 sentences max. Warm, direct, actionable.`;
    const history = msgs.slice(-6).map(m => ({ role: m.role, content: m.content }));
    const result = await ai(sys, msg, "cleo_chat", history);
    const reply = result.error ? "I'm having a moment — try again." : result.text;
    setMsgs(p => {
      const updated = [...p, { role: "assistant" as const, content: reply }];
      // Extract facts fire-and-forget
      if (!result.error && user?.uid) {
        const uid = user.uid;
        extractFactsFromConversation(updated.slice(-6), uid).then(facts => {
          if (facts.length > 0) saveMemoryFacts(uid, facts);
        });
      }
      return updated;
    });
    setLoading(false);
  };

  const QUICK = ["What's most urgent?", "I'm overwhelmed", "What's for dinner?", "Help me focus"];

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div onClick={() => { setOpen(false); setMsgs([]); }}
          style={{ position:"fixed", inset:0, background:"rgba(46,31,20,0.4)", zIndex:199, backdropFilter:"blur(2px)" }}
        />
      )}

      {/* Sheet */}
      {open && (
        <div style={{
          position:"fixed", bottom:0, left:0, right:0,
          zIndex:200, background:"#fff", borderRadius:"24px 24px 0 0",
          boxShadow:"0 -8px 40px rgba(46,31,20,0.15)",
          animation:"slideUp .25s ease both",
          height:"85svh", display:"flex", flexDirection:"column",
        }}>
          {/* Handle */}
          <div style={{ display:"flex", justifyContent:"center", padding:"12px 0 4px" }}>
            <div style={{ width:36, height:4, borderRadius:2, background:T.linen }} />
          </div>

          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 16px 12px" }}>
            <div style={{ width:36, height:36, borderRadius:"50%", background:`linear-gradient(135deg,${T.gold},#8B6914)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>✦</div>
            <div style={{ flex:1 }}>
              <p style={{ fontFamily:F.sans, fontSize:14, fontWeight:700, color:T.esp, margin:0 }}>Cleo</p>
              <p style={{ fontFamily:F.sans, fontSize:11, color:T.sage, margin:0 }}>● Ready</p>
            </div>
            <button onClick={() => { setOpen(false); setMsgs([]); }} style={{ background:"none", border:`1px solid ${T.linen}`, borderRadius:10, padding:"5px 10px", fontFamily:F.sans, fontSize:11, color:T.taupe, cursor:"pointer" }}>Close</button>
          </div>

          {/* Messages */}
          <div style={{ flex:1, overflowY:"auto", padding:"0 16px", WebkitOverflowScrolling:"touch" as any }}>
            {msgs.map((m,i) => (
              <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start", marginBottom:8 }}>
                {m.role==="assistant" && (
                  <div style={{ width:26, height:26, borderRadius:"50%", background:`${T.gold}25`, display:"flex", alignItems:"center", justifyContent:"center", marginRight:6, flexShrink:0, alignSelf:"flex-end", fontSize:12 }}>✦</div>
                )}
                <div style={{ maxWidth:"80%", background:m.role==="user"?`linear-gradient(135deg,${T.esp},#4a3020)`:T.ivory, borderRadius:m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px", padding:"10px 14px", border:m.role==="assistant"?`1px solid ${T.linen}`:"none" }}>
                  <p style={{ fontFamily:F.sans, fontSize:13, color:m.role==="user"?"rgba(255,255,255,.9)":T.esp, margin:0, lineHeight:1.5 }}>{m.content}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                <div style={{ width:26, height:26, borderRadius:"50%", background:`${T.gold}25`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12 }}>✦</div>
                <div style={{ background:T.ivory, borderRadius:"16px 16px 16px 4px", padding:"10px 14px", border:`1px solid ${T.linen}` }}>
                  <div style={{ display:"flex", gap:3 }}>
                    {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:T.taupe, animation:`breathe 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}
                  </div>
                </div>
              </div>
            )}
            {msgs.length === 1 && !loading && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
                {QUICK.map(q => (
                  <button key={q} onClick={() => send(q)} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${T.linen}`, background:T.sand, fontFamily:F.sans, fontSize:11, color:T.bark, cursor:"pointer" }}>{q}</button>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ display:"flex", gap:8, padding:"12px 16px 8px", borderTop:`1px solid ${T.linen}` }}>
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key==="Enter" && send()} placeholder="Ask Cleo anything..."
              style={{ flex:1, background:T.ivory, border:`1.5px solid ${T.linen}`, borderRadius:14, padding:"11px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", minHeight:44 }}
            />
            <button onClick={startVoice} aria-label={recording ? "Stop voice input" : "Start voice input"} style={{ width:44, height:44, borderRadius:14, background:recording?T.blush:T.sand, border:`1px solid ${recording?T.blush:T.linen}`, color:recording?"#fff":T.taupe, fontSize:18, cursor:"pointer", flexShrink:0 }}>
              {recording?"⏹":"🎤"}
            </button>
            <button onClick={() => send()} disabled={!input.trim()||loading} aria-label="Send message" style={{ width:44, height:44, borderRadius:14, background:input.trim()?`linear-gradient(135deg,${T.esp},#4a2e18)`:T.linen, border:"none", color:"#fff", fontSize:16, cursor:input.trim()?"pointer":"not-allowed", flexShrink:0 }}>
              {loading?<Spinner size={14} color="#fff"/>:"→"}
            </button>
          </div>
        </div>
      )}

      {/* FAB */}
      {activeTab !== "cleo" && (
        <button onClick={() => setOpen(true)} aria-label="Chat with Cleo"
          style={{
            position:"fixed",
            bottom:`calc(88px + env(safe-area-inset-bottom, 0px))`,
            right:`max(20px, calc(50vw - 195px))`,
            width:52, height:52, borderRadius:"50%",
            background:recording?`linear-gradient(135deg,${T.blush},#c0392b)`:`linear-gradient(135deg,${T.gold},#8B6914)`,
            border:"none",
            boxShadow:recording?"0 4px 20px rgba(192,57,43,0.5)":"0 4px 20px rgba(212,165,84,0.5)",
            cursor:"pointer", zIndex:150,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:22, touchAction:"manipulation",
            animation:"breathe 3s ease-in-out infinite",
          }}
        >✦</button>
      )}
    </>
  );
}
