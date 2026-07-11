// ─── Memory & Timeline (Phase 3 — Memory v2 surface) ────────────
// The user-facing window into what Cleo remembers and what has happened in
// the household. Backend already exists (memoryServiceV2 governance + the
// durable event log); this screen surfaces and lets the user CONTROL it.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { PageTitle } from "../../shared/components";
import {
  loadMemoriesV2, deleteMemory, confirmMemory, rejectMemory,
  type HouseholdMemory,
} from "../../core/memoryServiceV2";
import { getHouseholdTimeline } from "../../core/eventLog";
import { getHouseholdId } from "../../core/identity";
import type { LoggedEvent } from "../../core/db";
import toast from "react-hot-toast";

const CONF_COLOR: Record<string, string> = { high: T.sage, medium: T.gold, low: T.taupe };

// Coerce any stored value to a safe string for rendering. The persisted memory
// docs are cast (not validated), so a field could be an object/number at
// runtime — rendering that directly throws "Objects are not valid as a React
// child" and blanks the whole screen. This makes the screen shape-proof.
function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return ""; }
}

// ── Turn a raw event into a human sentence ──────────────────────
function humanizeEvent(e: LoggedEvent): string {
  const p = (e.payload || {}) as Record<string, any>;
  const title = str(p.title || p.name || p.dest || p.label || "");
  const type = str(e.type);
  const MAP: Record<string, string> = {
    "plan.task.created": title ? `Added task: ${title}` : "Added a task",
    "plan.task.completed": title ? `Completed: ${title}` : "Completed a task",
    "plan.task.deleted": title ? `Removed task: ${title}` : "Removed a task",
    "plan.calendar.event.added": title ? `Scheduled: ${title}` : "Added a calendar event",
    "plan.meal.generated": "Generated a meal plan",
    "plan.school.newsletter.parsed": "Parsed a school newsletter",
    "calendar.connected": "Connected a calendar",
    "calendar.synced": "Synced the calendar",
  };
  if (MAP[type]) return MAP[type];
  // Fallback: derive a readable phrase from the dotted event type.
  const pretty = type.split(".").join(" · ") || "Activity";
  return title ? `${pretty}: ${title}` : pretty;
}

function relativeTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const chip = (bg: string, color: string): React.CSSProperties => ({
  fontFamily: F.sans, fontSize: 10, fontWeight: 700, color,
  padding: "2px 8px", borderRadius: 10, background: bg, textTransform: "capitalize" as const,
});

