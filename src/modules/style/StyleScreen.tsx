// ─── Style (made practical) ────────────────────────────────────────
// "What do I wear today?" in one tap. Opens straight on today's outfit, built
// from the weather and her calendar, so she types nothing first. Then: events
// coming up worth planning for, saved looks (with the old wishlist as "Want
// to buy") and a short set-once profile in US sizes and her currency.
// Export name stays StyleScreen so the Me tab can render it.
import React, { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { trackEvent } from "../../core/analytics";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, Input, Spinner } from "../../shared/components";
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
  OCCASIONS, STYLE_WORDS, US_SIZES, BODY_SHAPES, BUDGET_STEPS, OUTFIT_SYSTEM,
  occasionLabel, occasionForDay, comingUp, weatherLine, dayLine, whenLabel, formatTime,
  readStyleProfile, hasProfile, profileLine, buildOutfitPrompt, parseOutfit, lookView,
  type Outfit, type SavedLook, type StyleProfile,
} from "./styleLogic";

interface WishItem { id: string; name: string; category: string; addedAt: number; }
interface Shown { outfit: Outfit; occasion: string | null; }
interface DayContext { weather: WeatherData | null; todays: SimpleEvent[]; profile: StyleProfile; }

const HEIGHTS = ["Petite (under 5'4\")", "Average (5'4\"-5'7\")", "Tall (5'7\"+)"];
const MAX_WORDS = 3;

const OUTFIT_SCHEMA = s.object({
  headline: s.string("the whole outfit in one line"),
  pieces: s.array(s.object({ item: s.string(), note: s.string("max 8 words") })),
  why: s.string("one or two short sentences"),
  tip: s.nullable(s.string()),
});

