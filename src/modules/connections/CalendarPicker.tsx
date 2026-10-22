// ─── Choose calendars ─────────────────────────────────────────────
// Under a connected calendar in Connections: tick which of the person's
// calendars HerNest reads. Until they choose, only their own are read
// (calendars shared by other people, like a colleague's, stay out).
// Saving re-syncs, and events from unticked calendars are cleared.
import { useState } from "react";
import { T, F } from "../../config/theme";
import { auth, clearDataCaches } from "../../core/firebase";
import { ChevronDown } from "lucide-react";
import toast from "react-hot-toast";
import { isPicked, loadCalendarChoice, saveCalendarChoice, type ChoiceKey } from "../../core/calendarChoice";

interface Row { id: string; name: string; color: string; account?: string; own: boolean; picked: boolean }

async function loadGoogle(): Promise<Row[] | null> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  if (!token) return null;
  try {
    const res = await fetch("/api/connectors?provider=google&action=calendars", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json() as { calendars?: Row[] };
    return Array.isArray(data.calendars) ? data.calendars : null;
  } catch { return null; }
}

async function loadDevice(uid: string): Promise<Row[] | null> {
  const { listDeviceCalendars } = await import("../../core/deviceCalendar");
  const [list, choice] = await Promise.all([listDeviceCalendars(), loadCalendarChoice(uid)]);
  if (!list) return null;
  return list.map(c => ({ ...c, picked: isPicked(c.id, c.own, choice.device) }));
}

export function CalendarPicker({ uid, source }: { uid: string; source: ChoiceKey }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setFailed(false); setRows(null);
    const r = source === "google" ? await loadGoogle() : await loadDevice(uid);
    if (r) setRows(r); else setFailed(true);
  };

  const save = async () => {
    if (!rows || saving) return;
    setSaving(true);
    try {
      await saveCalendarChoice(uid, source, rows.map(r => ({ id: r.id, picked: r.picked })));
      // Re-sync now: the full list from the ticked calendars replaces the
      // old one, so events from unticked calendars disappear.
      const { syncAllConnectors } = await import("../../core/connectorSync");
      await syncAllConnectors(uid, true);
      clearDataCaches();
      toast.success("Calendars updated");
      setOpen(false);
    } catch {
      toast.error("Couldn't save. Try again.");
    }
    setSaving(false);
  };

  const groups: [string, Row[]][] = rows ? [
    ["Yours", rows.filter(r => r.own)],
    ["Shared with you or subscribed", rows.filter(r => !r.own)],
  ] : [];

  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={toggleOpen} aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 12, border: `1.5px solid ${T.linen}`, background: T.surface, color: T.esp, fontFamily: F.sans, fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44 }}>
        Choose calendars
        <ChevronDown size={16} strokeWidth={2} aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }} />
      </button>
      {open && (
        <div style={{ marginTop: 8, padding: "12px 14px", background: T.sand, borderRadius: 12, border: `1px solid ${T.linen}` }}>
          <p style={{ fontFamily: F.sans, fontSize: 12.5, color: T.taupe, margin: "0 0 10px", lineHeight: 1.5 }}>
            Only ticked calendars show in HerNest. Calendars other people share with you, like a colleague's, start unticked.
          </p>
          {failed ? (
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.blush, margin: 0 }}>Couldn't load your calendars. Try again in a moment.</p>
          ) : !rows ? (
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0 }}>Loading your calendars...</p>
          ) : !rows.length ? (
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0 }}>No calendars found.</p>
          ) : (
            <>
              {groups.map(([label, list]) => list.length > 0 && (
                <div key={label} style={{ marginBottom: 10 }}>
                  <p style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: T.taupe, margin: "0 0 4px" }}>{label}</p>
                  {list.map(r => (
                    <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, cursor: "pointer" }}>
                      <input type="checkbox" checked={r.picked}
                        onChange={e => setRows(prev => prev?.map(x => x.id === r.id ? { ...x, picked: e.target.checked } : x) || prev)}
                        style={{ width: 20, height: 20, accentColor: T.action, flexShrink: 0 }} />
                      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: r.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontFamily: F.sans, fontSize: 14, color: T.esp, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                        {r.account && <span style={{ display: "block", fontFamily: F.sans, fontSize: 12, color: T.taupe }}>{r.account}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
              <button onClick={save} disabled={saving}
                style={{ width: "100%", padding: "10px", borderRadius: 12, border: "none", background: T.action, color: T.onAction, fontFamily: F.sans, fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44 }}>
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
