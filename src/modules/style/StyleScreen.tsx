import React, { useState, useEffect } from "react";
import { trackEvent } from "../../core/analytics";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, Pill, Button, Input, AIBadge, Spinner } from "../../shared/components";
import { saveData, loadData } from "../../core/firebase";
import { ai } from "../../core/ai";
import { bus } from "../../core/events";
import toast from "react-hot-toast";

// ── Types per blueprint ────────────────────────────────────────────
interface ClothingItem { name: string; color: string; material: string; fit: string; whyItWorks: string; }
interface OutfitRec {
  occasion: string; mood: string; createdAt: number;
  outfit: { top: ClothingItem; bottom?: ClothingItem; dress?: ClothingItem; outerwear?: ClothingItem; shoes: ClothingItem; accessories: ClothingItem[]; bag?: ClothingItem; };
  styling: { colorPalette: string[]; silhouette: string; proportionTip: string; };
  rationale: string;
  bodyShapeTip?: string;
  weatherAdaptation?: string;
  confidenceBoost: string;
  alternatives?: { item: string; alternative: string; reason: string }[];
  estimatedCost?: { total: number; currency: string };
}
interface SavedOutfit { id: string; occasion: string; mood: string; rec: OutfitRec; savedAt: number; }
interface WishlistItem { id: string; name: string; category: string; addedAt: number; }

// ── Style profile options per blueprint ────────────────────────────
const OCCASIONS = [
  { id:"work",    label:"Work",    emoji:"◈", desc:"Office, meetings, presentations" },
  { id:"casual",  label:"Casual",  emoji:"◦", desc:"Weekends, errands, school run" },
  { id:"evening", label:"Evening", emoji:"✦", desc:"Dinner, dates, girls night" },
  { id:"special", label:"Special", emoji:"◉", desc:"Weddings, events, celebrations" },
];

const MOODS = [
  { id:"powerful",    label:"Powerful",    emoji:"⚡" },
  { id:"relaxed",     label:"Relaxed",     emoji:"🌿" },
  { id:"playful",     label:"Playful",     emoji:"🎨" },
  { id:"elegant",     label:"Elegant",     emoji:"✨" },
  { id:"sporty",      label:"Sporty",      emoji:"🏃" },
  { id:"romantic",    label:"Romantic",    emoji:"🌸" },
  { id:"comfortable", label:"Comfortable", emoji:"🛁" },
  { id:"polished",    label:"Polished",    emoji:"💎" },
];

const BODY_SHAPES   = ["Hourglass","Pear","Apple","Rectangle","Inverted triangle","Petite","Plus size"];
const VIBES         = ["Classic elegant","Boho casual","Minimalist","Bold & colourful","Smart casual","Athleisure","Feminine romantic","Edgy cool"];
const DRESS_CODES   = ["Casual","Business casual","Formal","Creative","Black tie","Beach/resort"];
const BUDGETS       = ["Budget (high street)","Mid-range","Premium","Luxury"];
const HEIGHTS       = ["Petite (under 5'4)","Average (5'4–5'7)","Tall (5'7+)"];

// ── Body shape tips per blueprint ─────────────────────────────────
const BODY_SHAPE_TIPS: Record<string,string> = {
  "Hourglass":          "The defined waist in this outfit celebrates your natural curves.",
  "Pear":               "The structured top balances your proportions beautifully.",
  "Apple":              "Vertical lines and V-necks elongate your silhouette.",
  "Rectangle":          "Belted waists and layering create feminine definition.",
  "Inverted triangle":  "A-line bottoms balance your broader shoulders perfectly.",
  "Petite":             "Monochromatic palettes and fitted cuts elongate your frame.",
  "Plus size":          "Structured pieces and bold accessories command attention.",
};