const label: React.CSSProperties = { fontFamily: F.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", padding: "6px 0", fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: T.goldText, cursor: "pointer", minHeight: 32 };
const chip = (on: boolean): React.CSSProperties => ({
  padding: "8px 13px", borderRadius: 20, border: `1.5px solid ${on ? T.esp : T.linen}`, background: on ? T.esp : "#fff",
  color: on ? "#fff" : T.bark, fontFamily: F.sans, fontSize: 13, cursor: "pointer", touchAction: "manipulation", minHeight: 38,
});
const actionBtn = (primary: boolean): React.CSSProperties => ({
  flex: 1, padding: "11px 8px", borderRadius: 12, border: primary ? "none" : `1.5px solid ${T.linen}`,
  background: primary ? `linear-gradient(135deg,${T.esp},#4a2e18)` : "#fff", color: primary ? "#fff" : T.esp,
  fontFamily: F.sans, fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44, touchAction: "manipulation",
});

function OutfitView({ outfit }: { outfit: Outfit }) {
  return (
    <>
      <p style={{ fontFamily: F.serif, fontSize: 20, fontWeight: 600, color: T.esp, margin: "0 0 10px", lineHeight: 1.3 }}>{outfit.headline}</p>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
        {outfit.pieces.map((p, i) => (
          <li key={i} style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, padding: "5px 0", borderTop: i ? `1px solid ${T.linen}` : "none" }}>
            <strong style={{ fontWeight: 600 }}>{p.item}</strong>{p.note ? <span style={{ color: T.taupe }}> · {p.note}</span> : null}
          </li>
        ))}
      </ul>
      {outfit.why && <p style={{ fontFamily: F.sans, fontSize: 13, color: T.bark, margin: "0 0 6px", lineHeight: 1.5 }}>{outfit.why}</p>}
      {outfit.tip && <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: 0, fontStyle: "italic" }}>Tip: {outfit.tip}</p>}
    </>
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
  const [moreProfile, setMoreProfile] = useState(false);

  const [shown, setShown] = useState<Shown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [askOther, setAskOther] = useState(false);
  const tried = useRef<string[]>([]);

  const [plan, setPlan] = useState<{ eventId: string; outfit: Outfit | null; loading: boolean } | null>(null);

  const [saved, setSaved] = useState<SavedLook[]>([]);
  const [wishlist, setWishlist] = useState<WishItem[]>([]);
  const [savedTab, setSavedTab] = useState<"looks" | "buy">("looks");
  const [wishText, setWishText] = useState("");

  const todays = events.filter(e => e.date === today);
  const ctx: DayContext = { weather, todays, profile };
  const upcoming = comingUp(events, today);
  const autoOccasion = occasionForDay(todays);

  const askForOutfit = async (c: DayContext, opts: { occasion: string | null; event?: SimpleEvent; avoid?: string[] }): Promise<Outfit | null> => {
    const prompt = buildOutfitPrompt({
      weather: weatherLine(c.weather), events: opts.event ? [] : c.todays, occasion: opts.occasion,
      eventTitle: opts.event?.title,
      when: opts.event ? `${whenLabel(opts.event.date, today)}${opts.event.time ? ` at ${formatTime(opts.event.time)}` : ""}` : undefined,
      profile: c.profile, currencyCode: currency, avoid: opts.avoid || [],
    });
    const res = await ai(OUTFIT_SYSTEM, prompt, "style_stylist", [], { schema: OUTFIT_SCHEMA });
    return res.error ? null : parseOutfit(res.text);
  };

  const showToday = async (c: DayContext, occasion: string | null, another = false) => {
    if (!uid || loading) return;
    setLoading(true); setError(""); setAskOther(false);
    if (!another) tried.current = [];
    const outfit = await askForOutfit(c, { occasion, avoid: tried.current.slice(-3) });
    setLoading(false);
    if (!outfit) { setError("Cleo couldn't put a look together just now. Try again in a moment."); return; }
    tried.current.push(outfit.headline);
    setShown({ outfit, occasion });
    saveData(uid, "style", { todayOutfit: { date: today, occasion, outfit } }).catch(() => {});
    bus.publish("style.outfit.generated", { occasion: occasion || "today" }, { userId: uid, source: "style" }).catch(() => {});
    trackEvent("outfit_generated", { occasion: occasion || "auto", another });
  };

  // ── Load: style doc, weather, calendar; then open straight on today's
  // outfit (no typing, no picking) unless one was already made today ────
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    const docP = loadData(uid, "style").catch(() => null);
    docP.then(d => {
      if (!alive) return;
      const p = readStyleProfile(d);
      setProfile(p); setDraft(p);
      setSaved(Array.isArray(d?.saved) ? (d!.saved as SavedLook[]) : []);
      setWishlist(Array.isArray(d?.wishlist) ? (d!.wishlist as WishItem[]) : []);
      const t = d?.todayOutfit as { date?: string; occasion?: string | null; outfit?: Outfit } | undefined;
      if (t?.date === today && t.outfit) { setShown({ outfit: t.outfit, occasion: t.occasion ?? null }); tried.current = [t.outfit.headline]; }
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
      if (!cached) showToday({ weather: w, todays: dayEvents, profile: readStyleProfile(d) }, occasionForDay(dayEvents));
    });
    return () => { alive = false; };
    // showToday only reads stable refs/setters; reload when the day or city changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, today, city]);

  const planFor = async (e: SimpleEvent & { occasion: string }) => {
    if (plan?.eventId === e.id && plan.outfit) { setPlan(null); return; }
    setPlan({ eventId: e.id, outfit: null, loading: true });
    const outfit = await askForOutfit(ctx, { occasion: e.occasion, event: e });
    setPlan({ eventId: e.id, outfit, loading: false });
    if (!outfit) toast.error("Couldn't get an idea for that one. Try again.");
    trackEvent("outfit_planned_ahead", { occasion: e.occasion });
  };

  // ── Saved looks + want to buy ────────────────────────────────────
  const saveLook = async (outfit: Outfit, occasion: string | null, title?: string) => {
    if (!uid) return;
    if (saved.some(l => l.outfit?.headline === outfit.headline)) { toast("Already saved"); return; }
    const look: SavedLook = { id: crypto.randomUUID(), occasion: occasion || "today", ...(title ? { title } : {}), outfit, savedAt: Date.now() };
    const updated = [look, ...saved];
    setSaved(updated);
    await saveData(uid, "style", { saved: updated });
    bus.publish("style.outfit.saved", { occasion: look.occasion }, { userId: uid, source: "style" }).catch(() => {});
    trackEvent("outfit_saved", { occasion: look.occasion });
    toast.success("Saved ♥");
  };
  const removeLook = async (id: string) => {
    if (!uid) return;
    const updated = saved.filter(l => l.id !== id);
    setSaved(updated);
    await saveData(uid, "style", { saved: updated });
  };
  const addWish = async () => {
    if (!uid || !wishText.trim()) return;
    const updated = [{ id: crypto.randomUUID(), name: wishText.trim(), category: "Clothing", addedAt: Date.now() }, ...wishlist];
    setWishlist(updated); setWishText("");
    await saveData(uid, "style", { wishlist: updated });
  };
  const removeWish = async (id: string) => {
    if (!uid) return;
    const updated = wishlist.filter(w => w.id !== id);
    setWishlist(updated);
    await saveData(uid, "style", { wishlist: updated });
  };

  // ── Profile (set once) ───────────────────────────────────────────
  const saveProfile = async () => {
    if (!uid) return;
    setProfile(draft); setEditingProfile(false);
    await saveData(uid, "style", {
      size: draft.size, styleWords: draft.words, budgetAmount: draft.budget, bodyShape: draft.bodyShape, height: draft.height,
    });
    bus.publish("style.preference.updated", { words: draft.words, bodyShape: draft.bodyShape }, { userId: uid, source: "style" }).catch(() => {});
    trackEvent("style_profile_saved", { hasSize: !!draft.size, words: draft.words.length, hasBudget: !!draft.budget });
    toast.success("Got it. Cleo will dress you for this.");
  };
  const toggleWord = (w: string) => setDraft(d => ({
    ...d, words: d.words.includes(w) ? d.words.filter(x => x !== w) : d.words.length >= MAX_WORDS ? d.words : [...d.words, w],
  }));

  // ── UI ───────────────────────────────────────────────────────────
  const context = [weather && `${weather.icon} ${weatherLine(weather)}`, todays.length ? dayLine(todays) : "Nothing on your calendar"].filter(Boolean).join(" · ");
  const profileOpen = editingProfile || (docLoaded && !hasProfile(profile));

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle eyebrow="JUST FOR YOU" title="Style" />

      {/* 1. Today's outfit */}
      <Card>
        <p style={label}>{shown?.occasion ? `TODAY'S OUTFIT · ${occasionLabel(shown.occasion).toUpperCase()}` : "TODAY'S OUTFIT"}</p>
        {ctxLoaded && <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "-4px 0 12px", lineHeight: 1.5 }}>{context}</p>}

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

        {!loading && (shown || error) && (
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => showToday(ctx, shown?.occasion ?? autoOccasion, !!shown)} style={actionBtn(true)}>{shown ? "Another idea" : "Try again"}</button>
            {shown && <button onClick={() => saveLook(shown.outfit, shown.occasion)} style={actionBtn(false)}>Save ♥</button>}
            <button onClick={() => setAskOther(o => !o)} aria-expanded={askOther} style={actionBtn(false)}>Something else</button>
          </div>
        )}
        {askOther && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {OCCASIONS.map(o => <button key={o.id} onClick={() => showToday(ctx, o.id)} style={chip(false)}>{o.emoji} {o.label}</button>)}
          </div>
        )}
      </Card>

      {/* 2. Coming up */}
      {upcoming.length > 0 && (
        <Card>
          <p style={label}>COMING UP</p>
          {upcoming.map((e, i) => {
            const open = plan?.eventId === e.id;
            return (
              <div key={e.id} style={{ borderTop: i ? `1px solid ${T.linen}` : "none", padding: "8px 0" }}>
                <button onClick={() => planFor(e)} aria-expanded={open}
                  style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", minHeight: 44 }}>
                  <span style={{ fontSize: 18 }}>{OCCASIONS.find(o => o.id === e.occasion)?.emoji}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "block", fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.esp }}>{e.title}</span>
                    <span style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe }}>{whenLabel(e.date, today)}{e.time ? ` · ${formatTime(e.time)}` : ""}</span>
                  </span>
                  <span style={{ fontFamily: F.sans, fontSize: 12, fontWeight: 600, color: T.goldText }}>{open && plan?.outfit ? "Hide" : "Get an idea"}</span>
                </button>
                {open && (
                  <div style={{ padding: "10px 0 4px" }}>
                    {plan!.loading ? <Spinner size={16} /> : plan!.outfit ? (
                      <>
                        <OutfitView outfit={plan!.outfit} />
                        <button onClick={() => saveLook(plan!.outfit!, e.occasion, e.title)} style={{ ...linkBtn, marginTop: 6 }}>Save this look ♥</button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {/* 3. Saved looks + want to buy */}
      <Card>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => setSavedTab("looks")} style={chip(savedTab === "looks")}>Saved looks ({saved.length})</button>
          <button onClick={() => setSavedTab("buy")} style={chip(savedTab === "buy")}>Want to buy ({wishlist.length})</button>
        </div>
        {savedTab === "looks" ? (
          saved.length === 0
            ? <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0 }}>Tap Save on a look you like and it lives here for the next busy morning.</p>
            : saved.map((l, i) => {
              const v = lookView(l);
              return (
                <div key={l.id} style={{ display: "flex", gap: 8, padding: "10px 0", borderTop: i ? `1px solid ${T.linen}` : "none" }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "0 0 2px" }}>
                      {v.title}{l.savedAt ? ` · ${new Date(l.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                    </p>
                    <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.esp, margin: 0 }}>{v.headline || "Saved look"}</p>
                    {v.note && <p style={{ fontFamily: F.sans, fontSize: 12, color: T.bark, margin: "4px 0 0", lineHeight: 1.5 }}>{v.note}</p>}
                  </div>
                  <button onClick={() => removeLook(l.id)} aria-label="Remove saved look" style={{ background: "none", border: "none", color: T.taupe, cursor: "pointer", fontSize: 18, minWidth: 44, minHeight: 44 }}>×</button>
                </div>
              );
            })
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <Input value={wishText} onChange={setWishText} placeholder="e.g. Black ankle boots" style={{ flex: 1 }} />
              <button onClick={addWish} disabled={!wishText.trim()} style={{ ...actionBtn(true), flex: "0 0 auto", padding: "0 16px", opacity: wishText.trim() ? 1 : 0.5 }}>Add</button>
            </div>
            {wishlist.length === 0
              ? <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0 }}>Things you'd like to buy, so you remember when you're out.</p>
              : wishlist.map((w, i) => (
                <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: i ? `1px solid ${T.linen}` : "none" }}>
                  <span style={{ flex: 1, fontFamily: F.sans, fontSize: 14, color: T.esp }}>{w.name}</span>
                  <button onClick={() => removeWish(w.id)} aria-label={`Remove ${w.name}`} style={{ background: "none", border: "none", color: T.taupe, cursor: "pointer", fontSize: 18, minWidth: 44, minHeight: 44 }}>×</button>
                </div>
              ))}
          </>
        )}
      </Card>

      {/* 4. Your style (set once) */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <p style={label}>YOUR STYLE</p>
          {!profileOpen && <button onClick={() => { setDraft(profile); setEditingProfile(true); }} style={linkBtn}>Edit</button>}
        </div>
        {!profileOpen ? (
          <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0 }}>{profileLine(profile, n => formatMoney(n))}</p>
        ) : (
          <>
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: "0 0 12px" }}>Three quick things and Cleo's ideas fit you better.</p>
            <p style={{ ...label, margin: "0 0 8px" }}>SIZE (US)</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {US_SIZES.map(sz => <button key={sz} onClick={() => setDraft(d => ({ ...d, size: d.size === sz ? "" : sz }))} style={chip(draft.size === sz)}>{sz}</button>)}
            </div>
            <p style={{ ...label, margin: "0 0 8px" }}>STYLE WORDS (UP TO {MAX_WORDS})</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {STYLE_WORDS.map(w => <button key={w} onClick={() => toggleWord(w)} style={chip(draft.words.includes(w))}>{w}</button>)}
            </div>
            <p style={{ ...label, margin: "0 0 8px" }}>TYPICAL BUDGET FOR AN OUTFIT</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {BUDGET_STEPS.map(b => (
                <button key={b} onClick={() => setDraft(d => ({ ...d, budget: d.budget === b ? null : b }))} style={chip(draft.budget === b)}>
                  {b === BUDGET_STEPS[BUDGET_STEPS.length - 1] ? `${formatMoney(b)}+` : `Up to ${formatMoney(b)}`}
                </button>
              ))}
            </div>
            <button onClick={() => setMoreProfile(m => !m)} style={linkBtn}>{moreProfile ? "Hide extras" : "More (optional): body shape, height"}</button>
            {moreProfile && (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0 10px" }}>
                  {BODY_SHAPES.map(b => <button key={b} onClick={() => setDraft(d => ({ ...d, bodyShape: d.bodyShape === b ? "" : b }))} style={chip(draft.bodyShape === b)}>{b}</button>)}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {HEIGHTS.map(h => <button key={h} onClick={() => setDraft(d => ({ ...d, height: d.height === h ? "" : h }))} style={chip(draft.height === h)}>{h}</button>)}
                </div>
              </>
            )}
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