export function MemoryScreen() {
  const { user } = useStore();
  const [view, setView] = useState<"memory" | "timeline">("memory");
  const [memories, setMemories] = useState<HouseholdMemory[]>([]);
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    try {
      const [mems, tl] = await Promise.all([
        loadMemoriesV2(user.uid),
        getHouseholdTimeline(getHouseholdId() ?? user.uid, { limit: 80 }),
      ]);
      setMemories(Array.isArray(mems) ? mems : []);
      setEvents(Array.isArray(tl) ? tl : []);
    } catch (e) {
      console.warn("[Memory] load failed:", e);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => { load(); }, [load]);

  // Active + to-confirm memories, newest first, filtered by the search box.
  const visibleMemories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return memories
      .filter(m => m.status === "active" || m.status === "needs_confirmation")
      .filter(m => !q || `${str(m.title)} ${str(m.content)}`.toLowerCase().includes(q))
      .sort((a, b) => str(b.updatedAt).localeCompare(str(a.updatedAt)));
  }, [memories, query]);

  const toConfirm = visibleMemories.filter(m => m.status === "needs_confirmation");
  const known = visibleMemories.filter(m => m.status === "active");

  const onForget = async (m: HouseholdMemory) => {
    if (!user?.uid) return;
    setMemories(prev => prev.filter(x => x.id !== m.id)); // optimistic
    try { await deleteMemory(user.uid, m.id); toast.success("Forgotten"); }
    catch { toast.error("Couldn't forget that"); load(); }
  };
  const onConfirm = async (m: HouseholdMemory) => {
    if (!user?.uid) return;
    try { await confirmMemory(user.uid, m.id); toast.success("Saved"); load(); }
    catch { toast.error("Couldn't save"); }
  };
  const onReject = async (m: HouseholdMemory) => {
    if (!user?.uid) return;
    setMemories(prev => prev.filter(x => x.id !== m.id));
    try { await rejectMemory(user.uid, m.id); }
    catch { load(); }
  };

  const MemoryCard = (m: HouseholdMemory, pending: boolean) => {
    const title = str(m.title);
    const content = str(m.content);
    const conf = str(m.confidence);
    return (
    <div key={m.id} style={{ background: "#fff", border: `1.5px solid ${pending ? `${T.gold}55` : T.linen}`, borderRadius: 16, padding: "14px 16px", marginBottom: 10 }}>
      {title && <p style={{ fontFamily: F.serif, fontSize: 16, color: T.esp, margin: "0 0 4px", fontStyle: "italic" }}>{title}</p>}
      <p style={{ fontFamily: F.sans, fontSize: 13, color: T.bark, margin: "0 0 10px", lineHeight: 1.5 }}>{content}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={chip(`${T.lav}14`, T.lav)}>{str(m.type).replace(/_/g, " ")}</span>
        <span style={chip(`${T.sky}14`, T.sky)}>{str(m.sourceModule)}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: F.sans, fontSize: 10, color: T.taupe }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: CONF_COLOR[conf] || T.taupe, display: "inline-block" }} />
          {conf}
        </span>
        <div style={{ flex: 1 }} />
        {pending ? (
          <>
            <button onClick={() => onReject(m)} style={btn(T.taupe, "transparent")}>No</button>
            <button onClick={() => onConfirm(m)} style={btn("#fff", T.sage)}>Remember</button>
          </>
        ) : (
          <button onClick={() => onForget(m)} style={btn(T.taupe, "transparent")}>Forget</button>
        )}
      </div>
    </div>
    );
  };

  return (
    <div style={{ paddingBottom: 80 }}>
      <PageTitle eyebrow="WHAT CLEO KNOWS" title="Memory" />

      {/* Toggle */}
      <div style={{ display: "flex", gap: 6, background: T.sand, borderRadius: 14, padding: 4, margin: "8px 0 18px" }}>
        {(["memory", "timeline"] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            style={{ flex: 1, padding: "9px", borderRadius: 11, border: "none", cursor: "pointer",
              fontFamily: F.sans, fontSize: 13, fontWeight: view === v ? 700 : 500,
              background: view === v ? "#fff" : "transparent", color: view === v ? T.esp : T.taupe,
              boxShadow: view === v ? "0 1px 3px rgba(0,0,0,0.06)" : "none" }}>
            {v === "memory" ? "Memory" : "Timeline"}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, textAlign: "center", padding: "40px 0" }}>Loading…</p>
      ) : view === "memory" ? (
        <>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search what Cleo remembers…"
            style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 12, border: `1.5px solid ${T.linen}`, background: "#fff", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 16 }} />

          {visibleMemories.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 24px" }}>
              <p style={{ fontFamily: F.serif, fontSize: 20, fontStyle: "italic", color: T.esp, margin: "0 0 8px" }}>Nothing remembered yet</p>
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0, lineHeight: 1.6 }}>As you use HerNest and talk to Cleo, she'll remember the things that matter — preferences, routines, and the details you shouldn't have to repeat.</p>
            </div>
          ) : (
            <>
              {toConfirm.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.gold, margin: "0 0 10px" }}>Cleo wants to confirm</p>
                  {toConfirm.map(m => MemoryCard(m, true))}
                </div>
              )}
              <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" }}>{known.length} {known.length === 1 ? "memory" : "memories"}</p>
              {known.map(m => MemoryCard(m, false))}
            </>
          )}
        </>
      ) : (
        <>
          {events.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 24px" }}>
              <p style={{ fontFamily: F.serif, fontSize: 20, fontStyle: "italic", color: T.esp, margin: "0 0 8px" }}>No activity yet</p>
              <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0, lineHeight: 1.6 }}>As things happen across your household — tasks, events, plans — they'll show up here as a timeline.</p>
            </div>
          ) : (
            <div style={{ position: "relative", paddingLeft: 18 }}>
              <div style={{ position: "absolute", left: 4, top: 6, bottom: 6, width: 2, background: T.linen }} />
              {events.map(e => (
                <div key={e.id} style={{ position: "relative", marginBottom: 16 }}>
                  <div style={{ position: "absolute", left: -18, top: 4, width: 10, height: 10, borderRadius: "50%", background: T.sage, border: `2px solid ${T.ivory}` }} />
                  <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: "0 0 2px", lineHeight: 1.4 }}>{humanizeEvent(e)}</p>
                  <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: 0 }}>{relativeTime(Number(e.occurredAt) || Date.now())} · {str(e.source)}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function btn(color: string, bg: string): React.CSSProperties {
  return {
    fontFamily: F.sans, fontSize: 12, fontWeight: 700, cursor: "pointer",
    padding: "6px 14px", borderRadius: 10,
    border: bg === "transparent" ? `1.5px solid ${T.linen}` : `1.5px solid ${bg}`,
    background: bg, color,
  };
}

export default MemoryScreen;