export function StyleScreen() {
  const { user, profile, householdSnapshot } = useStore();
  const [tab, setTab] = useState("stylist");

  // Stylist state
  const [occasion, setOccasion] = useState("");
  const [mood, setMood]         = useState("");
  const [context, setContext]   = useState("");
  const [weather, setWeather]   = useState("");
  const [include, setInclude]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [aiError, setAiError]   = useState("");
  const [rec, setRec]           = useState<OutfitRec|null>(null);

  // Style profile
  const [bodyShape, setBodyShape] = useState("");
  const [size, setSize]           = useState("");
  const [height, setHeight]       = useState("");
  const [vibe, setVibe]           = useState("");
  const [dressCode, setDressCode] = useState("");
  const [budget, setBudget]       = useState("");
  const [colorSeason, setColorSeason] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Saved + wishlist
  const [saved, setSaved]       = useState<SavedOutfit[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [wishItem, setWishItem] = useState("");
  const [wishCat, setWishCat]   = useState("Clothing");

  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "style").then(d => {
      if (!d) return;
      if (d.bodyShape)  setBodyShape(d.bodyShape as string);
      if (d.size)       setSize(d.size as string);
      if (d.height)     setHeight(d.height as string);
      if (d.vibe)       setVibe(d.vibe as string);
      if (d.dressCode)  setDressCode(d.dressCode as string);
      if (d.budget)     setBudget(d.budget as string);
      if (d.colorSeason)setColorSeason(d.colorSeason as string);
      if (d.saved)      setSaved(d.saved as SavedOutfit[]);
      if (d.wishlist)   setWishlist(d.wishlist as WishlistItem[]);
    });
  }, [user?.uid]);

  const persist = async (updates: Record<string,unknown>) => {
    if (!user?.uid) return;
    await saveData(user.uid, "style", updates);
  };

  const hasProfile = !!(bodyShape || vibe || dressCode);

  // ── Generate outfit per blueprint spec ────────────────────────────
  const generateOutfit = async () => {
    if (!occasion || !mood) return;
    setLoading(true);

    const profile_str = hasProfile
      ? `Body shape: ${bodyShape||"not specified"}. Height: ${height||"not specified"}. Size: ${size||"not specified"}. Style vibe: ${vibe||"classic elegant"}. Dress code: ${dressCode||"smart casual"}. Budget: ${budget||"mid-range"}. Color season: ${colorSeason||"not specified"}.`
      : "Style profile not set — give versatile recommendations.";

    const bodyTip = BODY_SHAPE_TIPS[bodyShape] || "";

    const sys = `You are Nora, a personal stylist with 15 years of experience inside HerNest.

HER STYLE PROFILE:
${profile_str}
${bodyTip ? `Body tip to reference: ${bodyTip}` : ""}

STYLING RULES:
1. Dress for her body shape — suggest silhouettes that flatter ${bodyShape||"her figure"}
2. Match her vibe: ${vibe||"classic elegant"} aesthetic throughout
3. Respect budget: ${budget||"mid-range"}
4. Every item needs a "whyItWorks" tied to her body/occasion
5. Include ONE statement accessory, not many
6. End with a confidence boost — she should feel amazing
7. Suggest alternatives for key items

Return ONLY valid JSON:
{
  "outfit": {
    "top": {"name":"","color":"","material":"","fit":"","whyItWorks":""},
    "bottom": {"name":"","color":"","material":"","fit":"","whyItWorks":""},
    "shoes": {"name":"","color":"","material":"","fit":"","whyItWorks":""},
    "accessories": [{"name":"","color":"","material":"","fit":"","whyItWorks":""}],
    "bag": {"name":"","color":"","material":"","fit":"","whyItWorks":""},
    "outerwear": {"name":"","color":"","material":"","fit":"","whyItWorks":""}
  },
  "styling": {
    "colorPalette": ["color1","color2","color3"],
    "silhouette": "description",
    "proportionTip": "specific tip"
  },
  "rationale": "2-3 sentences why this works for her occasion and body",
  "bodyShapeTip": "specific tip for her body shape",
  "weatherAdaptation": "how to adapt for the weather if relevant",
  "confidenceBoost": "one powerful line she can carry with her",
  "alternatives": [{"item":"item name","alternative":"what to use instead","reason":"why"}],
  "estimatedCost": {"total": 0, "currency": "GBP"}
}`;

    const stressNote = householdSnapshot?.householdStressLevel === "high" ? " The user is having a high-stress week — prioritise comfort and ease." : "";
    const prompt = `Occasion: ${occasion}. Mood: ${mood}. ${context?`Context: ${context}.`:""} ${weather?`Weather: ${weather}.`:""} ${include?`Must include: ${include}.`:""}${stressNote}`;
    const result = await ai(sys, prompt, "style_stylist");

    if (!result.error) {
      try {
        console.log("[Style] raw response:", result.text.slice(0, 300));
        const rawText = result.text;
        const jsonStart = rawText.indexOf("{");
        const jsonEnd = rawText.lastIndexOf("}");
        if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON found in response");
        const jsonStr = rawText.slice(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonStr);
        const outfitRec: OutfitRec = {
          occasion, mood, createdAt: Date.now(),
          outfit: parsed.outfit,
          styling: parsed.styling,
          rationale: parsed.rationale,
          bodyShapeTip: parsed.bodyShapeTip,
          weatherAdaptation: parsed.weatherAdaptation,
          confidenceBoost: parsed.confidenceBoost,
          alternatives: parsed.alternatives,
          estimatedCost: parsed.estimatedCost,
        };
        setRec(outfitRec);
        await bus.publish("style.outfit.generated", { occasion, mood }, { userId: user!.uid, source: "style" });
      } catch(e) { console.error("[Style]", e); setAiError("Nora got confused with the outfit. Try again."); }
    } else {
      setAiError("Nora couldn't generate an outfit. Check your connection and try again.");
    }
    setLoading(false);
  };

  // ── Save outfit ───────────────────────────────────────────────────
  const saveOutfit = async () => {
    if (!rec) return;
    const item: SavedOutfit = { id: crypto.randomUUID(), occasion, mood, rec, savedAt: Date.now() };
    const updated = [item, ...saved];
    setSaved(updated);
    await persist({ saved:updated, wishlist, bodyShape, size, height, vibe, dressCode, budget, colorSeason });
    await bus.publish("style.outfit.saved", { occasion }, { userId: user!.uid, source: "style" });
    toast.success("Outfit saved ♥");
  };

  // ── Save style profile ────────────────────────────────────────────
  const saveStyleProfile = async () => {
    setSavingProfile(true);
    await persist({ bodyShape, size, height, vibe, dressCode, budget, colorSeason, saved, wishlist });
    await bus.publish("style.preference.updated", { vibe, dressCode, bodyShape }, { userId: user!.uid, source: "style" });
    setSavingProfile(false);
    toast.success("Style profile saved ✓ Nora knows your style");
  };

  // ── Wishlist ──────────────────────────────────────────────────────
  const addToWishlist = async () => {
    if (!wishItem.trim()) return;
    const item: WishlistItem = { id: crypto.randomUUID(), name: wishItem.trim(), category: wishCat, addedAt: Date.now() };
    const updated = [item, ...wishlist];
    setWishlist(updated);
    await persist({ wishlist:updated, saved, bodyShape, size, height, vibe, dressCode, budget, colorSeason });
    setWishItem("");
    toast.success("Added to wishlist ✓");
  };

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="PERSONAL STYLIST" title="Style"/>

      {/* Nora knows badge */}
      {hasProfile && (
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:`linear-gradient(135deg,${T.gold}10,${T.esp}06)`, border:`1px solid ${T.gold}30`, borderRadius:14, marginBottom:12 }}>
          <span style={{ fontSize:18 }}>✦</span>
          <div>
            <p style={{ fontFamily:F.sans, fontSize:12, fontWeight:700, color:T.gold, margin:0 }}>Nora knows your style</p>
            <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"2px 0 0" }}>{bodyShape||"Your shape"} · {vibe||"Classic"} · {dressCode||"Smart casual"} · {budget||"Mid-range"}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:"flex", gap:8, marginBottom:16, overflowX:"auto", paddingBottom:4 }}>
        {["stylist","profile","saved","wishlist"].map(t=>(
          <Pill key={t} label={t==="stylist"?"✦ Style Me":t==="profile"?"My Profile":t==="saved"?`Saved (${saved.length})`:`Wishlist (${wishlist.length})`} active={tab===t} onClick={()=>setTab(t)}/>
        ))}
      </div>

      {/* ── STYLE ME ──────────────────────────────────────────────── */}
      {tab==="stylist" && <>
        <Card>
          <p style={{ fontFamily:F.serif, fontSize:22, fontStyle:"italic", fontWeight:500, color:T.esp, margin:"0 0 14px" }}>What's the occasion?</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            {(OCCASIONS as any[]).map(o=>(
              <button key={o.id} onClick={()=>setOccasion(o.id)}
                style={{
                  padding:"18px 14px", borderRadius:20,
                  border:`2px solid ${occasion===o.id ? o.color : "transparent"}`,
                  background: occasion===o.id ? o.color : o.bg,
                  cursor:"pointer", touchAction:"manipulation", textAlign:"left",
                  transition:"all 0.2s", minHeight:90,
                }}>
                <p style={{ fontFamily:F.sans, fontSize:22, margin:"0 0 6px", color: occasion===o.id?"#fff":o.color }}>{o.icon}</p>
                <p style={{ fontFamily:F.sans, fontSize:14, fontWeight:800, color:occasion===o.id?"#fff":T.esp, margin:"0 0 2px", letterSpacing:"-0.02em" }}>{o.label}</p>
                <p style={{ fontFamily:F.sans, fontSize:10, color:occasion===o.id?"rgba(255,255,255,0.7)":T.taupe, margin:0 }}>{o.desc}</p>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <p style={{ fontFamily:F.serif, fontSize:22, fontStyle:"italic", fontWeight:500, color:T.esp, margin:"0 0 14px" }}>How do you want to feel?</p>
          <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4, scrollbarWidth:"none" }}>
            {(MOODS as any[]).map(m=>(
              <button key={m.id} onClick={()=>setMood(m.id)}
                style={{
                  flexShrink:0, padding:"10px 18px", borderRadius:30,
                  border:"none",
                  background: mood===m.id ? m.color : `${m.color}15`,
                  color: mood===m.id ? "#fff" : m.color,
                  fontFamily:F.sans, fontSize:12, fontWeight:700,
                  cursor:"pointer", touchAction:"manipulation", minHeight:40,
                  transition:"all 0.2s", letterSpacing:"0.02em",
                }}>
                {m.label}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 10px" }}>EXTRA CONTEXT (optional)</p>
          <input value={context} onChange={e=>setContext(e.target.value)} placeholder="e.g. Standing all day, need flat shoes, outdoor event..." style={{ width:"100%", background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"11px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", boxSizing:"border-box", minHeight:44, marginBottom:8 }}/>
          <input value={weather} onChange={e=>setWeather(e.target.value)} placeholder="Weather? (e.g. Cold, rainy, 22°C sunny)" style={{ width:"100%", background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"11px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", boxSizing:"border-box", minHeight:44, marginBottom:8 }}/>
          <input value={include} onChange={e=>setInclude(e.target.value)} placeholder="Must include? (e.g. my red blazer, white trainers)" style={{ width:"100%", background:T.sand, border:`1.5px solid ${T.linen}`, borderRadius:12, padding:"11px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", boxSizing:"border-box", minHeight:44 }}/>
        </Card>

        <button onClick={generateOutfit} disabled={!occasion||!mood||loading} style={{ width:"100%", padding:"16px", background:occasion&&mood?`linear-gradient(135deg,${T.esp},#4a2e18)`:T.linen, color:occasion&&mood?"#fff":T.taupe, border:"none", borderRadius:16, fontFamily:F.sans, fontSize:15, fontWeight:700, cursor:occasion&&mood?"pointer":"not-allowed", marginBottom:16, display:"flex", alignItems:"center", justifyContent:"center", gap:8, minHeight:52, touchAction:"manipulation" }}>
          {loading?<><Spinner size={18} color="#fff"/>Creating your look...</>:"✦ Style Me"}
        </button>

        {/* Outfit Result per blueprint structured format */}
        {rec && (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <AIBadge label="Styled by Nora"/>
              <button onClick={saveOutfit} style={{ background:T.goldP, border:`1px solid ${T.gold}40`, borderRadius:10, padding:"6px 14px", fontFamily:F.sans, fontSize:12, fontWeight:600, color:T.gold, cursor:"pointer", minHeight:36 }}>Save ♥</button>
            </div>

            {/* Occasion + mood header */}
            <Card>
              <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 10px", textTransform:"uppercase", letterSpacing:"0.08em" }}>
                {(OCCASIONS as any[]).find(o=>o.id===rec.occasion)?.icon} {(OCCASIONS as any[]).find(o=>o.id===rec.occasion)?.label} ·  {MOODS.find(m=>m.id===rec.mood)?.label}
              </p>

              {/* Color palette */}
              {rec.styling?.colorPalette?.length > 0 && (
                <div style={{ display:"flex", gap:6, marginBottom:12, alignItems:"center" }}>
                  <span style={{ fontFamily:F.sans, fontSize:11, color:T.taupe }}>Palette:</span>
                  {rec.styling.colorPalette.map((c,i)=>(
                    <span key={i} style={{ fontFamily:F.sans, fontSize:11, background:T.sand, padding:"2px 8px", borderRadius:20, color:T.esp }}>{c}</span>
                  ))}
                </div>
              )}

              <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, lineHeight:1.7, margin:"0 0 10px" }}>{rec.rationale}</p>

              {/* Silhouette + proportion tip */}
              {rec.styling?.proportionTip && (
                <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, lineHeight:1.6, margin:0, fontStyle:"italic" }}>📐 {rec.styling.proportionTip}</p>
              )}
            </Card>

            {/* Individual outfit items per blueprint */}
            <Card>
              <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>THE OUTFIT</p>
              {[
                { key:"top",       label:"Top",       item:rec.outfit.top,       emoji:"👚" },
                { key:"bottom",    label:"Bottom",    item:rec.outfit.bottom,    emoji:"👖" },
                { key:"dress",     label:"Dress",     item:rec.outfit.dress,     emoji:"👗" },
                { key:"outerwear", label:"Outerwear", item:rec.outfit.outerwear, emoji:"🧥" },
                { key:"shoes",     label:"Shoes",     item:rec.outfit.shoes,     emoji:"👟" },
                { key:"bag",       label:"Bag",       item:rec.outfit.bag,       emoji:"👜" },
              ].filter(r=>r.item).map((row,i,arr)=>(
                <div key={row.key} style={{ padding:"12px 0", borderBottom:i<arr.length-1?`1px solid ${T.linen}`:"none" }}>
                  <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                    <span style={{ fontSize:20, flexShrink:0 }}>{row.emoji}</span>
                    <div style={{ flex:1 }}>
                      <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:"0 0 2px" }}>{row.item!.name}</p>
                      <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"0 0 4px" }}>{row.item!.color} · {row.item!.material} · {row.item!.fit}</p>
                      <p style={{ fontFamily:F.sans, fontSize:12, color:T.esp, margin:0, fontStyle:"italic", lineHeight:1.5 }}>"{row.item!.whyItWorks}"</p>
                    </div>
                  </div>
                </div>
              ))}

              {/* Accessories */}
              {rec.outfit.accessories?.filter(a=>a?.name).map((acc,i)=>(
                <div key={i} style={{ padding:"12px 0", borderTop:`1px solid ${T.linen}` }}>
                  <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                    <span style={{ fontSize:20, flexShrink:0 }}>💍</span>
                    <div style={{ flex:1 }}>
                      <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:"0 0 2px" }}>{acc.name}</p>
                      <p style={{ fontFamily:F.sans, fontSize:12, color:T.esp, margin:0, fontStyle:"italic" }}>"{acc.whyItWorks}"</p>
                    </div>
                  </div>
                </div>
              ))}
            </Card>

            {/* Body shape tip per blueprint */}
            {rec.bodyShapeTip && (
              <div style={{ background:`${T.lav}15`, border:`1px solid ${T.lav}30`, borderRadius:14, padding:"12px 16px", marginBottom:12 }}>
                <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, color:T.lav, margin:"0 0 4px", textTransform:"uppercase", letterSpacing:"0.08em" }}>YOUR SHAPE TIP</p>
                <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{rec.bodyShapeTip}</p>
              </div>
            )}

            {/* Weather adaptation per blueprint */}
            {rec.weatherAdaptation && (
              <div style={{ background:`${T.sky}15`, border:`1px solid ${T.sky}30`, borderRadius:14, padding:"12px 16px", marginBottom:12 }}>
                <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, color:T.sky, margin:"0 0 4px", textTransform:"uppercase", letterSpacing:"0.08em" }}>🌤 WEATHER ADAPT</p>
                <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{rec.weatherAdaptation}</p>
              </div>
            )}

            {/* Alternatives per blueprint */}
            {rec.alternatives?.filter(a=>a?.item).length > 0 && (
              <Card>
                <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>DON'T HAVE IT? TRY</p>
                {rec.alternatives!.filter(a=>a?.item).map((alt,i)=>(
                  <div key={i} style={{ display:"flex", gap:10, padding:"7px 0", borderBottom:i<rec.alternatives!.length-1?`1px solid ${T.linen}`:"none" }}>
                    <span style={{ color:T.taupe, flexShrink:0, fontFamily:F.sans, fontSize:12 }}>Instead of <em>{alt.item}</em>:</span>
                    <p style={{ fontFamily:F.sans, fontSize:12, color:T.esp, margin:0 }}>{alt.alternative} — {alt.reason}</p>
                  </div>
                ))}
              </Card>
            )}

            {/* Estimated cost per blueprint */}
            {rec.estimatedCost && rec.estimatedCost.total > 0 && (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 16px", background:T.sand, borderRadius:14, marginBottom:12, border:`1px solid ${T.linen}` }}>
                <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0 }}>Estimated cost</p>
                <p style={{ fontFamily:F.serif, fontSize:20, fontWeight:700, color:T.esp, margin:0 }}>£{rec.estimatedCost.total}</p>
              </div>
            )}

            {/* Confidence boost per blueprint */}
            <div style={{ background:`linear-gradient(135deg,${T.gold}15,${T.esp}08)`, border:`1px solid ${T.gold}30`, borderRadius:16, padding:"18px 18px", marginBottom:12 }}>
              <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, color:T.gold, margin:"0 0 6px", textTransform:"uppercase", letterSpacing:"0.1em" }}>✦ CONFIDENCE BOOST</p>
              <p style={{ fontFamily:F.serif, fontSize:16, fontStyle:"italic", color:T.esp, margin:0, lineHeight:1.7 }}>{rec.confidenceBoost}</p>
            </div>
          </>
        )}
      </>}

      {/* ── STYLE PROFILE per blueprint ───────────────────────────── */}
      {tab==="profile" && <>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>BODY SHAPE</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {BODY_SHAPES.map(s=>(
              <button key={s} onClick={()=>setBodyShape(s)} style={{ padding:"8px 14px", borderRadius:20, border:`1.5px solid ${bodyShape===s?T.esp:T.linen}`, background:bodyShape===s?T.esp:"#fff", color:bodyShape===s?"#fff":T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation" }}>{s}</button>
            ))}
          </div>
          {bodyShape && <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"10px 0 0", fontStyle:"italic" }}>{BODY_SHAPE_TIPS[bodyShape]}</p>}
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>HEIGHT</p>
          <div style={{ display:"flex", gap:6 }}>
            {HEIGHTS.map(h=>(
              <button key={h} onClick={()=>setHeight(h)} style={{ flex:1, padding:"10px 6px", borderRadius:12, border:`1.5px solid ${height===h?T.esp:T.linen}`, background:height===h?T.esp:"#fff", color:height===h?"#fff":T.bark, fontFamily:F.sans, fontSize:11, cursor:"pointer", touchAction:"manipulation", textAlign:"center" }}>{h}</button>
            ))}
          </div>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>YOUR VIBE</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {VIBES.map(v=>(
              <button key={v} onClick={()=>setVibe(v)} style={{ padding:"8px 14px", borderRadius:20, border:`1.5px solid ${vibe===v?T.gold:T.linen}`, background:vibe===v?T.goldP:"#fff", color:vibe===v?T.gold:T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation" }}>{v}</button>
            ))}
          </div>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>DRESS CODE</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
            {DRESS_CODES.map(d=>(
              <button key={d} onClick={()=>setDressCode(d)} style={{ padding:"8px 14px", borderRadius:20, border:`1.5px solid ${dressCode===d?T.lav:T.linen}`, background:dressCode===d?`${T.lav}15`:"#fff", color:dressCode===d?T.lav:T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation" }}>{d}</button>
            ))}
          </div>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>BUDGET</p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
            {BUDGETS.map(b=>(
              <button key={b} onClick={()=>setBudget(b)} style={{ padding:"8px 14px", borderRadius:20, border:`1.5px solid ${budget===b?T.sage:T.linen}`, background:budget===b?`${T.sage}15`:"#fff", color:budget===b?T.sage:T.bark, fontFamily:F.sans, fontSize:12, cursor:"pointer", touchAction:"manipulation" }}>{b}</button>
            ))}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <Input value={size} onChange={setSize} placeholder="Clothing size (e.g. UK 12)" style={{ flex:1 }}/>
            <Input value={colorSeason} onChange={setColorSeason} placeholder="Color season (optional)" style={{ flex:1 }}/>
          </div>
        </Card>

        <Button onClick={saveStyleProfile} disabled={savingProfile} variant="gold">
          {savingProfile?"Saving...":"Save Style Profile ✦"}
        </Button>
      </>}

      {/* ── SAVED OUTFITS ─────────────────────────────────────────── */}
      {tab==="saved" && <>
        {saved.length===0
          ? <Card><p style={{ fontFamily:F.sans, fontSize:14, color:T.taupe, textAlign:"center", padding:"20px 0" }}>No saved outfits yet.<br/>Generate an outfit and tap Save ♥</p></Card>
          : saved.map(s=>(
            <Card key={s.id}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div>
                  <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:700, color:T.esp, margin:0 }}>
                    {(OCCASIONS as any[]).find(o=>o.id===s.occasion)?.icon} {(OCCASIONS as any[]).find(o=>o.id===s.occasion)?.label}
                  </p>
                  <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"2px 0 0" }}>
                    {MOODS.find(m=>m.id===s.mood)?.label} · {new Date(s.savedAt||Date.now()).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}
                  </p>
                </div>
                <button onClick={async()=>{ const u=saved.filter(i=>i.id!==s.id); setSaved(u); await persist({saved:u,wishlist,bodyShape,size,height,vibe,dressCode,budget,colorSeason}); }} style={{ background:"none", border:"none", color:T.taupe, cursor:"pointer", fontSize:18, minHeight:44, padding:"0 8px" }}>×</button>
              </div>
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.esp, lineHeight:1.6, margin:"0 0 8px" }}>{s.rec.rationale}</p>
              {s.rec.confidenceBoost && <p style={{ fontFamily:F.serif, fontSize:13, fontStyle:"italic", color:T.gold, margin:0 }}>"{s.rec.confidenceBoost}"</p>}
            </Card>
          ))
        }
      </>}

      {/* ── WISHLIST ──────────────────────────────────────────────── */}
      {tab==="wishlist" && <>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 12px" }}>ADD TO WISHLIST</p>
          <Input value={wishItem} onChange={setWishItem} placeholder="Item name (e.g. White linen blazer)" style={{ marginBottom:8 }}/>
          <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
            {["Clothing","Shoes","Bags","Accessories","Beauty","Jewellery"].map(c=>(
              <button key={c} onClick={()=>setWishCat(c)} style={{ padding:"6px 12px", borderRadius:20, border:`1.5px solid ${wishCat===c?T.gold:T.linen}`, background:wishCat===c?T.goldP:"#fff", color:wishCat===c?T.gold:T.bark, fontFamily:F.sans, fontSize:11, cursor:"pointer", touchAction:"manipulation" }}>{c}</button>
            ))}
          </div>
          <Button onClick={addToWishlist} disabled={!wishItem.trim()} variant="secondary">Add to Wishlist</Button>
        </Card>
        {wishlist.length===0
          ? <Card><p style={{ fontFamily:F.sans, fontSize:14, color:T.taupe, textAlign:"center", padding:"20px 0" }}>Your wishlist is empty.</p></Card>
          : wishlist.map(item=>(
            <div key={item.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", background:T.ivory, borderRadius:16, border:`1px solid ${T.linen}`, marginBottom:8 }}>
              <div style={{ flex:1 }}>
                <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>{item.name}</p>
                <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, margin:"2px 0 0" }}>{item.category}</p>
              </div>
              <button onClick={async()=>{ const u=wishlist.filter(i=>i.id!==item.id); setWishlist(u); await persist({wishlist:u,saved,bodyShape,size,height,vibe,dressCode,budget,colorSeason}); }} style={{ background:"none", border:"none", color:T.taupe, cursor:"pointer", fontSize:18, minHeight:44, padding:"0 8px" }}>×</button>
            </div>
          ))
        }
      </>}
    </div>
  );
}
