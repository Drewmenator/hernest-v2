import React, { useState, useEffect, useCallback } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, Pill, Button, Input, EmptyState } from "../../shared/components";
import { saveData, loadData, db, auth } from "../../core/firebase";
import { ai } from "../../core/ai";
import { bus } from "../../core/events";
import toast from "react-hot-toast";

const safeDate = (d?: string) => { try { if (!d) return new Date(); const dt = new Date(d.includes("T") ? d : d+"T00:00:00"); return isNaN(dt.getTime()) ? new Date() : dt; } catch { return new Date(); } };
const safeStr = (d?: string) => { try { return d || new Date().toISOString().split("T")[0]; } catch { return ""; } };

export interface CalEvent {
  id: string;
  title: string;
  date: string;
  time?: string;
  source: "google" | "school" | "trip" | "birthday" | "manual" | "work";
  child?: string;
  color: string;
  allDay: boolean;
  location?: string;
  notes?: string;
}

const SOURCE_META = {
  google:   { label: "Google",   color: "#4285F4", icon: "◈" },
  apple:    { label: "Apple",    color: "#6E6E73", icon: "" },
  work:     { label: "Work",     color: "#0078D4", icon: "◈" },
  school:   { label: "School",   color: T.sage,   icon: "◆" },
  trip:     { label: "Trip",     color: T.gold,   icon: "→" },
  birthday: { label: "Birthday", color: T.blush,  icon: "◆" },
  manual:   { label: "Family",   color: T.lav,    icon: "◉" },
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];


// ── Per-child school newsletter input ────────────────────────────
function SchoolNewsletterInput({ childName, userId, onEventsAdded }: {
  childName: string;
  userId: string;
  onEventsAdded: (events: CalEvent[]) => void;
}) {
  const [text, setText] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const extract = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const { extractSchoolEvents } = await import("../../core/schoolNewsletterService");
      const { events, error } = await extractSchoolEvents(userId, text, childName);
      if (!error) {
        onEventsAdded(events.map(e => ({
          id: e.id,
          title: e.title,
          date: e.date,
          time: e.time,
          source: "school" as const,
          child: childName,
          color: T.sage,
          allDay: !e.time,
          notes: e.notes,
        })));
        setText("");
      }
    } catch(e) { console.error("[Calendar] newsletter extract:", e); }
    setLoading(false);
  };

  return (
    <div>
      <textarea
        value={text}
        onChange={e=>setText(e.target.value)}
        placeholder={`Paste ${childName}'s school newsletter here...`}
        style={{ width:"100%", minHeight:100, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"12px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", resize:"vertical", boxSizing:"border-box", marginBottom:8 }}
      />
      <button
        onClick={extract}
        disabled={!text.trim()||loading}
        style={{ width:"100%", padding:"12px", background:text.trim()?T.sage:T.linen, color:"#fff", border:"none", borderRadius:12, fontFamily:F.sans, fontSize:13, fontWeight:600, cursor:text.trim()?"pointer":"not-allowed", minHeight:44 }}
      >
        {loading ? "✦ Extracting..." : `✦ Extract ${childName}'s Events`}
      </button>
    </div>
  );
}

// ── iCal parser ──────────────────────────────────────────────────
function parseICal(text: string, childName: string, color: string) {
  const events: any[] = [];
  const blocks = text.split("BEGIN:VEVENT");
  for (const block of blocks.slice(1)) {
    const get = (key: string) => {
      const match = block.match(new RegExp(key + "[^:]*:([^\r\n]+)"));
      return match ? match[1].trim() : "";
    };
    const title = get("SUMMARY");
    const dtstart = get("DTSTART");
    if (!title || !dtstart) continue;
    const fmt = (d: string) => { const c=d.replace(/T.*/,""); return `${c.slice(0,4)}-${c.slice(4,6)}-${c.slice(6,8)}`; };
    events.push({
      id: `school_${childName}_${dtstart}_${Math.random().toString(36).slice(2,6)}`,
      title: childName ? `${childName}: ${title}` : title,
      date: fmt(dtstart),
      source: "school" as const,
      color,
      child: childName,
    });
  }
  return events;
}

