import React, { useState, useEffect, useRef } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, HeroCard, Pill, Button, Input, AIBadge, Spinner } from "../../shared/components";
import { saveData, loadData } from "../../core/firebase";
import { ai } from "../../core/ai";
import { bus } from "../../core/events";
import toast from "react-hot-toast";

// ── Types per blueprint ────────────────────────────────────────────
interface Contact {
  id: string; name: string;
  relationship: "partner"|"child"|"parent"|"sibling"|"friend"|"colleague"|"other";
  closeness: "inner"|"middle"|"outer";
  birthday?: string; age?: number;
  interests?: string[];
  contactFrequency: "daily"|"weekly"|"biweekly"|"monthly"|"quarterly";
  preferredMethod: "call"|"text"|"voice-note"|"in-person";
  lastInteraction?: { date: string; type: string; notes?: string };
  giftHistory?: { occasion: string; gift: string; year: number; reaction?: "loved"|"liked"|"neutral" }[];
  emoji?: string; notes?: string; createdAt: number;
}

interface ChatMsg { role: "user"|"assistant"; content: string; }

// ── AI Companions per blueprint ────────────────────────────────────
const COMPANIONS = [
  {
    id:"priya", name:"Priya", avatar:"🌺", style:"warm",
    personality:"Warm, practical, South Asian mum of two. Speaks from experience.",
    background:"Former teacher, now runs a small business. Believes in doing your best, not being the best.",
    values:["family","honesty","resilience","laughter"],
    opening:"Hi love. I'm Priya — AI companion, not a real person, but I'm here with a listening ear. What's on your mind?",
  },
  {
    id:"sophie", name:"Sophie", avatar:"🌿", style:"gentle",
    personality:"Gentle, reflective, Northern European. Believes in slow living.",
    background:"Forest school leader, three kids. Finds wisdom in nature and quiet moments.",
    values:["presence","nature","simplicity","connection"],
    opening:"Hello. I'm Sophie, an AI companion. Take a breath with me. What's feeling heavy today?",
  },
  {
    id:"amara", name:"Amara", avatar:"☀️", style:"direct",
    personality:"Direct, energetic, West African. No-nonsense with deep warmth.",
    background:"Nurse, mother of four. Believes in speaking truth with love.",
    values:["strength","community","honesty","joy"],
    opening:"Hey. I'm Amara — AI companion. Let's talk straight: what's really going on?",
  },
  {
    id:"mei", name:"Mei", avatar:"🌙", style:"wise",
    personality:"Thoughtful, analytical, East Asian. Finds patterns in chaos.",
    background:"Engineer turned writer. Two kids, loves systems and stories.",
    values:["growth","curiosity","balance","integrity"],
    opening:"Hi. I'm Mei, an AI companion. I find that naming things helps. What would you like to explore?",
  },
];

// ── Frequency to days per blueprint ───────────────────────────────
const FREQ_DAYS: Record<string,number> = { daily:2, weekly:10, biweekly:18, monthly:35, quarterly:100 };

const daysSince = (date?: string) => {
  if (!date) return 999;
  return Math.floor((Date.now() - (isNaN(new Date(date||"").getTime())?Date.now():new Date(date).getTime())) / (1000*60*60*24));
};

const daysUntilBirthday = (birthday?: string) => {
  if (!birthday) return null;
  const today = new Date();
  const yr = today.getFullYear();
  const [m,d] = birthday.split("-").map(Number);
  const next = new Date(yr, (m||1)-1, d||1);
  if (next < today) next.setFullYear(yr+1);
  return Math.ceil((next.getTime() - today.getTime()) / (1000*60*60*24));
};

// ── Suggested actions per blueprint ───────────────────────────────
function suggestAction(contact: Contact): string {
  const days = daysSince(contact.lastInteraction?.date);
  const bday = daysUntilBirthday(contact.birthday);
  if (bday !== null && bday <= 7)  return `🎂 ${contact.name}'s birthday in ${bday} days — plan now`;
  if (bday !== null && bday <= 14) return `🎁 ${contact.name}'s birthday coming — think of a gift`;
  if (days > 30) return `Send a voice note — ${days} days since last contact`;
  if (days > 14) return `Share a photo from this week`;
  if (days > 7)  return `Quick "thinking of you" text`;
  return "";
}

