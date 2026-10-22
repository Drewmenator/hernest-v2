// ─── Add bills from a screenshot or a typed line ───────────────────
// Cleo reads it and proposes bills; nothing is saved until the user ticks
// which ones to keep. Up to 3 screenshots at once.
import React, { useRef, useState } from "react";
import toast from "react-hot-toast";
import { T, F } from "../../config/theme";
import { PageTitle, Spinner } from "../../shared/components";
import { formatMoney } from "../../shared/utils/money";
import { CADENCES, type Bill } from "../../core/bills";
import type { AIImage } from "../../core/ai";
import { billsFromScreenshots, billsFromText, fileToImage, suggestionToBill, type BillSuggestion } from "./billReader";
import { GhostButton, PrimaryButton, TextLink } from "./billsUi";
import { inputStyle, ordinal } from "./billsStyle";

const MAX_SHOTS = 3;

function whenText(s: BillSuggestion): string {
  const cad = CADENCES.find(c => c.id === s.cadence)?.label.toLowerCase() || "monthly";
  if (s.cadence === "monthly") return s.dueDay ? `Monthly, on the ${ordinal(s.dueDay)}` : "Monthly, date needed";
  if (!s.dueDate) return `${cad[0].toUpperCase()}${cad.slice(1)}, date needed`;
  const d = new Date(`${s.dueDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return s.cadence === "once" ? `One time, ${d}` : `${cad[0].toUpperCase()}${cad.slice(1)}, next ${d}`;
}

function errorText(code?: string): string {
  if (code === "daily_limit_reached") return "Cleo has done a lot for your family today. She'll be ready again tomorrow.";
  if (code === "burst_limit_reached") return "Give Cleo a minute, then try again.";
  if (code === "unauthenticated") return "Please sign in again.";
  return "Cleo couldn't read that just now. Try again in a moment.";
}

export function BillImport({ mode: initialMode, existing, onAdd, onClose }: {
  mode: "screenshot" | "text";
  existing: Bill[];
  onAdd: (bills: Bill[]) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [shots, setShots] = useState<{ preview: string; image: AIImage }[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<BillSuggestion[] | null>(null);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, MAX_SHOTS - shots.length);
    e.target.value = "";
    if (!files.length) return;
    try {
      const added = await Promise.all(files.map(async f => {
        const image = await fileToImage(f);
        return { image, preview: `data:${image.mediaType};base64,${image.data}` };
      }));
      setShots(s => [...s, ...added].slice(0, MAX_SHOTS));
    } catch {
      toast.error("Couldn't open that image. Try a screenshot or photo.");
    }
  };

  const read = async () => {
    setBusy(true);
    const res = mode === "screenshot"
      ? await billsFromScreenshots(shots.map(s => s.image), existing)
      : await billsFromText(note.trim(), existing);
    setBusy(false);
    // crisis_detected: the crisis sheet is already showing, no error toast.
    if (res.error) { if (res.error !== "crisis_detected") toast.error(errorText(res.error)); return; }
    setSuggestions(res.suggestions);
    // Pre-tick everything except bills you already have.
    setKeep(Object.fromEntries(res.suggestions.map(s => [s.key, !s.duplicateOf])));
  };

  const save = async () => {
    const chosen = (suggestions || []).filter(s => keep[s.key]);
    if (!chosen.length) { onClose(); return; }
    setBusy(true);
    try {
      await onAdd(chosen.map(s => suggestionToBill(s, mode === "screenshot" ? "screenshot" : "text")));
      toast.success(`${chosen.length} bill${chosen.length === 1 ? "" : "s"} added`);
      onClose();
    } catch {
      toast.error("Couldn't save. Try again.");
      setBusy(false);
    }
  };

  // ── Review ─────────────────────────────────────────────────────
  if (suggestions) {
    const count = suggestions.filter(s => keep[s.key]).length;
    return (
      <div style={{ animation: "fadeUp .3s ease both" }}>
        <PageTitle eyebrow="BILLS" title={suggestions.length ? `Found ${suggestions.length} bill${suggestions.length === 1 ? "" : "s"}` : "No bills found"} />
        {suggestions.length === 0 ? (
          <p style={{ fontFamily: F.sans, fontSize: 14, color: T.bark, lineHeight: 1.6, margin: "0 4px 18px" }}>
            {mode === "screenshot"
              ? "Cleo couldn't spot any regular bills there. Screenshots of your card app's transactions, the Settings → Subscriptions page, or an e-bill work best."
              : "Cleo couldn't turn that into a bill. Try something like \"Netflix 15.49 on the 12th\"."}
          </p>
        ) : (
          <>
            <p style={{ fontFamily: F.sans, fontSize: 13.5, color: T.bark, margin: "-4px 4px 14px", lineHeight: 1.5 }}>
              Untick anything that isn't a bill. You can edit details later.
            </p>
            {suggestions.map(s => (
              <label key={s.key}
                style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: `1px solid ${keep[s.key] ? T.esp : T.linen}`, borderRadius: 16, padding: "12px 14px", marginBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={!!keep[s.key]} onChange={e => setKeep(k => ({ ...k, [s.key]: e.target.checked }))} style={{ width: 22, height: 22, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: T.esp }}>
                    {s.name}{s.amount ? ` · ${formatMoney(s.amount)}` : ""}
                  </span>
                  <span style={{ display: "block", fontFamily: F.sans, fontSize: 12.5, color: T.taupe, marginTop: 2 }}>
                    {whenText(s)}
                    {s.duplicateOf ? " · you already have this" : s.unsure ? " · please check the date" : ""}
                  </span>
                </span>
              </label>
            ))}
          </>
        )}
        <PrimaryButton onClick={suggestions.length ? save : () => setSuggestions(null)} disabled={busy} style={{ marginTop: 8 }}>
          {suggestions.length ? (count ? `Add ${count} bill${count === 1 ? "" : "s"}` : "Add none") : "Try again"}
        </PrimaryButton>
        <div style={{ textAlign: "center", marginTop: 6 }}>
          <TextLink onClick={onClose}>Cancel</TextLink>
        </div>
      </div>
    );
  }

  // ── Input ──────────────────────────────────────────────────────
  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <PageTitle eyebrow="BILLS" title={mode === "screenshot" ? "Add from a screenshot" : "Type or say your bills"} />

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {(["screenshot", "text"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
            style={{ flex: 1, padding: "10px", borderRadius: 12, border: `1.5px solid ${mode === m ? T.esp : T.linen}`, background: mode === m ? T.esp : "#fff", color: mode === m ? "#fff" : T.bark, fontFamily: F.sans, fontSize: 13.5, fontWeight: 600, cursor: "pointer", minHeight: 44 }}>
            {m === "screenshot" ? "📸 Screenshot" : "✍️ Type it"}
          </button>
        ))}
      </div>

      {mode === "screenshot" ? (
        <>
          <p style={{ fontFamily: F.sans, fontSize: 13.5, color: T.bark, lineHeight: 1.6, margin: "0 4px 14px" }}>
            Take a screenshot of any of these, then pick it here:
          </p>
          <ul style={{ fontFamily: F.sans, fontSize: 13.5, color: T.bark, lineHeight: 1.7, margin: "0 0 16px", paddingLeft: 22 }}>
            <li>Your bank or card app's recent transactions</li>
            <li>iPhone Settings → your name → Subscriptions</li>
            <li>An e-bill or a utility account page</li>
          </ul>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={pickFiles} style={{ display: "none" }} />
          {shots.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {shots.map((s, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <img src={s.preview} alt={`Screenshot ${i + 1}`} style={{ width: 84, height: 140, objectFit: "cover", borderRadius: 12, border: `1px solid ${T.linen}` }} />
                  <button onClick={() => setShots(x => x.filter((_, j) => j !== i))} aria-label={`Remove screenshot ${i + 1}`}
                    style={{ position: "absolute", top: -8, right: -8, width: 28, height: 28, borderRadius: 14, border: "none", background: T.esp, color: "#fff", cursor: "pointer", fontSize: 13 }}>✕</button>
                </div>
              ))}
            </div>
          )}
          {shots.length < MAX_SHOTS && (
            <GhostButton onClick={() => fileRef.current?.click()} style={{ width: "100%", marginBottom: 10 }}>
              {shots.length ? "Add another screenshot" : "Choose a screenshot"}
            </GhostButton>
          )}
          <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 4px 14px", lineHeight: 1.5 }}>
            Your screenshot is sent to Cleo to read the bills. HerNest doesn't keep a copy.
          </p>
        </>
      ) : (
        <>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} maxLength={1000}
            placeholder={"e.g. daycare 450 every other Friday, car insurance March and September 620, Netflix on the 12th"}
            aria-label="Your bills"
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
          <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "-2px 4px 14px" }}>
            Tip: tap the microphone on your keyboard to say it instead.
          </p>
        </>
      )}

      <PrimaryButton onClick={read} disabled={busy || (mode === "screenshot" ? !shots.length : note.trim().length < 3)}>
        {busy ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Spinner size={16} color="#fff" /> Cleo is reading...</span> : "Find my bills"}
      </PrimaryButton>
      <div style={{ textAlign: "center", marginTop: 6 }}>
        <TextLink onClick={onClose}>Cancel</TextLink>
      </div>
    </div>
  );
}