export function CalendarScreen() {
  const { user, profile, householdSnapshot, familyMembers, setFamilyMembers } = useStore();

  // Handle OAuth callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("calendar_connected") === "google") {
      setGoogleConnected(true);
      toast.success("Google Calendar connected ✓");
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("calendar_connected") === "outlook") {
      setOutlookConnected(true);
      toast.success("Outlook Calendar connected ✓");
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("calendar_error")) {
      toast.error("Calendar connection failed — try again");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const today = new Date();
  const [events, setEvents]         = useState<CalEvent[]>([]);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear]   = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [view, setView]             = useState<"month"|"list"|"school">("month");
  const [activeFilters, setActiveFilters] = useState<string[]>(Object.keys(SOURCE_META));
  const [showAdd, setShowAdd]       = useState(false);
  const [newTitle, setNewTitle]     = useState("");
  const [newDate, setNewDate]       = useState(selectedDate);
  const [newTime, setNewTime]       = useState("");
  const [newSource, setNewSource]   = useState<"manual"|"work"|"school">("manual");
  const [newChild, setNewChild]     = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [uploadingSchool, setUploadingSchool] = useState(false);
  const [pendingIcal, setPendingIcal] = useState<{ text: string; filename: string } | null>(null);
  const [icalChild, setIcalChild] = useState("");
  const [icalGrade, setIcalGrade] = useState("");
  const [outlookConnected, setOutlookConnected] = useState(false);
  const [appleConnected, setAppleConnected] = useState(false);
  const [showAppleModal, setShowAppleModal] = useState(false);
  const [appleEmail, setAppleEmail] = useState("");
  const [applePassword, setApplePassword] = useState("");
  const [appleLoading, setAppleLoading] = useState(false);

  const loadAllEvents = useCallback(async () => {
    if (!user?.uid) return;
    const all: CalEvent[] = [];

    // Manual events
    const calData = await loadData(user.uid, "calendar");
    if (calData?.events) all.push(...(calData.events as CalEvent[]));

    // Synced provider events (Google/Apple/Outlook) — persisted copy, so they
    // appear on first paint and survive reloads (dedup below handles overlap
    // with the live fetch).
    const syncedData = await loadData(user.uid, "calendar_synced");
    if (syncedData?.events) all.push(...(syncedData.events as CalEvent[]));

    // School events
    const schoolData = await loadData(user.uid, "school");
    if (schoolData?.events) {
      (schoolData.events as any[]).forEach(e => all.push({
        id: e.id, title: e.title, date: e.date,
        source: "school", child: e.child,
        color: T.sage, allDay: true, notes: e.notes,
      }));
    }

    // Trips
    const tripData = await loadData(user.uid, "trips");
    if (tripData?.trips) {
      (tripData.trips as any[]).forEach(t => all.push({
        id: `trip-${t.id}`, title: `✈ ${t.dest}`,
        date: t.date, source: "trip", color: T.gold, allDay: true,
      }));
    }

    // Birthdays
    const yr = today.getFullYear();
    const addBday = (name: string, bday: string, id: string) => {
      if (!bday) return;
      const parts = (bday||"").split("-"); const m = parts[1]||parts[0]; const d = parts[2]||parts[1];
      if (!m || !d) return;
      all.push({ id: `bday-${id}`, title: `🎂 ${name}`, date: `${yr}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`, source: "birthday", color: T.blush, allDay: true });
    };
    profile?.kids?.forEach((k: any) => addBday(k.name + "'s Birthday", k.birthday, k.id||k.name));
    [...(profile?.parents||[]), ...(profile?.inlaws||[])].forEach((p: any) => addBday(p.name + "'s Birthday", p.birthday, p.name));

    // Deduplicate
    const seen = new Set<string>();
    setEvents(all.filter(e => { if(seen.has(e.id))return false; seen.add(e.id); return true; }));
  }, [user?.uid, profile]);

  useEffect(() => {
    if (!user?.uid) return;
    // Check real Google Calendar connection
    import("firebase/firestore").then(({ doc, getDoc }) => {
      getDoc(doc(db, "users", user.uid, "integrations", "google_calendar"))
        .then((snap: any) => setGoogleConnected(snap.exists() && !!snap.data()?.accessToken))
        .catch(() => setGoogleConnected(false));
      getDoc(doc(db, "users", user.uid, "integrations", "apple_calendar"))
        .then((snap: any) => setAppleConnected(snap.exists() && !!snap.data()?.email))
        .catch(() => setAppleConnected(false));
      getDoc(doc(db, "users", user.uid, "integrations", "outlook_calendar"))
        .then((snap: any) => setOutlookConnected(snap.exists() && !!snap.data()?.accessToken))
        .catch(() => setOutlookConnected(false));
    });
  }, [user?.uid]);

  useEffect(() => { loadAllEvents(); }, [loadAllEvents]);

  // Fetch external calendar events when connection status is known
  useEffect(() => {
    if (!user?.uid) return;
    const fetchExternalCalendar = async (url: string) => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) return;
        const res = await fetch(`${url}?uid=${user?.uid}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, { headers: { Authorization: `Bearer ${idToken}` } });
        const data = await res.json();
        console.log("[Calendar] fetched from", url, data.events?.length, "events");
        if (data.events?.length > 0 && user?.uid) bus.publish("calendar.synced", { source: url, count: data.events.length }, { userId: user.uid, source: "calendar" }).catch(() => {});
        if (data.events?.length > 0) {
          setEvents(prev => {
            const existingIds = new Set(prev.map((e: CalEvent) => e.id));
            const newEvts = data.events.filter((e: any) => !existingIds.has(e.id));
            return [...prev, ...newEvts];
          });
          // Persist to `calendar_synced` so reloads — and Cleo (the graph reads
          // this collection) — can see provider events. Without this they live
          // only in component state and vanish on refresh ("display only").
          try {
            const existing = ((await loadData(user.uid, "calendar_synced"))?.events as any[]) || [];
            const byId = new Map<string, any>();
            [...existing, ...data.events].forEach((e: any) => { if (e?.id) byId.set(e.id, e); });
            const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
            const merged = [...byId.values()].filter((e: any) => !e.date || e.date >= cutoff);
            await saveData(user.uid, "calendar_synced", { events: merged });
          } catch (err) { console.warn("[Calendar] persist synced failed:", err); }
        }
      } catch(e) { console.warn("[Calendar] fetch failed:", e); }
    };
    // Run sequentially — all three write the same `calendar_synced` doc, so
    // serializing avoids a read-modify-write race that would drop events.
    (async () => {
      if (googleConnected) await fetchExternalCalendar("/api/calendar/google");
      if (outlookConnected) await fetchExternalCalendar("/api/calendar/outlook");
      if (appleConnected) await fetchExternalCalendar("/api/calendar/apple");
    })();
  }, [googleConnected, outlookConnected, appleConnected, user?.uid]);

  const handleSchoolUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.uid) return;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    try {
      if (["ics","ical"].includes(ext)) {
        // Standard iCal
        const text = await file.text();
        if (!text.includes("BEGIN:VCALENDAR")) { toast.error("Not a valid .ics file"); return; }
        setPendingIcal({ text, filename: file.name });
      } else if (["pdf","png","jpg","jpeg"].includes(ext)) {
        // Use Cleo to extract events from PDF/image
        setUploadingSchool(true);
        const base64 = await new Promise<string>((res,rej) => {
          const r = new FileReader();
          r.onload = () => res((r.result as string).split(",")[1]);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
        const mediaType = ext === "pdf" ? "application/pdf" : `image/${ext}`;
        const response = await fetch("/api/claude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system: 'Extract school calendar events from this document. Return ONLY valid JSON array: [{"title":"string","date":"YYYY-MM-DD","endDate":"YYYY-MM-DD or null","type":"holiday|exam|event|inset|other"}]. Extract ALL dates and events you can find. Return [] if nothing found.',
            prompt: "Extract all school calendar events from this document.",
            model: "claude-sonnet-4-20250514",
            max_tokens: 2000,
            messages: [{
              role: "user",
              content: [
                { type: ext === "pdf" ? "document" : "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                { type: "text", text: "Extract all school calendar events as JSON array." }
              ]
            }]
          })
        });
        const data = await response.json();
        const text = data.content?.[0]?.text || "[]";
        const events = JSON.parse(text.replace(/```json|```/g,"").trim());
        if (!events.length) { toast.error("No events found — try a clearer image or .ics file"); setUploadingSchool(false); return; }
           // Convert to iCal-like text for pending modal
        const icalText = ["BEGIN:VCALENDAR", ...events.map((ev: any) => ["BEGIN:VEVENT",`SUMMARY:${ev.title}`,`DTSTART:${(ev.date||"").replace(/-/g,"")}`,`DTEND:${(ev.endDate||ev.date||"").replace(/-/g,"")}`, "END:VEVENT"].join("\n")), "END:VCALENDAR"].join("\n");      setPendingIcal({ text: icalText, filename: file.name });
        setUploadingSchool(false);
      } else if (["csv","xlsx","xls"].includes(ext)) {
        toast.error("CSV/Excel support coming soon — please use .ics or PDF for now");
        e.target.value = "";
        return;
      } else {
        toast.error("Unsupported format — use .ics, PDF, or image");
        e.target.value = "";
        return;
      }
      // Pre-select first child if only one
      const kids = familyMembers.filter(m => m.role === "child");
      if (kids.length === 1) setIcalChild(kids[0].id);
      else setIcalChild("");
      setIcalGrade("");
    } catch(err) { 
      console.error(err);
      toast.error("Could not read file — try again"); 
      setUploadingSchool(false);
    }
    e.target.value = "";
  };

  const confirmSchoolUpload = async () => {
    if (!pendingIcal || !user?.uid) return;
    setUploadingSchool(true);
    try {
      const child = familyMembers.find(m => m.id === icalChild);
      const childName = child?.name || "School";
      const childColor = child?.color || T.sage;
      const newEvents = parseICal(pendingIcal.text, childName, childColor);
      if (newEvents.length === 0) { toast.error("No events found in file"); return; }
      setEvents(prev => {
        const existingIds = new Set(prev.map((e: CalEvent) => e.id));
        return [...prev, ...newEvents.filter(e => !existingIds.has(e.id))];
      });
      const calData = await loadData(user.uid, "calendar");
      const existing = ((calData?.events as any[]) || []).filter((e:any) => !(e.source==="school" && e.child===childName));
      await saveData(user.uid, "calendar", { events: [...existing, ...newEvents] });
      // Update child's schoolInfo with grade
      if (child && icalGrade) {
        const updatedMembers = familyMembers.map(m =>
          m.id === icalChild ? { ...m, schoolInfo: { ...m.schoolInfo, country: m.schoolInfo?.country||"US", schoolType: m.schoolInfo?.schoolType||"public", grade: icalGrade } } : m
        );
        setFamilyMembers(updatedMembers);
        await saveData(user.uid, "family", { members: updatedMembers });
      }
      toast.success(`${newEvents.length} events imported for ${childName} ✦`);
      setPendingIcal(null);
    } catch { toast.error("Import failed — try again"); }
    finally { setUploadingSchool(false); }
  };

  const connectCalendar = async (provider: "google"|"outlook"|"apple") => {
    if (provider === "apple") { setShowAppleModal(true); return; }
    if (provider === "google") {
      // Redirect to Google OAuth
      import("../../core/connectorSync").then(m => m.connectOAuth("google"));
      return;
    }
    import("../../core/connectorSync").then(m => m.connectOAuth("outlook"));
    return;
  };

  const addEvent = async () => {
    if (!newTitle.trim() || !newDate) return;
    const meta = SOURCE_META[newSource];
    const event: CalEvent = {
      id: crypto.randomUUID(), title: newTitle.trim(),
      date: newDate, time: newTime||undefined,
      source: newSource, child: newChild||undefined,
      color: meta.color, allDay: !newTime, location: newLocation||undefined,
    };
    const manualEvts = [...(events||[]).filter(e=>e.source==="manual"||e.source==="work"), event];
    if (user?.uid) {
      await saveData(user.uid, "calendar", { events: manualEvts });
      await bus.publish("plan.calendar.event.added", event, { userId: user.uid, source: "calendar" });
    }
    await loadAllEvents();
    setNewTitle(""); setNewTime(""); setNewChild(""); setNewLocation(""); setShowAdd(false);
    toast.success("Event added ✓");
  };

  const filtered    = (events||[]).filter(e => e && e.source && activeFilters.includes(e.source));
  const forDate     = (d: string) => filtered.filter(e => e.date === d);
  const selectedEvts = forDate(selectedDate);
  const daysInMonth = new Date(currentYear, currentMonth+1, 0).getDate();
  const firstDay    = new Date(currentYear, currentMonth, 1).getDay();
  const monthEvts   = filtered
    .filter(e => e.date?.startsWith(`${currentYear}-${String(currentMonth+1).padStart(2,"0")}`))
    .sort((a,b) => a.date.localeCompare(b.date));

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      {/* Cross-module alerts */}
      {householdSnapshot?.financial?.upcomingTripObligation && (() => {
        const trip = householdSnapshot.financial.upcomingTripObligation!;
        return trip.daysUntil <= 7 ? (
          <div style={{ background:`${T.gold}12`, border:`1px solid ${T.gold}30`, borderRadius:12, padding:"10px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:16 }}>✈</span>
            <p style={{ fontFamily:F.sans, fontSize:12, color:T.bark, margin:0, lineHeight:1.5 }}>
              <strong>{trip.name}</strong> is {trip.daysUntil} day{trip.daysUntil === 1 ? "" : "s"} away — make sure your calendar is cleared for departure.
            </p>
          </div>
        ) : null;
      })()}
      {householdSnapshot && (householdSnapshot.financial?.topOverspendCategories?.length ?? 0) > 0 && (
        <div style={{ background:`${T.blush}10`, border:`1px solid ${T.blush}25`, borderRadius:12, padding:"10px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:16 }}>💰</span>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.bark, margin:0, lineHeight:1.5 }}>
            <strong>{householdSnapshot.financial.topOverspendCategories[0]}</strong> is running higher than planned this month — you've still got room to steer it.
          </p>
        </div>
      )}

      {/* Household state banner */}
      {householdSnapshot?.householdStressLevel === "high" && (
        <div style={{ background:`${T.blush}15`, border:`1px solid ${T.blush}30`, borderRadius:12, padding:"10px 14px", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:16 }}>💛</span>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.bark, margin:0, lineHeight:1.5 }}>
            Things look heavy right now. Focus on what matters most — Cleo's got the rest.
          </p>
        </div>
      )}
      {householdSnapshot?.calendarLoad === "critical" && householdSnapshot?.householdStressLevel !== "high" && (
        <div style={{ background:`${T.gold}12`, border:`1px solid ${T.gold}30`, borderRadius:12, padding:"10px 14px", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:16 }}>📅</span>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.bark, margin:0, lineHeight:1.5 }}>
            Busy week ahead — consider what can wait until next week.
          </p>
        </div>
      )}

      <PageTitle eyebrow="UNIFIED CALENDAR" title="Everything" />

      {/* Connect calendars */}
      <Card>
        <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>CONNECTED CALENDARS</p>
        {[
          { key:"google",  name:"Google Calendar", icon:"◈", color:"#4285F4", connected:googleConnected,  desc:"Sign in once — stays connected" },
          { key:"outlook", name:"Outlook / Work",  icon:"◈", color:"#1B2A4A", connected:outlookConnected, desc:"Microsoft 365 & work events" },
          { key:"apple",   name:"Apple Calendar", icon:"",  color:"#6E6E73", connected:appleConnected,   desc:"iCloud Calendar sync" },
        ].map(p => (
          <div key={p.key} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:`1px solid ${T.linen}` }}>
            <span style={{ fontSize:22 }}>{p.icon}</span>
            <div style={{ flex:1 }}>
              <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>{p.name}</p>
              <p style={{ fontFamily:F.sans, fontSize:11, color:p.connected?T.sage:T.taupe, margin:"2px 0 0" }}>
                {p.connected ? "✓ Connected — syncing automatically" : p.desc}
              </p>
            </div>
            {p.connected
              ? <button onClick={()=>p.key==="apple"?setShowAppleModal(true):null} style={{ background:`${T.sage}15`, color:T.sage, borderRadius:10, padding:"4px 10px", fontFamily:F.sans, fontSize:11, fontWeight:600, border:"none", cursor:p.key==="apple"?"pointer":"default" }}>✓ Connected{p.key==="apple"?" ↻":""}</button>
              : <button onClick={()=>connectCalendar(p.key as any)} style={{ background:p.color, color:"#fff", border:"none", borderRadius:10, padding:"8px 16px", fontFamily:F.sans, fontSize:12, fontWeight:600, cursor:"pointer", minHeight:36, touchAction:"manipulation" }}>Connect</button>
            }
          </div>
        ))}
        {/* Auto sources */}
        {[
          { name:"Trip Dates", icon:"✈️", color:T.gold },
          { name:"Birthdays",  icon:"◆",  color:T.blush },
        ].map(s => (
          <div key={s.name} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:`1px solid ${T.linen}` }}>
            <span style={{ fontSize:22 }}>{s.icon}</span>
            <div style={{ flex:1 }}>
              <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>{s.name}</p>
              <p style={{ fontFamily:F.sans, fontSize:11, color:T.sage, margin:"2px 0 0" }}>✓ Auto-synced from HerNest</p>
            </div>
          </div>
        ))}

        {/* School Events — upload per child */}
        <div style={{ padding:"10px 0" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
            <span style={{ fontSize:22 }}>🏫</span>
            <div style={{ flex:1 }}>
              <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>School Events</p>
              <p style={{ fontFamily:F.sans, fontSize:11, color:T.sage, margin:"2px 0 0" }}>
                {events.filter(e=>e.source==="school").length > 0
                  ? `✓ ${events.filter(e=>e.source==="school").length} events loaded`
                  : "Upload school calendar (.ics, PDF, image)"}
              </p>
            </div>
            <label style={{ background:T.sage, color:"#fff", borderRadius:10, padding:"6px 14px", fontFamily:F.sans, fontSize:12, fontWeight:600, cursor:"pointer", flexShrink:0 }}>
              {uploadingSchool ? "Importing..." : "+ Upload"}
              <input type="file" accept=".ics,.ical,.pdf,.png,.jpg,.jpeg,.csv,.xlsx,.xls" onChange={handleSchoolUpload} style={{ display:"none" }}/>
            </label>
          </div>
        </div>
      </Card>

            {/* Apple Calendar Modal */}
      {showAppleModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(42,31,24,0.5)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div style={{ background:"#fff", borderRadius:"24px 24px 0 0", padding:"24px 20px", width:"100%", maxWidth:430, boxShadow:"0 -8px 40px rgba(42,31,24,0.15)" }}>
            <p style={{ fontFamily:F.serif, fontSize:22, fontStyle:"italic", color:T.esp, margin:"0 0 6px" }}>Connect Apple Calendar</p>
            <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 4px" }}>Use an app-specific password — not your Apple ID password.</p>
            <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noreferrer" style={{ fontFamily:F.sans, fontSize:12, color:"#0071e3", display:"block", marginBottom:16 }}>Generate one at appleid.apple.com ›</a>
            <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:T.taupe, margin:"0 0 6px" }}>Apple ID Email</p>
            <input value={appleEmail} onChange={e=>setAppleEmail(e.target.value)} placeholder="you@icloud.com" type="email" style={{ width:"100%", background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"12px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", marginBottom:12, boxSizing:"border-box" as any }}/>
            <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:T.taupe, margin:"0 0 6px" }}>App-Specific Password</p>
            <input value={applePassword} onChange={e=>setApplePassword(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx" type="password" style={{ width:"100%", background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"12px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", marginBottom:20, boxSizing:"border-box" as any }}/>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={async()=>{
                if(!appleEmail||!applePassword)return;
                setAppleLoading(true);
                try{
                  const idToken=await auth.currentUser?.getIdToken();
                  const res=await fetch("/api/auth/apple",{method:"POST",headers:{Authorization:`Bearer ${idToken}`,"Content-Type":"application/json"},body:JSON.stringify({email:appleEmail,password:applePassword})});
                  if(res.ok||res.redirected){setAppleConnected(true);setShowAppleModal(false);toast.success("Apple Calendar connected ✓");}
                  else{const d=await res.json();toast.error(d.error||"Connection failed");}
                }catch(e){toast.error("Connection failed — check your credentials");}
                setAppleLoading(false);
              }} disabled={!appleEmail||!applePassword||appleLoading} style={{ flex:1, padding:"14px", background:appleEmail&&applePassword?"#000":"#ccc", color:"#fff", border:"none", borderRadius:14, fontFamily:F.sans, fontSize:14, fontWeight:600, cursor:appleEmail&&applePassword?"pointer":"not-allowed", minHeight:52 }}>
                {appleLoading?"Connecting...":"Connect Apple Calendar"}
              </button>
              <button onClick={()=>setShowAppleModal(false)} style={{ flex:1, padding:"14px", background:"none", border:`1.5px solid ${T.linen}`, borderRadius:14, fontFamily:F.sans, fontSize:14, color:T.bark, cursor:"pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* School Upload Modal */}
      {pendingIcal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(42,31,24,0.5)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div style={{ background:"#fff", borderRadius:"24px 24px 0 0", padding:"24px 20px", width:"100%", maxWidth:430, boxShadow:"0 -8px 40px rgba(42,31,24,0.15)" }}>
            <p style={{ fontFamily:F.serif, fontSize:22, fontStyle:"italic", color:T.esp, margin:"0 0 6px" }}>Which child is this for?</p>
            <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 16px" }}>{pendingIcal.filename}</p>

            {/* Child selector */}
            <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:T.taupe, margin:"0 0 8px" }}>Child</p>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
              {familyMembers.filter(m => m.role==="child").map(m => (
                <button key={m.id} onClick={() => setIcalChild(m.id)}
                  style={{ padding:"10px 16px", borderRadius:12, border:`2px solid ${icalChild===m.id?m.color:T.linen}`, background:icalChild===m.id?`${m.color}15`:"#fff", fontFamily:F.sans, fontSize:13, fontWeight:700, color:icalChild===m.id?m.color:T.bark, cursor:"pointer" }}>
                  {m.name}{m.age ? ` · ${m.age}` : ""}
                </button>
              ))}
              {familyMembers.filter(m => m.role==="child").length === 0 && (
                <p style={{ fontFamily:F.sans, fontSize:13, color:T.taupe }}>Add children in Family HQ first</p>
              )}
            </div>

            {/* Grade */}
            <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:T.taupe, margin:"0 0 8px" }}>Grade (optional)</p>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:20 }}>
              {["Pre-K","K","1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th"].map(g => (
                <button key={g} onClick={() => setIcalGrade(g)}
                  style={{ padding:"6px 10px", borderRadius:20, border:`1.5px solid ${icalGrade===g?T.sky:T.linen}`, background:icalGrade===g?T.skyP:"#fff", fontFamily:F.sans, fontSize:11, color:icalGrade===g?T.sky:T.bark, cursor:"pointer" }}>
                  {g}
                </button>
              ))}
            </div>

            <div style={{ display:"flex", gap:8 }}>
              <button onClick={confirmSchoolUpload} disabled={!icalChild || uploadingSchool}
                style={{ flex:1, padding:"14px", background:icalChild?T.esp:T.linen, color:"#fff", border:"none", borderRadius:14, fontFamily:F.sans, fontSize:14, fontWeight:600, cursor:icalChild?"pointer":"not-allowed", minHeight:52 }}>
                {uploadingSchool ? "Importing..." : "Import Calendar"}
              </button>
              <button onClick={() => setPendingIcal(null)}
                style={{ flex:1, padding:"14px", background:"none", border:`1.5px solid ${T.linen}`, borderRadius:14, fontFamily:F.sans, fontSize:14, color:T.bark, cursor:"pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"center", marginBottom:12, WebkitOverflowScrolling:"touch" as any }}>
        {Object.entries(SOURCE_META||{}).map(([key,meta]) => (
          <button key={key} onClick={()=>setActiveFilters(p=>p.includes(key)?p.filter(s=>s!==key):[...p,key])} style={{ display:"flex", alignItems:"center", gap:4, padding:"6px 12px", borderRadius:20, border:`1.5px solid ${activeFilters.includes(key)?meta.color:T.linen}`, background:activeFilters.includes(key)?`${meta.color}15`:"#fff", color:activeFilters.includes(key)?meta.color:T.taupe, fontFamily:F.sans, fontSize:11, cursor:"pointer", fontWeight:activeFilters.includes(key)?700:400, minHeight:36, touchAction:"manipulation" }}>
            <span>{meta.icon}</span><span>{meta.label}</span>
          </button>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div style={{ display:"flex", gap:6 }}>
          <Pill label="Month" active={view==="month"} onClick={()=>setView("month")} />
          <Pill label="List"  active={view==="list"}  onClick={()=>setView("list")} />
        </div>
        <button onClick={()=>setShowAdd(!showAdd)} style={{ background:T.esp, color:"#fff", border:"none", borderRadius:12, padding:"8px 18px", fontFamily:F.sans, fontSize:13, fontWeight:600, cursor:"pointer", minHeight:40, touchAction:"manipulation" }}>+ Add</button>
      </div>

      {/* Add form */}
      {showAdd && <Card>
        <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>ADD EVENT</p>
        <Input value={newTitle} onChange={setNewTitle} placeholder="Event name" style={{ marginBottom:8 }}/>
        <div style={{ display:"flex", gap:8, marginBottom:8 }}>
          <input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} style={{ flex:1, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"12px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", minHeight:48 }}/>
          <input type="time" value={newTime} onChange={e=>setNewTime(e.target.value)} style={{ flex:1, background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"12px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", minHeight:48 }}/>
        </div>
        <div style={{ display:"flex", gap:6, marginBottom:8 }}>
          {(["manual","work","school"] as const).map(s=>(
            <button key={s} onClick={()=>setNewSource(s)} style={{ flex:1, padding:"8px 6px", borderRadius:12, border:`1.5px solid ${newSource===s?SOURCE_META[s].color:T.linen}`, background:newSource===s?`${SOURCE_META[s].color}15`:"#fff", color:newSource===s?SOURCE_META[s].color:T.bark, fontFamily:F.sans, fontSize:11, cursor:"pointer", minHeight:40 }}>
              {SOURCE_META[s].icon} {SOURCE_META[s].label}
            </button>
          ))}
        </div>
        {newSource==="school" && <Input value={newChild} onChange={setNewChild} placeholder="Which child?" style={{ marginBottom:8 }}/>}
        <Input value={newLocation} onChange={setNewLocation} placeholder="Location (optional)" style={{ marginBottom:12 }}/>
        <div style={{ display:"flex", gap:8 }}>
          <Button onClick={addEvent} disabled={!newTitle.trim()||!newDate} variant="gold" style={{ flex:1 }}>Add Event</Button>
          <Button onClick={()=>setShowAdd(false)} variant="ghost" style={{ flex:1 }}>Cancel</Button>
        </div>
      </Card>}

      {/* Month nav */}
      {view==="month" && <>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <button onClick={()=>{ if(currentMonth===0){setCurrentMonth(11);setCurrentYear(y=>y-1);}else setCurrentMonth(m=>m-1); }} style={{ background:T.sand, border:`1px solid ${T.linen}`, borderRadius:10, padding:"8px 16px", fontFamily:F.sans, fontSize:18, cursor:"pointer", color:T.esp, minHeight:44 }}>‹</button>
          <p style={{ fontFamily:F.serif, fontSize:22, fontStyle:"italic", color:T.esp, margin:0 }}>{MONTHS[currentMonth]} {currentYear}</p>
          <button onClick={()=>{ if(currentMonth===11){setCurrentMonth(0);setCurrentYear(y=>y+1);}else setCurrentMonth(m=>m+1); }} style={{ background:T.sand, border:`1px solid ${T.linen}`, borderRadius:10, padding:"8px 16px", fontFamily:F.sans, fontSize:18, cursor:"pointer", color:T.esp, minHeight:44 }}>›</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:4 }}>
          {DAYS.map(d=><div key={d} style={{ textAlign:"center", fontFamily:F.sans, fontSize:10, fontWeight:700, color:T.taupe, padding:"4px 0" }}>{d}</div>)}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:16 }}>
          {Array.from({length:firstDay}).map((_,i)=><div key={`e${i}`}/>)}
          {Array.from({length:daysInMonth}).map((_,i)=>{
            const day=i+1;
            const ds=`${currentYear}-${String(currentMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const de=forDate(ds);
            const isToday=ds===new Date().toISOString().split("T")[0];
            const isSel=ds===selectedDate;
            return (
              <button key={day} onClick={()=>setSelectedDate(ds)} style={{ aspectRatio:"1", borderRadius:10, border:"none", background:isSel?T.esp:isToday?T.goldP:"transparent", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2, touchAction:"manipulation" }}>
                <span style={{ fontFamily:F.sans, fontSize:13, fontWeight:isToday||isSel?700:400, color:isSel?"#fff":isToday?T.gold:T.esp }}>{day}</span>
                {de.length>0 && <div style={{ display:"flex", gap:2 }}>
                  {de.slice(0,3).map((e,ei)=><div key={ei} style={{ width:5, height:5, borderRadius:"50%", background:isSel?"rgba(255,255,255,0.7)":e.color }}/>)}
                </div>}
              </button>
            );
          })}
        </div>
        <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 10px" }}>
          {safeDate(selectedDate).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
        </p>
        {selectedEvts.length===0
          ? <EmptyState icon="◆" title="Nothing scheduled yet" body="Add your first event and I'll keep the day in view ✦" />

          : (selectedEvts||[]).map(e=>{ const meta=SOURCE_META[e.source]; return (
            <div key={e.id} style={{ display:"flex", gap:12, padding:"12px 16px", background:T.ivory, borderRadius:16, border:`1px solid ${T.linen}`, marginBottom:8, borderLeft:`4px solid ${e.color}` }}>
              <span style={{ fontSize:20, flexShrink:0 }}>{meta.icon}</span>
              <div style={{ flex:1 }}>
                <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>{e.title}</p>
                <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"2px 0 0" }}>{e.time||"All day"} · {meta.label}{e.child?` · ${e.child}`:""}{e.location?` · ${e.location}`:""}</p>
              </div>
            </div>
          );})
        }
      </>}

      {/* List view */}
      {view==="school" && <>
        <div style={{ marginBottom:12 }}>
          <p style={{ fontFamily:F.sans, fontSize:13, color:T.taupe, lineHeight:1.6, margin:"0 0 12px" }}>
            Add a school calendar for each child. Paste newsletter text and Cleo will extract all events automatically.
          </p>
          {/* Per-child school calendar */}
          {((profile as any)?.kids || (profile as any)?.children || []).length > 0 ? (
            ((profile as any)?.kids || (profile as any)?.children || []).map((kid: any) => (
              <Card key={kid.id || kid.name}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                  <span style={{ fontSize:22 }}>🧒</span>
                  <p style={{ fontFamily:F.sans, fontSize:14, fontWeight:700, color:T.esp, margin:0 }}>{kid.name}</p>
                </div>
                <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:T.taupe, margin:"0 0 8px" }}>PASTE NEWSLETTER</p>
                <SchoolNewsletterInput childName={kid.name} userId={user?.uid||""} onEventsAdded={(evts) => {
                  setEvents(prev => [...prev.filter(e => e.child !== kid.name || e.source !== "school"), ...evts]);
                  toast.success(`Added ${evts.length} events for ${kid.name} ✓`);
                }}/>
              </Card>
            ))
          ) : (
            <Card>
              <p style={{ fontFamily:F.sans, fontSize:13, color:T.taupe, textAlign:"center", padding:"16px 0" }}>
                Add your children in Profile → Family first, then come back to set up their school calendars.
              </p>
            </Card>
          )}
        </div>
      </>}

      {view==="list" && <>
        <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 10px" }}>{MONTHS[currentMonth]} {currentYear} · {monthEvts.length} events</p>
        {monthEvts.length===0
          ? <EmptyState icon="◆" title="Nothing this month yet" body="Once your calendars are connected or you add an event, it'll show up here ✦" />

          : (monthEvts||[]).map(e=>{ const meta=SOURCE_META[e.source]; const d=safeDate(e.date); return (
            <div key={e.id} style={{ display:"flex", gap:12, padding:"12px 16px", background:T.ivory, borderRadius:16, border:`1px solid ${T.linen}`, marginBottom:8, borderLeft:`4px solid ${e.color}` }}>
              <div style={{ width:44, textAlign:"center", flexShrink:0 }}>
                <p style={{ fontFamily:F.sans, fontSize:10, color:T.taupe, margin:0, textTransform:"uppercase" }}>{DAYS[d.getDay()]}</p>
                <p style={{ fontFamily:F.serif, fontSize:22, fontWeight:600, color:T.esp, margin:0, lineHeight:1 }}>{d.getDate()}</p>
              </div>
              <div style={{ flex:1 }}>
                <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>{e.title}</p>
                <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"2px 0 0" }}>{meta.icon} {meta.label}{e.child?` · ${e.child}`:""}{e.time?` · ${e.time}`:""}</p>
              </div>
            </div>
          );})
        }
      </>}
    </div>
  );
}
