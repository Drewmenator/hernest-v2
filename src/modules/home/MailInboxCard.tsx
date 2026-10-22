// ─── Today: "From your email" ──────────────────────────────────────
// To-dos and dates Cleo found overnight in school, activity, doctor, travel
// and due-date email. Add makes a to-do a task in Plan, or puts a date on the
// calendar; Not now hides it. Also asks
// her to reconnect Gmail when Google has signed the app out.
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { T, S } from "../../config/theme";
import { Card, SectionHeader, ListRow, Button, TextButton } from "../../shared/components";
import { useStore } from "../../core/store";
import { todayLocal } from "../../core/dateAwareness";
import { loadMailInbox, onMailUpdated, addMailItem, dismissMailItem, dueLabel, isMailEvent, whenLabel, type MailItem } from "../../core/mailInbox";
import { onAppResumed } from "../../core/healthRefresh";

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
  // New email items (the server scans overnight) show when the app resumes.
  useEffect(() => onAppResumed(() => setVersion(v => v + 1)), []);
  useEffect(() => onMailUpdated(() => setVersion(v => v + 1)), []);

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
    <section aria-label="From your email">
      <SectionHeader title="From your email" />
      <Card style={{ padding: `${S.xs}px ${S.lg}px` }}>
        {state.needsReconnect && (
          <ListRow divider={false}
            title="Reconnect Gmail"
            detail="Google signed Cleo out of your Gmail. Reconnect so she can keep checking school and family email."
            actions={<Button size="sm" onClick={reconnect} style={{ width: "auto" }}>Reconnect</Button>} />
        )}
        {shown.map((it, i) => (
          <ListRow key={it.id} divider={i > 0 || state.needsReconnect}
            title={it.title}
            detail={[isMailEvent(it) ? whenLabel(it) : dueLabel(it.dueDate, today), it.child, it.subject].filter(Boolean).join(" · ")}
            actions={<>
              <Button size="sm" onClick={() => act(it, true)} disabled={busy === it.id} style={{ width: "auto" }}>
                {busy === it.id ? "Saving…" : isMailEvent(it) ? "Add to calendar" : "Add to Plan"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => act(it, false)} disabled={busy === it.id} style={{ width: "auto" }}>Not now</Button>
            </>} />
        ))}
        {state.items.length > SHOWN && (
          <div style={{ borderTop: `1px solid ${T.divider}` }}>
            <TextButton onClick={() => setShowAll(v => !v)}>{showAll ? "Show fewer" : `Show all ${state.items.length}`}</TextButton>
          </div>
        )}
      </Card>
    </section>
  );
}
