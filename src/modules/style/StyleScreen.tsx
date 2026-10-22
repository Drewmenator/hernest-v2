// ─── Style: one answer, one question ───────────────────────────────
// 1. Today's look: opens on one outfit built from the weather, her calendar
//    and what she's taught Cleo. Wear this / Something else / Dressier /
//    More casual / Don't have that. No quiz and no closet photos: her taps
//    are how Cleo learns what she likes and owns.
// 2. "Dress me for...": type an occasion or tap an upcoming event; one
//    outfit plus a simpler backup.
// 3. Your style: size, style words and budget, set once.
// Saved looks and the wish list are no longer shown; their data is kept.
// Export name stays StyleScreen so the Me tab can render it.
import React, { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { trackEvent } from "../../core/analytics";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, Input, Spinner, Emoji } from "../../shared/components";
import { loadData, saveData } from "../../core/firebase";
import { ai } from "../../core/ai";
import { s } from "../../core/aiSchema";
import { bus } from "../../core/events";
import { todayLocal } from "../../core/dateAwareness";
import { formatMoney, getCurrency } from "../../shared/utils/money";
import type { WeatherData } from "../../core/weather";
import type { SimpleEvent } from "../../core/upcomingEvents";
import { weatherForOutfit } from "./styleWeather";
import {
  OCCASIONS, STYLE_WORDS, US_SIZES, BUDGET_STEPS, OUTFIT_SYSTEM,
  occasionLabel, occasionForDay, comingUp, weatherLine, dayLine, whenLabel, formatTime,
  readStyleProfile, hasProfile, profileLine, isOldSize, buildOutfitPrompt, parseOutfit,
  readStyleMemory, remember,
  type Outfit, type StyleProfile, type StyleMemory, type Shift,
} from "./styleLogic";

interface Shown { outfit: Outfit; occasion: string | null; wearing?: boolean }
interface DayContext { weather: WeatherData | null; todays: SimpleEvent[]; profile: StyleProfile; memory: StyleMemory }
interface Ask { occasion: string | null; event?: SimpleEvent; occasionText?: string; avoid?: string[]; shift?: { to: Shift; from: string } | null }

const MAX_WORDS = 3;

const OUTFIT_SCHEMA = s.object({
  headline: s.string("the whole outfit in one line"),
  pieces: s.array(s.object({ item: s.string(), note: s.string("max 8 words") })),
  why: s.string("one or two short sentences"),
  tip: s.nullable(s.string()),
  backup: s.nullable(s.string("a second, simpler outfit in one line")),
});

const label: React.CSSProperties = { fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.taupe, margin: "0 0 10px" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", padding: "6px 0", fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: T.goldText, cursor: "pointer", minHeight: 32 };
const chip = (on: boolean): React.CSSProperties => ({
  padding: "8px 13px", borderRadius: 20, border: `1.5px solid ${on ? T.esp : T.linen}`, background: on ? T.esp : "#fff",
  color: on ? "#fff" : T.bark, fontFamily: F.sans, fontSize: 13, cursor: "pointer", touchAction: "manipulation", minHeight: 38,
});
const actionBtn = (primary: boolean): React.CSSProperties => ({
  flex: 1, padding: "11px 8px", borderRadius: 12, border: primary ? "none" : `1.5px solid ${T.linen}`,
  background: primary ? T.action : "#fff", color: primary ? "#fff" : T.esp,
  fontFamily: F.sans, fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44, touchAction: "manipulation",
});
const smallBtn: React.CSSProperties = { ...actionBtn(false), fontSize: 12, fontWeight: 600, padding: "9px 6px", minHeight: 40 };

function OutfitView({ outfit, showBackup = false }: { outfit: Outfit; showBackup?: boolean }) {
  return (
    <>
      <p style={{ fontFamily: F.serif, letterSpacing: "-0.02em", fontSize: 20, fontWeight: 600, color: T.esp, margin: "0 0 10px", lineHeight: 1.3 }}>{outfit.headline}</p>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
        {outfit.pieces.map((p, i) => (
          <li key={i} style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, padding: "5px 0", borderTop: i ? `1px solid ${T.linen}` : "none" }}>
            <strong style={{ fontWeight: 600 }}>{p.item}</strong>{p.note ? <span style={{ color: T.taupe }}> · {p.note}</span> : null}
          </li>
        ))}
      </ul>
      {outfit.why && <p style={{ fontFamily: F.sans, fontSize: 13, color: T.bark, margin: "0 0 6px", lineHeight: 1.5 }}>{outfit.why}</p>}
      {outfit.tip && <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: 0, fontStyle: "italic" }}>Tip: {outfit.tip}</p>}
      {showBackup && outfit.backup && <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: "8px 0 0" }}><strong style={{ fontWeight: 600 }}>Or keep it simple:</strong> {outfit.backup}</p>}
    </>
  );
}