const CLOSENESS_COLORS: Record<string,string> = { inner:T.gold, middle:T.sage, outer:T.taupe };
const RELATIONSHIP_EMOJIS: Record<string,string> = { partner:"💑", child:"🧒", parent:"👩", sibling:"👫", friend:"💛", colleague:"🤝", other:"👤" };

export function CircleScreen() {
  const { user, profile } = useStore();
  const [tab, setTab]         = useState("circle");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact|null>(null);
  const [giftLoading, setGiftLoading] = useState(false);
  const [giftFor, setGiftFor] = useState<string>("");
  const [giftIdeas, setGiftIdeas] = useState<string>("");
  const [activeCompanion, setActiveCompanion] = useState<typeof COMPANIONS[0]|null>(null);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Add form state
  const [newName, setNewName]         = useState("");
  const [newRel, setNewRel]           = useState<Contact["relationship"]>("friend");
  const [newCloseness, setNewCloseness] = useState<Contact["closeness"]>("middle");
  const [newBirthday, setNewBirthday] = useState("");
  const [newFreq, setNewFreq]         = useState<Contact["contactFrequency"]>("monthly");
  const [newMethod, setNewMethod]     = useState<Contact["preferredMethod"]>("text");
  const [newEmoji, setNewEmoji]       = useState("👩");
  const [newNotes, setNewNotes]       = useState("");

  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "circle").then(d => { if(d?.contacts) setContacts(d.contacts as Contact[]); });
  }, [user?.uid]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [chatMsgs]);

  const persist = async (updated: Contact[]) => {
    setContacts(updated);
    if (user?.uid) await saveData(user.uid, "circle", { contacts: updated });
  };

  // ── Add contact ───────────────────────────────────────────────────
  const addContact = async () => {
    if (!newName.trim()) return;
    const contact: Contact = {
      id: crypto.randomUUID(), name: newName.trim(),
      relationship: newRel, closeness: newCloseness,
      birthday: newBirthday || undefined,
      contactFrequency: newFreq, preferredMethod: newMethod,
      emoji: newEmoji, notes: newNotes || undefined,
      createdAt: Date.now(),
    };
    const updated = [contact, ...contacts];
    await persist(updated);
    await bus.publish("circle.contact.added", contact, { userId: user!.uid, source: "circle" });
    setNewName(""); setNewBirthday(""); setNewNotes(""); setShowAdd(false);
    toast.success(`${newName} added to your circle ✓`);
  };

  // ── Log interaction per blueprint ─────────────────────────────────
  const logInteraction = async (id: string, type: string) => {
    const updated = contacts.map(c => c.id===id ? { ...c, lastInteraction:{ date:new Date().toISOString().split("T")[0], type } } : c);
    await persist(updated);
    toast.success(`Logged as ${type} ✓`);
  };

  // ── Gift advisor per blueprint ────────────────────────────────────
  const generateGiftIdeas = async (contact: Contact) => {
    setGiftFor(contact.name);
    setGiftIdeas(""); setGiftLoading(true);
    setTab("circle");

    const history = contact.giftHistory?.filter(g=>g.reaction==="loved").map(g=>g.gift).join(", ") || "";
    const interests = contact.interests?.join(", ") || "";

    const sys = `You are Nora, a thoughtful gift advisor inside HerNest. You know this household well — suggest gifts that feel personal, not generic.
Generate 5 specific, personal gift ideas with prices. Format as numbered list with brief "why" for each.
Be specific — not generic. Think about their personality and history.`;

    const prompt = `Gift ideas for ${contact.name} (${contact.age||"unknown age"}, ${contact.relationship}). Budget consciousness: moderate. Occasion: ${contact.birthday && daysUntilBirthday(contact.birthday) !== null && (daysUntilBirthday(contact.birthday) ?? 999) <= 30 ? "upcoming birthday" : "general"}. Their interests: ${contact.notes || "not specified"}.
${interests?"Interests: "+interests+".":""}
${history?"Previously loved gifts: "+history+".":""}
Budget: flexible but thoughtful.`;

    const result = await ai(sys, prompt, "gift_advisor");
    if (!result.error) setGiftIdeas(result.text);
    else setGiftIdeas("Couldn't generate ideas — please try again.");
    setGiftLoading(false);
  };

  // ── AI Companion chat per blueprint ───────────────────────────────
  const startCompanion = (companion: typeof COMPANIONS[0]) => {
    setActiveCompanion(companion);
    setChatMsgs([{ role:"assistant", content:companion.opening }]);
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading || !activeCompanion) return;
    const userMsg: ChatMsg = { role:"user", content:chatInput };
    setChatMsgs(p=>[...p,userMsg]);
    setChatInput("");
    setChatLoading(true);

    const sys = `You are ${activeCompanion.name}, an AI companion for mothers inside HerNest.
PERSONALITY: ${activeCompanion.personality}
BACKGROUND: ${activeCompanion.background}
VALUES: ${activeCompanion.values.join(", ")}
STYLE: ${activeCompanion.style}

CRITICAL RULES:
1. You are AI — if asked, confirm clearly. Never pretend to be human.
2. NEVER give medical, legal, or financial advice.
3. If user is in crisis, suggest professional help gently.
4. Keep responses warm and concise (2-3 short paragraphs max).
5. Validate feelings before offering perspective.
6. Ask ONE question at a time.
7. Use your character's unique voice consistently.`;

    const history = chatMsgs.slice(-8).map(m => ({ role:m.role==="assistant"?"assistant":"user", content:m.content }));
    const result = await ai(sys, chatInput, "circle_match", history);

    setChatMsgs(p=>[...p,{
      role:"assistant",
      content: result.error ? "I'm having a moment — please try again." : result.text
    }]);
    setChatLoading(false);
  };

  // ── Compute contact intelligence ──────────────────────────────────
  const allPeople = [
    // From profile
    ...((profile as any)?.kids||[]).map((k:any) => ({
      id:`kid-${k.id||k.name}`, name:k.name, relationship:"child" as const,
      closeness:"inner" as const, birthday:k.birthday, contactFrequency:"daily" as const,
      preferredMethod:"in-person" as const, emoji:"🧒", createdAt:0,
    })),
    ...((profile as any)?.parents||[]).map((p:any) => ({
      id:`parent-${p.name}`, name:p.name, relationship:"parent" as const,
      closeness:"inner" as const, birthday:p.birthday, contactFrequency:"weekly" as const,
      preferredMethod:"call" as const, emoji:"👩", createdAt:0,
    })),
    ...contacts
  ];

  // Publish checkin due events for overdue contacts
  useEffect(() => {
    if (!user?.uid) return;
    const overdue = allPeople.filter(c => {
      const days = daysSince(c.lastInteraction?.date);
      return days !== null && days > 14;
    });
    overdue.forEach(c => {
      const days = daysSince(c.lastInteraction?.date);
      bus.publish("circle.checkin.due", { contact: c.name, daysSince: days }, { userId: user.uid, source: "circle" });
    });
  }, [allPeople.length, user?.uid]);

  const checkinDue = allPeople.filter(c => {
    const days = daysSince(c.lastInteraction?.date);
    const freqDays = FREQ_DAYS[c.contactFrequency] || 30;
    return days > freqDays;
  }).sort((a,b) => daysSince(b.lastInteraction?.date) - daysSince(a.lastInteraction?.date));

  const upcomingBirthdays = allPeople.filter(c => {
    const du = daysUntilBirthday(c.birthday);
    return du !== null && du <= 30;
  }).sort((a,b) => (daysUntilBirthday(a.birthday)||999) - (daysUntilBirthday(b.birthday)||999));

  // Companion chat view
  if (activeCompanion) {
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"calc(100svh - 90px)", animation:"fadeUp .3s ease both" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12, flexShrink:0 }}>
          <button onClick={()=>setActiveCompanion(null)} style={{ background:"none", border:"none", fontFamily:F.sans, fontSize:13, color:T.taupe, cursor:"pointer", padding:"8px 0", minHeight:44 }}>←</button>
          <div style={{ width:44, height:44, borderRadius:"50%", background:`linear-gradient(135deg,${T.gold},#8B6914)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>{activeCompanion.avatar}</div>
          <div>
            <p style={{ fontFamily:F.sans, fontSize:15, fontWeight:700, color:T.esp, margin:0 }}>{activeCompanion.name}</p>
            <p style={{ fontFamily:F.sans, fontSize:11, color:T.gold, margin:"2px 0 0" }}>✦ AI Companion — not a real person</p>
          </div>
        </div>

        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch" as any, marginBottom:12 }}>
          {chatMsgs.map((m,i)=>(
            <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start", marginBottom:10 }}>
              {m.role==="assistant" && <div style={{ width:36, height:36, borderRadius:"50%", background:`linear-gradient(135deg,${T.gold}30,${T.esp}20)`, display:"flex", alignItems:"center", justifyContent:"center", marginRight:8, flexShrink:0, alignSelf:"flex-end", fontSize:20 }}>{activeCompanion.avatar}</div>}
              <div style={{ maxWidth:"82%", background:m.role==="user"?`linear-gradient(135deg,${T.esp},#4a3020)`:"#fff", borderRadius:m.role==="user"?"20px 20px 4px 20px":"20px 20px 20px 4px", padding:"12px 16px", border:m.role==="assistant"?`1px solid ${T.linen}`:"none" }}>
                {m.content.split("\n").filter(l=>l.trim()).map((line,j)=>(
                  <p key={j} style={{ fontFamily:F.sans, fontSize:13, color:m.role==="user"?"rgba(255,255,255,.9)":T.esp, margin:"0 0 5px", lineHeight:1.6 }}>{line}</p>
                ))}
              </div>
            </div>
          ))}
          {chatLoading && <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:10 }}>
            <div style={{ width:36, height:36, borderRadius:"50%", background:`linear-gradient(135deg,${T.gold}30,${T.esp}20)`, display:"flex", alignItems:"center", justifyContent:"center", marginRight:8, fontSize:20 }}>{activeCompanion.avatar}</div>
            <div style={{ background:"#fff", borderRadius:"20px 20px 20px 4px", padding:"12px 16px", border:`1px solid ${T.linen}` }}><Spinner size={16}/></div>
          </div>}
          <div ref={bottomRef}/>
        </div>

        <div style={{ borderTop:`1px solid ${T.linen}`, paddingTop:10, flexShrink:0, display:"flex", gap:8 }}>
          <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder={`Talk to ${activeCompanion.name}...`} style={{ flex:1, background:T.ivory, border:`1.5px solid ${T.linen}`, borderRadius:14, padding:"12px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", minHeight:48 }}/>
          <button onClick={sendChat} disabled={!chatInput.trim()||chatLoading} style={{ width:48, height:48, borderRadius:14, background:chatInput.trim()?T.esp:T.linen, border:"none", color:"#fff", fontSize:18, cursor:chatInput.trim()?"pointer":"not-allowed", flexShrink:0, touchAction:"manipulation" }}>→</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="RELATIONSHIPS" title="My Circle"/>

      {/* Birthday alerts */}
      {upcomingBirthdays.length > 0 && (
        <div style={{ background:`linear-gradient(135deg,${T.blush}15,${T.gold}10)`, border:`1px solid ${T.blush}30`, borderRadius:16, padding:"12px 16px", marginBottom:12 }}>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.blush, margin:"0 0 8px" }}>🎂 UPCOMING BIRTHDAYS</p>
          {upcomingBirthdays.map(c=>(
            <div key={c.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"3px 0" }}>
              <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{c.emoji||"👩"} {c.name}</p>
              <span style={{ fontFamily:F.sans, fontSize:12, color:T.blush, fontWeight:600 }}>in {daysUntilBirthday(c.birthday)} days</span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:16, overflowX:"auto", paddingBottom:4 }}>
        {["circle","companions"].map(t=>(
          <Pill key={t} label={t==="circle"?"My Circle":"✦ AI Companions"} active={tab===t} onClick={()=>setTab(t)}/>
        ))}
      </div>

      {/* ── MY CIRCLE ─────────────────────────────────────────────── */}
      {tab==="circle" && <>
        <Button onClick={()=>setShowAdd(!showAdd)} variant="secondary" style={{ marginBottom:12 }}>+ Add to Circle</Button>

        {/* Add form per blueprint */}
        {showAdd && <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>ADD SOMEONE</p>

          {/* Emoji picker */}
          <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
            {["👩","👱","👩‍💼","👩‍🦰","🧒","👨","👵","🧑"].map(e=>(
              <button key={e} onClick={()=>setNewEmoji(e)} style={{ fontSize:24, background:newEmoji===e?T.goldP:"transparent", border:`2px solid ${newEmoji===e?T.gold:T.linen}`, borderRadius:10, padding:"6px 8px", cursor:"pointer", touchAction:"manipulation" }}>{e}</button>
            ))}
          </div>

          <Input value={newName} onChange={setNewName} placeholder="Name" style={{ marginBottom:8 }}/>

          {/* Relationship */}
          <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 6px" }}>Relationship</p>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
            {(["partner","child","parent","sibling","friend","colleague","other"] as const).map(r=>(
              <button key={r} onClick={()=>setNewRel(r)} style={{ padding:"6px 10px", borderRadius:20, border:`1.5px solid ${newRel===r?T.esp:T.linen}`, background:newRel===r?T.esp:"#fff", color:newRel===r?"#fff":T.bark, fontFamily:F.sans, fontSize:11, cursor:"pointer", touchAction:"manipulation" }}>{RELATIONSHIP_EMOJIS[r]} {r}</button>
            ))}
          </div>

          {/* Closeness per blueprint */}
          <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 6px" }}>Closeness</p>
          <div style={{ display:"flex", gap:6, marginBottom:8 }}>
            {(["inner","middle","outer"] as const).map(c=>(
              <button key={c} onClick={()=>setNewCloseness(c)} style={{ flex:1, padding:"8px", borderRadius:12, border:`1.5px solid ${newCloseness===c?CLOSENESS_COLORS[c]:T.linen}`, background:newCloseness===c?`${CLOSENESS_COLORS[c]}15`:"#fff", color:newCloseness===c?CLOSENESS_COLORS[c]:T.bark, fontFamily:F.sans, fontSize:11, cursor:"pointer", touchAction:"manipulation" }}>
                {c==="inner"?"❤ Inner":c==="middle"?"🟡 Middle":"⭕ Outer"}
              </button>
            ))}
          </div>

          {/* Contact frequency per blueprint */}
          <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 6px" }}>How often to connect</p>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
            {(["daily","weekly","biweekly","monthly","quarterly"] as const).map(f=>(
              <button key={f} onClick={()=>setNewFreq(f)} style={{ padding:"5px 10px", borderRadius:20, border:`1.5px solid ${newFreq===f?T.sage:T.linen}`, background:newFreq===f?`${T.sage}15`:"#fff", color:newFreq===f?T.sage:T.bark, fontFamily:F.sans, fontSize:11, cursor:"pointer" }}>{f}</button>
            ))}
          </div>

          {/* Preferred method per blueprint */}
          <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 6px" }}>Preferred contact method</p>
          <div style={{ display:"flex", gap:6, marginBottom:10 }}>
            {(["call","text","voice-note","in-person"] as const).map(m=>(
              <button key={m} onClick={()=>setNewMethod(m)} style={{ flex:1, padding:"6px 4px", borderRadius:10, border:`1.5px solid ${newMethod===m?T.sky:T.linen}`, background:newMethod===m?T.skyP:"#fff", color:newMethod===m?T.sky:T.bark, fontFamily:F.sans, fontSize:10, cursor:"pointer", touchAction:"manipulation", textAlign:"center" }}>
                {m==="call"?"📞":m==="text"?"💬":m==="voice-note"?"🎤":"🤝"} {m}
              </button>
            ))}
          </div>

          <input type="date" value={newBirthday} onChange={e=>setNewBirthday(e.target.value)} placeholder="Birthday (optional)" style={{ width:"100%", background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"11px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", marginBottom:8, boxSizing:"border-box", minHeight:44 }}/>
          <Input value={newNotes} onChange={setNewNotes} placeholder="Notes (optional)" style={{ marginBottom:12 }}/>

          <div style={{ display:"flex", gap:8 }}>
            <Button onClick={addContact} disabled={!newName.trim()} variant="gold" style={{ flex:1 }}>Add</Button>
            <Button onClick={()=>setShowAdd(false)} variant="ghost" style={{ flex:1 }}>Cancel</Button>
          </div>
        </Card>}

        {/* Gift ideas result */}
        {giftFor && (
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:0 }}>🎁 GIFT IDEAS FOR {giftFor.toUpperCase()}</p>
              <button onClick={()=>{ setGiftFor(""); setGiftIdeas(""); }} style={{ background:"none", border:"none", color:T.taupe, cursor:"pointer", fontSize:18, minHeight:36 }}>×</button>
            </div>
            {giftLoading ? <div style={{ display:"flex", justifyContent:"center", padding:"16px 0" }}><Spinner size={20}/></div> :
              giftIdeas.split("\n").filter(l=>l.trim()).map((line,i)=>(
                <p key={i} style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:"0 0 8px", lineHeight:1.6 }}>{line}</p>
              ))
            }
          </Card>
        )}

        {/* Check-ins due per blueprint intelligence */}
        {checkinDue.filter(c=>(daysSince(c.lastInteraction?.date)||999)>14).length>0 && (
          <div style={{ marginBottom:12 }}>
            <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 8px" }}>DUE FOR CHECK-IN</p>
            {checkinDue.filter(c=>(daysSince(c.lastInteraction?.date)||999)>14).map(c=>{
              const suggestion = suggestAction(c as Contact);
              const days = daysSince(c.lastInteraction?.date);
              return (
                <div key={c.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", background:T.ivory, borderRadius:16, border:`1.5px solid ${T.blush}30`, marginBottom:8 }}>
                  <div style={{ width:44, height:44, borderRadius:"50%", background:`linear-gradient(135deg,${CLOSENESS_COLORS[(c as Contact).closeness]}30,${T.linen})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{c.emoji||RELATIONSHIP_EMOJIS[c.relationship]||"👩"}</div>
                  <div style={{ flex:1 }}>
                    <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>{c.name}</p>
                    <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"2px 0 2px" }}>{c.relationship} · {days<999?`${days}d ago`:"Never contacted"}</p>
                    {suggestion && <p style={{ fontFamily:F.sans, fontSize:11, color:T.gold, margin:0, fontStyle:"italic" }}>{suggestion}</p>}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                    <button onClick={()=>logInteraction(c.id,(c as Contact).preferredMethod)} style={{ background:T.sage, color:"#fff", border:"none", borderRadius:8, padding:"5px 10px", fontFamily:F.sans, fontSize:11, cursor:"pointer", minHeight:30, touchAction:"manipulation" }}>✓ Talked</button>
                    <button onClick={()=>generateGiftIdeas(c as Contact)} style={{ background:T.goldP, border:`1px solid ${T.gold}40`, borderRadius:8, padding:"5px 10px", fontFamily:F.sans, fontSize:11, color:T.gold, cursor:"pointer", minHeight:30, touchAction:"manipulation" }}>🎁</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* All contacts sorted by closeness per blueprint */}
        {["inner","middle","outer"].map(closeness=>{
          const group = allPeople.filter(c => (c as Contact).closeness === closeness || (!((c as Contact).closeness) && closeness==="middle"));
          if (!group.length) return null;
          return (
            <div key={closeness} style={{ marginBottom:16 }}>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:CLOSENESS_COLORS[closeness], margin:"0 0 8px" }}>
                {closeness==="inner"?"❤ Inner Circle":closeness==="middle"?"🟡 Middle Circle":"⭕ Outer Circle"} ({group.length})
              </p>
              {group.map(c=>{
                const days = daysSince(c.lastInteraction?.date);
                const bday = daysUntilBirthday(c.birthday);
                return (
                  <div key={c.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", background:T.ivory, borderRadius:16, border:`1px solid ${T.linen}`, marginBottom:8 }}>
                    <div style={{ width:44, height:44, borderRadius:"50%", background:`linear-gradient(135deg,${CLOSENESS_COLORS[closeness]}20,${T.linen})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{c.emoji||RELATIONSHIP_EMOJIS[c.relationship]||"👩"}</div>
                    <div style={{ flex:1 }}>
                      <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>{c.name}</p>
                      <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"2px 0 0" }}>
                        {c.relationship}
                        {bday!==null && bday<=30?` · 🎂 in ${bday}d`:""}
                        {days<999?` · ${days<1?"today":`${days}d ago`}`:""}
                      </p>
                      {c.notes && <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"2px 0 0", fontStyle:"italic" }}>{c.notes}</p>}
                    </div>
                    <div style={{ display:"flex", gap:5 }}>
                      <button onClick={()=>generateGiftIdeas(c as Contact)} style={{ background:T.goldP, border:`1px solid ${T.gold}40`, borderRadius:8, padding:"6px 8px", fontFamily:F.sans, fontSize:13, color:T.gold, cursor:"pointer", minHeight:36, touchAction:"manipulation" }}>🎁</button>
                      <button onClick={()=>logInteraction(c.id, (c as Contact).preferredMethod||"text")} style={{ background:T.sand, border:`1px solid ${T.linen}`, borderRadius:8, padding:"6px 8px", fontFamily:F.sans, fontSize:11, cursor:"pointer", minHeight:36, touchAction:"manipulation" }}>✓</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {allPeople.length===0 && <Card><p style={{ fontFamily:F.sans, fontSize:14, color:T.taupe, textAlign:"center", padding:"20px 0", lineHeight:1.6 }}>Your circle is empty.<br/>Add the people who matter most.</p></Card>}
      </>}

      {/* ── AI COMPANIONS per blueprint ───────────────────────────── */}
      {tab==="companions" && <>
        <div style={{ background:`linear-gradient(135deg,${T.esp}08,${T.gold}08)`, border:`1px solid ${T.gold}20`, borderRadius:16, padding:"12px 16px", marginBottom:16 }}>
          <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:700, color:T.esp, margin:"0 0 4px" }}>✦ AI Practice Companions</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0, lineHeight:1.5 }}>
            These are AI — not real people. Clearly labelled. Here to listen, never to replace human connection.
          </p>
        </div>

        {COMPANIONS.map(c=>(
          <div key={c.id} style={{ display:"flex", alignItems:"center", gap:14, padding:"16px", background:T.ivory, borderRadius:20, border:`1px solid ${T.linen}`, marginBottom:10, cursor:"pointer", touchAction:"manipulation" }} onClick={()=>startCompanion(c)}>
            <div style={{ width:56, height:56, borderRadius:"50%", background:`linear-gradient(135deg,${T.gold}30,${T.esp}15)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, flexShrink:0 }}>{c.avatar}</div>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
                <p style={{ fontFamily:F.sans, fontSize:15, fontWeight:700, color:T.esp, margin:0 }}>{c.name}</p>
                <span style={{ background:`${T.gold}15`, color:T.gold, fontFamily:F.sans, fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:10, textTransform:"uppercase", letterSpacing:"0.08em" }}>AI</span>
              </div>
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 3px", fontStyle:"italic" }}>{c.personality.split(".")[0]}</p>
              <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:0 }}>Values: {c.values.join(" · ")}</p>
            </div>
            <span style={{ fontFamily:F.sans, fontSize:20, color:T.taupe }}>›</span>
          </div>
        ))}
      </>}
    </div>
  );
}
