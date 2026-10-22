import React, { useState } from "react";
import { T, F, alpha } from "../../config/theme";
import { useStore } from "../../core/store";
import { PageTitle, Emoji } from "../../shared/components";
import { LifeBuoy } from "lucide-react";
import { saveData, auth } from "../../core/firebase";
import toast from "react-hot-toast";
import { Capacitor } from "@capacitor/core";

const PRO_FEATURES = [
  { icon:<Emoji e="✦" />, label:"Unlimited AI requests" },
  { icon:<Emoji e="🧠" />, label:"Cleo's full memory & learning" },
  { icon:<Emoji e="📅" />, label:"Google + Apple + Outlook calendar sync" },
  { icon:<Emoji e="💰" />, label:"Household CFO — full scenario planning" },
  { icon:<Emoji e="✈" />, label:"Complete trip intelligence" },
  { icon:<Emoji e="👫" />, label:"Partner sync & shared briefings" },
  { icon:<Emoji e="🎨" />, label:"Full Style AI" },
  { icon:<LifeBuoy size={18} strokeWidth={1.9} aria-hidden="true" />, label:"Priority support" },
];

// Inside the iOS app, Apple requires In-App Purchase for digital
// subscriptions (guideline 3.1.1), so the Stripe checkout and price must not
// appear there, nor a link to buy elsewhere. Web keeps Stripe.
function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function UpgradeScreen() {
  const { user, profile, isPro } = useStore();
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(false);

  const joinWaitlist = async () => {
    if (!user?.uid) return;
    setLoading(true);
    try {
      await saveData(user.uid, "pro_waitlist", {
        uid: user.uid,
        email: user.email,
        name: (profile as any)?.name || "",
        joinedAt: Date.now(),
      });
      setJoined(true);
      toast.success("You're on the list");
    } catch {
      toast.error("Something went wrong — try again");
    }
    setLoading(false);
  };

  // Stripe checkout when payments are configured; waitlist otherwise
  const upgrade = async () => {
    if (!user?.uid) return;
    setLoading(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      });
      if (res.status === 503) { await joinWaitlist(); return; }
      const data = await res.json();
      if (data.url) { window.location.href = data.url; return; }
      toast.error("Checkout failed — try again");
    } catch {
      toast.error("Something went wrong — try again");
    }
    setLoading(false);
  };

  if (isPro) return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle title="HerNest Pro" />
      <div style={{ background:T.action, borderRadius:24, padding:"36px 24px", textAlign:"center" }}>
        <div style={{ width:56, height:56, borderRadius:"50%", background:`${alpha(T.gold, 0.15)}`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", color:T.gold }}><Emoji e="✦" size={24} /></div>
        <p style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize:26, color:T.onAction, margin:"0 0 8px" }}>You're Pro</p>
        <p style={{ fontFamily:F.sans, fontSize:13, color: alpha(T.onAction, 0.7), margin:0, lineHeight:1.7 }}>
          Unlimited Cleo, full memory, every connector — all yours. Thank you for backing HerNest.
        </p>
      </div>
    </div>
  );

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle title="HerNest Pro" />

      {/* Hero */}
      <div style={{ background:T.action, borderRadius:24, padding:"32px 24px", marginBottom:20, textAlign:"center" }}>
        <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color: alpha(T.onAction, 0.5), margin:"0 0 8px" }}>Hernest pro</p>
        <p style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontSize:30, color:T.onAction, margin:"0 0 12px", fontWeight: 700 }}>Your household deserves a real chief of staff</p>
        <p style={{ fontFamily:F.sans, fontSize:13, color: alpha(T.onAction, 0.7), margin:0, lineHeight:1.7 }}>
          Unlimited Cleo, her full memory, every connector, and shared briefings for your whole household.
        </p>
      </div>

      {/* Features */}
      <div style={{ background:T.ivory, borderRadius:20, padding:"20px", marginBottom:20, border:`1px solid ${T.linen}` }}>
        <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 16px" }}>What's included</p>
        {PRO_FEATURES.map((f, i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom: i < PRO_FEATURES.length - 1 ? `1px solid ${T.linen}` : "none" }}>
            <span style={{ width:28, display:"inline-flex", justifyContent:"center", flexShrink:0, color:T.goldText }}>{f.icon}</span>
            <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{f.label}</p>
          </div>
        ))}
      </div>

      {isNativeApp() ? (
        <div style={{ background:T.sand, borderRadius:16, padding:"18px 20px", textAlign:"center", border:`1px solid ${T.linen}` }}>
          <p style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize:20, color:T.esp, margin:"0 0 6px" }}>Pro isn't available in the app yet</p>
          <p style={{ fontFamily:F.sans, fontSize:12.5, color:T.taupe, margin:0, lineHeight:1.6 }}>
            If your account already has Pro, it's active here automatically.
          </p>
        </div>
      ) : (<>
      {/* Pricing hint */}
      <div style={{ background:T.sand, borderRadius:16, padding:"16px 20px", marginBottom:20, textAlign:"center", border:`1px solid ${T.linen}` }}>
        <p style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize:22, color:T.esp, margin:"0 0 4px" }}>From $12/month</p>
        <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0 }}>Founding members get 40% off for life</p>
      </div>

      {/* CTA */}
      {!joined ? (
        <button onClick={upgrade} disabled={loading}
          style={{ width:"100%", padding:"16px", background:T.esp, color:T.onAction, border:"none", borderRadius:16, fontFamily:F.sans, fontSize:15, fontWeight:700, cursor:"pointer", marginBottom:12 }}>
          {loading ? "One moment..." : "Upgrade to Pro"}
        </button>
      ) : (
        <div style={{ background:`${alpha(T.sage, 0.08)}`, border:`1px solid ${alpha(T.sage, 0.19)}`, borderRadius:16, padding:"20px", textAlign:"center" }}>
          <p style={{ margin:"0 0 8px", color:T.sage }}><Emoji e="✦" size={32} /></p>
          <p style={{ fontFamily:F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize:20, color:T.esp, margin:"0 0 4px" }}>You're on the list</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0 }}>We'll be in touch with your founding member offer.</p>
        </div>
      )}

      <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, textAlign:"center", margin:"8px 0 0", lineHeight:1.6 }}>
        Cancel anytime · Secure checkout
      </p>
      </>)}
    </div>
  );
}
