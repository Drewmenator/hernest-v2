// ─── Today: "From your email" ──────────────────────────────────────
// To-dos and dates Cleo found overnight in school, activity, doctor, travel
// and due-date email. Add makes a to-do a task in Plan, or puts a date on the
// calendar; Not now hides it. Also asks
// her to reconnect Gmail when Google has signed the app out.
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { todayLocal } from "../../core/dateAwareness";
import { loadMailInbox, addMailItem, dismissMailItem, dueLabel, isMailEvent, whenLabel, type MailItem } from "../../core/mailInbox";

const card: React.CSSProperties = { background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: 16, marginBottom: 12 };
const eyebrow: React.CSSProperties = { fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" };
const pill = (primary: boolean): React.CSSProperties => ({
  padding: "7px 12px", borderRadius: 20, border: primary ? "none" : `1px solid ${T.linen}`,
  background: primary ? T.esp : "none", color: primary ? "#fff" : T.esp,
  fontFamily: F.sans, fontSize: 12, fontWeight: 700, cursor: "pointer", minHeight: 36, flexShrink: 0,
});

const SHOWN = 4;

export function MailInboxCard() {
  const uid = useStore(s => s.user?.uid);
  const [state, setState] = useState<{ items: MailItem[]; needsReconnect: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    loadMailInbox(uid).catch(() => null).then(r => { if (alive) setState(r && r.connected ? r : null); });
    return () => { alive = false; };
  }, [uid, version]);

  if (!uid || !state || (!state.items.length && !state.needsReconnect)) return null;

  const act = async (item: MailItem, add: boolean) => {
    if (busy) return;
    setBusy(item.id);
    try {
      if (add) { await addMailItem(uid, item); toast.success(isMailEvent(item) ? "Added to your calendar" : "Added to Plan"); }
      else await dismissMailItem(uid, item.id);
      setState(s => (s ? { ...s, items: s.items.filter(i => i.id !== item.id) } : s));
    } catch { toast.error("Couldn't save. Try again."); }
    finally { setBusy(null); }
  };

  const reconnect = async () => {
    const { connectOAuth } = await import("../../core/connectorSync");
    await connectOAuth("gmail");
    setVersion(v => v + 1);
  };

  const today = todayLocal();
  const shown = showAll ? state.items : state.items.slice(0, SHOWN);

  return (
    <div style={card}>
      <p style={eyebrow}>From your email</p>
      {state.needsReconnect && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0 10px" }}>
          <p style={{ flex: 1, fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0, lineHeight: 1.5 }}>
            Google signed Cleo out of your Gmail. Reconnect so she can keep checking school and family email.
          </p>
          <button onClick={reconnect} style={pill(true)}>Reconnect</button>
        </div>
      )}
      {shown.map((it, i) => (
        <div key={it.id} style={{ padding: "9px 0", borderTop: i || state.needsReconnect ? `1px solid ${T.linen}` : "none" }}>
          <p style={{ fontFamily: F.sans, fontSize: 13.5, fontWeight: 600, color: T.esp, margin: 0 }}>{it.title}</p>
          <p style={{ fontFamily: F.sans, fontSize: 11.5, color: T.taupe, margin: "2px 0 8px", lineHeight: 1.4 }}>
            {[isMailEvent(it) ? whenLabel(it) : dueLabel(it.dueDate, today), it.child, it.subject].filter(Boolean).join(" · ")}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => act(it, true)} disabled={busy === it.id} style={pill(true)}>{busy === it.id ? "…" : isMailEvent(it) ? "Add to calendar" : "Add"}</button>
            <button onClick={() => act(it, false)} disabled={busy === it.id} style={pill(false)}>Not now</button>
          </div>
        </div>
      ))}
      {state.items.length > SHOWN && (
        <button onClick={() => setShowAll(v => !v)}
          style={{ background: "none", border: "none", padding: 0, fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: T.goldText, cursor: "pointer", minHeight: 32 }}>
          {showAll ? "Show fewer" : `Show all ${state.items.length}`}
        </button>
      )}
    </div>
  );
}
