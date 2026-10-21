// ─── Tap-only bill setup ───────────────────────────────────────────
// 1. Tap the bills you have.  2. Tap roughly what day each is due (or
// "Not sure").  3. Anything else? (a typed line or a screenshot).
// No amounts asked: they're learned when bills get marked paid.
import React, { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { T, F } from "../../config/theme";
import { PageTitle } from "../../shared/components";
import { billKey, iso, type Bill } from "../../core/bills";
import { BILL_PRESETS, type BillPreset } from "./billPresets";
import { DayPicker, GhostButton, PrimaryButton, TextLink } from "./billsUi";
import { ordinal } from "./billsStyle";

type Step = "pick" | "days" | "more";

export function BillSetup({ existing, onAdd, onOpenImport, onDone }: {
  existing: Bill[];
  onAdd: (bills: Bill[]) => Promise<void>;
  onOpenImport: (mode: "screenshot" | "text") => void;
  onDone: () => void;
}) {
  const have = useMemo(() => new Set(existing.map(b => billKey(b.name))), [existing]);
  const presets = BILL_PRESETS.filter(p => !have.has(billKey(p.name)));
  const [step, setStep] = useState<Step>(presets.length ? "pick" : "more");
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState<Record<string, number | undefined>>({});
  const [open, setOpen] = useState<string | null>(null);
  // Bills the user has answered (a day, or "Not sure"), so the picker moves on.
  const [answered, setAnswered] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const chosen = picked.map(id => BILL_PRESETS.find(p => p.id === id)!).filter(Boolean);

  // Record the answer and jump to the next unanswered bill: tap, tap, tap.
  const answer = (id: string) => {
    const done = answered.includes(id) ? answered : [...answered, id];
    setAnswered(done);
    const next = chosen.find(c => !done.includes(c.id));
    setOpen(next ? next.id : null);
  };

  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const saveChosen = async () => {
    setSaving(true);
    const today = iso(new Date());
    const bills: Bill[] = chosen.map((p: BillPreset) => {
      const d = days[p.id];
      return {
        id: crypto.randomUUID(),
        name: p.name,
        cadence: p.cadence,
        ...(d ? { dueDay: d } : { dueUnknown: true }),
        ...(p.varies ? { amountVaries: true } : {}),
        addedOn: today,
        source: "setup" as const,
      };
    });
    try {
      await onAdd(bills);
      toast.success(`${bills.length} bill${bills.length === 1 ? "" : "s"} added`);
      setStep("more");
    } catch {
      toast.error("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const heading = (eyebrow: string, title: string, body: string) => (
    <>
      <PageTitle eyebrow={eyebrow} title={title} />
      <p style={{ fontFamily: F.sans, fontSize: 14, color: T.bark, margin: "-4px 4px 16px", lineHeight: 1.55 }}>{body}</p>
    </>
  );

  if (step === "pick") {
    return (
      <div style={{ animation: "fadeUp .3s ease both" }}>
        {heading("BILLS · 1 OF 3", "Which of these do you have?", "Tap all that apply. You can change anything later.")}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 18 }}>
          {presets.map(p => {
            const on = picked.includes(p.id);
            return (
              <button key={p.id} onClick={() => toggle(p.id)} aria-pressed={on}
                style={{ background: on ? T.esp : "#fff", color: on ? "#fff" : T.esp, border: `1.5px solid ${on ? T.esp : T.linen}`, borderRadius: 14,
                  padding: "12px 6px", minHeight: 76, cursor: "pointer", touchAction: "manipulation" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }} aria-hidden>{p.icon}</div>
                <div style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, lineHeight: 1.25 }}>{p.name}</div>
              </button>
            );
          })}
        </div>
        <PrimaryButton onClick={() => { setOpen(picked[0] || null); setAnswered([]); setStep("days"); }} disabled={!picked.length}>
          {picked.length ? `Next (${picked.length})` : "Pick at least one"}
        </PrimaryButton>
        <div style={{ textAlign: "center", marginTop: 6 }}>
          <TextLink onClick={() => setStep("more")}>None of these, skip</TextLink>
        </div>
      </div>
    );
  }

  if (step === "days") {
    const doneCount = chosen.filter(p => days[p.id]).length;
    return (
      <div style={{ animation: "fadeUp .3s ease both" }}>
        {heading("BILLS · 2 OF 3", "Roughly what day is each due?", "Not sure? That's fine. We'll ask again when the bill arrives.")}
        {chosen.map(p => {
          const d = days[p.id];
          const isOpen = open === p.id;
          return (
            <div key={p.id} style={{ background: "#fff", border: `1px solid ${T.linen}`, borderRadius: 16, padding: "12px 14px", marginBottom: 8 }}>
              <button onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", minHeight: 36 }}>
                <span style={{ fontSize: 20 }} aria-hidden>{p.icon}</span>
                <span style={{ flex: 1, textAlign: "left", fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: T.esp }}>{p.name}</span>
                <span style={{ fontFamily: F.sans, fontSize: 13, color: d ? T.esp : T.taupe, fontWeight: d ? 700 : 500 }}>
                  {d ? `the ${ordinal(d)}` : "Not sure"}
                </span>
              </button>
              {isOpen && (
                <div style={{ marginTop: 10 }}>
                  <DayPicker value={d} allowUnsure
                    onPick={v => { setDays(s => ({ ...s, [p.id]: v })); answer(p.id); }}
                    onUnsure={() => { setDays(s => ({ ...s, [p.id]: undefined })); answer(p.id); }} />
                </div>
              )}
            </div>
          );
        })}
        <PrimaryButton onClick={saveChosen} disabled={saving} style={{ marginTop: 8 }}>
          {saving ? "Saving..." : doneCount === chosen.length ? "Save bills" : `Save (${chosen.length - doneCount} without a day)`}
        </PrimaryButton>
        <div style={{ textAlign: "center", marginTop: 6 }}>
          <TextLink onClick={() => setStep("pick")}>Back</TextLink>
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      {heading("BILLS · 3 OF 3", "Anything else?", "Daycare, the babysitter, a school fee, a subscription we didn't list. Add it whichever way is easiest.")}
      <button onClick={() => onOpenImport("screenshot")}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, background: "#fff", border: `1px solid ${T.linen}`, borderRadius: 16, padding: "16px", marginBottom: 10, cursor: "pointer", textAlign: "left", minHeight: 72 }}>
        <span style={{ fontSize: 26 }} aria-hidden>📸</span>
        <span>
          <span style={{ display: "block", fontFamily: F.sans, fontSize: 15, fontWeight: 700, color: T.esp }}>From a screenshot</span>
          <span style={{ display: "block", fontFamily: F.sans, fontSize: 12.5, color: T.taupe, marginTop: 2 }}>Your card app, Settings → Subscriptions, or an e-bill</span>
        </span>
      </button>
      <button onClick={() => onOpenImport("text")}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, background: "#fff", border: `1px solid ${T.linen}`, borderRadius: 16, padding: "16px", marginBottom: 18, cursor: "pointer", textAlign: "left", minHeight: 72 }}>
        <span style={{ fontSize: 26 }} aria-hidden>✍️</span>
        <span>
          <span style={{ display: "block", fontFamily: F.sans, fontSize: 15, fontWeight: 700, color: T.esp }}>Type or say it</span>
          <span style={{ display: "block", fontFamily: F.sans, fontSize: 12.5, color: T.taupe, marginTop: 2 }}>"Daycare 450 every other Friday"</span>
        </span>
      </button>
      <PrimaryButton onClick={onDone}>Done</PrimaryButton>
      {presets.length > 0 && (
        <div style={{ textAlign: "center", marginTop: 6 }}>
          <GhostButton onClick={() => { setPicked([]); setDays({}); setStep("pick"); }} style={{ border: "none" }}>Back to the list</GhostButton>
        </div>
      )}
    </div>
  );
}