// "Which one don't you have?" Tapping a piece remembers it and swaps it out.
function NotOwnedPicker({ outfit, onPick, onCancel }: { outfit: Outfit; onPick: (item: string) => void; onCancel: () => void }) {
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: "0 0 8px" }}>Which one don't you have? Cleo won't suggest it again.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {outfit.pieces.map(p => <button key={p.item} onClick={() => onPick(p.item)} style={chip(false)}>{p.item}</button>)}
        <button onClick={onCancel} style={linkBtn}>Cancel</button>
      </div>
    </div>
  );
}

export function StyleScreen() {
  const { user, profile: userProfile } = useStore();
  const uid = user?.uid;
  const city = userProfile?.city || "";
  const today = todayLocal();
  const currency = getCurrency();

  const [docLoaded, setDocLoaded] = useState(false);
  const [ctxLoaded, setCtxLoaded] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [events, setEvents] = useState<SimpleEvent[]>([]);

  const [profile, setProfile] = useState<StyleProfile>(readStyleProfile(null));
  const [draft, setDraft] = useState<StyleProfile>(readStyleProfile(null));
  const [editingProfile, setEditingProfile] = useState(false);
  const [memory, setMemory] = useState<StyleMemory>(readStyleMemory(null));
  const memRef = useRef<StyleMemory>(readStyleMemory(null));

  const [shown, setShown] = useState<Shown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pickingMissing, setPickingMissing] = useState<"today" | "dress" | null>(null);
  const tried = useRef<string[]>([]);

  // "Dress me for..."
  const [occasionText, setOccasionText] = useState("");
  const [dress, setDress] = useState<{ key: string; title: string; outfit: Outfit | null; loading: boolean; ask: Ask } | null>(null);

  const todays = events.filter(e => e.date === today);
  const ctx: DayContext = { weather, todays, profile, memory };
  const upcoming = comingUp(events, today);
  const autoOccasion = occasionForDay(todays);

  const saveMemory = (m: StyleMemory) => {
    memRef.current = m;
    setMemory(m);
    if (uid) saveData(uid, "style", { memory: m }).catch(() => {});
  };

  const askForOutfit = async (c: DayContext, a: Ask): Promise<Outfit | null> => {
    const prompt = buildOutfitPrompt({
      weather: weatherLine(c.weather), events: a.event || a.occasionText ? [] : c.todays, occasion: a.occasion,
      eventTitle: a.event?.title, occasionText: a.occasionText,
      when: a.event ? `${whenLabel(a.event.date, today)}${a.event.time ? ` at ${formatTime(a.event.time)}` : ""}` : undefined,
      profile: c.profile, currencyCode: currency, avoid: a.avoid || [], memory: memRef.current, shift: a.shift,
    });
    // A typed occasion is her own words: checked for distress first (crisis.ts).
    const res = await ai(OUTFIT_SYSTEM, prompt, "style_stylist", [], { schema: OUTFIT_SCHEMA, ...(a.occasionText ? { userText: a.occasionText } : {}) });
    return res.error ? null : parseOutfit(res.text);
  };

  // ── Today's look ─────────────────────────────────────────────────
  const showToday = async (c: DayContext, occasion: string | null, opts: { another?: boolean; shift?: Shift } = {}) => {
    if (!uid || loading) return;
    setLoading(true); setError(""); setPickingMissing(null);
    if (!opts.another && !opts.shift) tried.current = [];
    const shift = opts.shift && shown ? { to: opts.shift, from: shown.outfit.headline } : null;
    const outfit = await askForOutfit(c, { occasion, avoid: tried.current.slice(-3), shift });
    setLoading(false);
    if (!outfit) { setError("Cleo couldn't put a look together just now. Try again in a moment."); return; }
    tried.current.push(outfit.headline);
    setShown({ outfit, occasion });
    saveData(uid, "style", { todayOutfit: { date: today, occasion, outfit } }).catch(() => {});
    bus.publish("style.outfit.generated", { occasion: occasion || "today" }, { userId: uid, source: "style" }).catch(() => {});
    trackEvent("outfit_generated", { occasion: occasion || "auto", another: !!opts.another, shift: opts.shift || null });
  };

  const wearThis = () => {
    if (!uid || !shown) return;
    saveMemory(remember(memRef.current, "liked", shown.outfit.headline));
    setShown({ ...shown, wearing: true });
    saveData(uid, "style", { todayOutfit: { date: today, occasion: shown.occasion, outfit: shown.outfit, wearing: true } }).catch(() => {});
    trackEvent("outfit_worn", { occasion: shown.occasion || "auto" });
    toast.success("Have a good day");
  };

  const somethingElse = () => {
    if (shown && !shown.wearing) saveMemory(remember(memRef.current, "passed", shown.outfit.headline));
    showToday(ctx, shown?.occasion ?? autoOccasion, { another: true });
  };

  const dontHave = (item: string, where: "today" | "dress") => {
    const m = remember(memRef.current, "notOwned", item);
    saveMemory(m);
    setPickingMissing(null);
    trackEvent("style_not_owned");
    toast(`Got it. No more ${item.toLowerCase()}.`, { icon: <Emoji e="✦" size={16} /> });
    if (where === "today") showToday({ ...ctx, memory: m }, shown?.occasion ?? autoOccasion, { another: true });
    else if (dress) runDress(dress.key, dress.title, { ...dress.ask, avoid: [...(dress.ask.avoid || []), ...(dress.outfit ? [dress.outfit.headline] : [])] });
  };

  // ── Load: style doc, weather, calendar; then open straight on today's
  // look (no typing, no picking) unless one was already made today ────
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    const docP = loadData(uid, "style").catch(() => null);
    docP.then(d => {
      if (!alive) return;
      const p = readStyleProfile(d);
      setProfile(p); setDraft(p);
      const m = readStyleMemory(d);
      memRef.current = m; setMemory(m);
      const t = d?.todayOutfit as { date?: string; occasion?: string | null; outfit?: Outfit; wearing?: boolean } | undefined;
      if (t?.date === today && t.outfit) { setShown({ outfit: t.outfit, occasion: t.occasion ?? null, wearing: !!t.wearing }); tried.current = [t.outfit.headline]; }
      setDocLoaded(true);
    });
    Promise.all([
      docP,
      weatherForOutfit(city).catch(() => null),
      import("../../core/upcomingEvents").then(m => m.loadUpcomingEvents(uid, 8)).catch(() => [] as SimpleEvent[]),
    ]).then(([d, w, evs]) => {
      if (!alive) return;
      setWeather(w); setEvents(evs); setCtxLoaded(true);
      const cached = (d?.todayOutfit as { date?: string } | undefined)?.date === today;
      const dayEvents = evs.filter(e => e.date === today);
      if (!cached) showToday({ weather: w, todays: dayEvents, profile: readStyleProfile(d), memory: readStyleMemory(d) }, occasionForDay(dayEvents));
    });
    return () => { alive = false; };
    // showToday only reads stable refs/setters; reload when the day or city changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, today, city]);

  // ── Dress me for... ──────────────────────────────────────────────
  const runDress = async (key: string, title: string, ask: Ask) => {
    setPickingMissing(null);
    setDress({ key, title, outfit: null, loading: true, ask });
    const outfit = await askForOutfit(ctx, ask);
    setDress({ key, title, outfit, loading: false, ask });
    if (!outfit) toast.error("Couldn't get an idea for that one. Try again.");
  };
  const dressForEvent = (e: SimpleEvent & { occasion: string }) => {
    if (dress?.key === e.id && dress.outfit) { setDress(null); return; }
    runDress(e.id, e.title, { occasion: e.occasion, event: e });
    trackEvent("outfit_planned_ahead", { occasion: e.occasion, from: "calendar" });
  };
  const dressForTyped = () => {
    const text = occasionText.trim();
    if (!text) return;
    runDress(`typed:${text}`, text, { occasion: null, occasionText: text.slice(0, 120) });
    trackEvent("outfit_planned_ahead", { from: "typed" });
  };
  const dressAnother = () => {
    if (!dress) return;
    runDress(dress.key, dress.title, { ...dress.ask, avoid: [...(dress.ask.avoid || []), ...(dress.outfit ? [dress.outfit.headline] : [])].slice(-3) });
  };

  // ── Your style (set once) ────────────────────────────────────────
  const saveProfile = async () => {
    if (!uid) return;
    setProfile(draft); setEditingProfile(false);
    await saveData(uid, "style", { size: draft.size, styleWords: draft.words, budgetAmount: draft.budget });
    bus.publish("style.preference.updated", { words: draft.words }, { userId: uid, source: "style" }).catch(() => {});
    trackEvent("style_profile_saved", { hasSize: !!draft.size, words: draft.words.length, hasBudget: !!draft.budget });
    toast.success("Got it. Cleo will dress you for this.");
  };
  const toggleWord = (w: string) => setDraft(d => ({
    ...d, words: d.words.includes(w) ? d.words.filter(x => x !== w) : d.words.length >= MAX_WORDS ? d.words : [...d.words, w],
  }));
  const forget = (item: string) => saveMemory({ ...memRef.current, notOwned: memRef.current.notOwned.filter(x => x !== item) });

  // ── UI ───────────────────────────────────────────────────────────
  const context = [weather && weatherLine(weather), todays.length ? dayLine(todays) : "Nothing on your calendar"].filter(Boolean).join(" · ");
  const profileOpen = editingProfile || (docLoaded && !hasProfile(profile));

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle eyebrow="Just for you" title="Style" />

      {/* 1. Today's look */}
      <Card>
        <p style={label}>{shown?.occasion ? `Today's look · ${occasionLabel(shown.occasion)}` : "Today's look"}</p>
        {ctxLoaded && <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "-4px 0 12px", lineHeight: 1.5 }}>{weather && <><Emoji e={weather.icon} size={14} /> </>}{context}</p>}

        {loading || (!shown && !error) ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 0" }}>
            <Spinner size={18} />
            <span style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe }}>{ctxLoaded ? "Putting a look together..." : "Checking the weather and your day..."}</span>
          </div>
        ) : error && !shown ? (
          <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: "0 0 12px" }}>{error}</p>
        ) : shown ? (
          <OutfitView outfit={shown.outfit} />
        ) : null}
        {error && shown && <p style={{ fontFamily: F.sans, fontSize: 12, color: T.red, margin: "8px 0 0" }}>{error}</p>}

        {!loading && error && !shown && (
          <button onClick={() => showToday(ctx, autoOccasion)} style={{ ...actionBtn(true), width: "100%", marginTop: 8 }}>Try again</button>
        )}
        {!loading && shown && (
          <>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {shown.wearing
                ? <span style={{ ...actionBtn(false), display: "flex", alignItems: "center", justifyContent: "center", color: T.sage, borderColor: `${T.sage}60` }}>✓ Wearing this today</span>
                : <button onClick={wearThis} style={actionBtn(true)}>Wear this</button>}
              <button onClick={somethingElse} style={actionBtn(false)}>Something else</button>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={() => showToday(ctx, shown.occasion, { shift: "dressier" })} style={smallBtn}>Dressier</button>
              <button onClick={() => showToday(ctx, shown.occasion, { shift: "casual" })} style={smallBtn}>More casual</button>
              <button onClick={() => setPickingMissing(p => (p === "today" ? null : "today"))} aria-expanded={pickingMissing === "today"} style={smallBtn}>Don't have that</button>
            </div>
            {pickingMissing === "today" && <NotOwnedPicker outfit={shown.outfit} onPick={i => dontHave(i, "today")} onCancel={() => setPickingMissing(null)} />}
          </>
        )}
      </Card>

      {/* 2. Dress me for... */}
      <Card>
        <p style={label}>Dress me for...</p>
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={occasionText} onChange={setOccasionText} placeholder="e.g. beach wedding Saturday" label="What are you dressing for?" style={{ flex: 1 }} />
          <button onClick={dressForTyped} disabled={!occasionText.trim()} style={{ ...actionBtn(true), flex: "0 0 auto", padding: "0 16px", opacity: occasionText.trim() ? 1 : 0.5 }}>Go</button>
        </div>
        {upcoming.length > 0 && (
          <>
            <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "12px 0 6px" }}>Or from your calendar</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {upcoming.map(e => (
                <button key={e.id} onClick={() => dressForEvent(e)} aria-pressed={dress?.key === e.id} style={chip(dress?.key === e.id)}>
                  <Emoji e={OCCASIONS.find(o => o.id === e.occasion)?.emoji} size={15} /> {e.title} · {whenLabel(e.date, today)}
                </button>
              ))}
            </div>
          </>
        )}
        {dress && (
          <div style={{ padding: "14px 0 0" }}>
            {dress.loading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Spinner size={16} /><span style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe }}>Dressing you for {dress.title}...</span></div>
            ) : dress.outfit ? (
              <>
                <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 6px" }}>For {dress.title}</p>
                <OutfitView outfit={dress.outfit} showBackup />
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={dressAnother} style={smallBtn}>Another idea</button>
                  <button onClick={() => setPickingMissing(p => (p === "dress" ? null : "dress"))} aria-expanded={pickingMissing === "dress"} style={smallBtn}>Don't have that</button>
                </div>
                {pickingMissing === "dress" && <NotOwnedPicker outfit={dress.outfit} onPick={i => dontHave(i, "dress")} onCancel={() => setPickingMissing(null)} />}
              </>
            ) : null}
          </div>
        )}
      </Card>

      {/* 3. Your style (set once) */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <p style={label}>Your style</p>
          {!profileOpen && <button onClick={() => { setDraft(profile); setEditingProfile(true); }} style={linkBtn}>Edit</button>}
        </div>
        {!profileOpen ? (
          <>
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0 }}>{profileLine(profile, n => formatMoney(n))}</p>
            {memory.notOwned.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 6px" }}>Cleo won't suggest (tap to undo)</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {memory.notOwned.map(i => <button key={i} onClick={() => forget(i)} aria-label={`Suggest ${i} again`} style={{ ...chip(false), fontSize: 12, padding: "6px 10px", minHeight: 32 }}>{i} ×</button>)}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: "0 0 12px" }}>Three quick things. After that, Cleo learns from what you wear and skip.</p>
            <p style={{ ...label, margin: "0 0 8px" }}>Size (US)</p>
            {isOldSize(draft.size) && (
              <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 8px" }}>You saved "{draft.size}" before. Pick your US size so ideas fit.</p>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {US_SIZES.map(sz => <button key={sz} onClick={() => setDraft(d => ({ ...d, size: d.size === sz ? "" : sz }))} style={chip(draft.size === sz)}>{sz}</button>)}
            </div>
            <p style={{ ...label, margin: "0 0 8px" }}>Style words (up to {MAX_WORDS})</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {STYLE_WORDS.map(w => <button key={w} onClick={() => toggleWord(w)} style={chip(draft.words.includes(w))}>{w}</button>)}
            </div>
            <p style={{ ...label, margin: "0 0 8px" }}>Typical budget for an outfit</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {BUDGET_STEPS.map(b => (
                <button key={b} onClick={() => setDraft(d => ({ ...d, budget: d.budget === b ? null : b }))} style={chip(draft.budget === b)}>
                  {b === BUDGET_STEPS[BUDGET_STEPS.length - 1] ? `${formatMoney(b)}+` : `Up to ${formatMoney(b)}`}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={saveProfile} disabled={!hasProfile(draft)} style={{ ...actionBtn(true), opacity: hasProfile(draft) ? 1 : 0.5 }}>Save</button>
              {editingProfile && <button onClick={() => setEditingProfile(false)} style={actionBtn(false)}>Cancel</button>}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
