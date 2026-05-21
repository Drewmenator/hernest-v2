import React, { useState } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { PageTitle } from "../../shared/components";
import { saveData } from "../../core/firebase";
import toast from "react-hot-toast";

const PRO_FEATURES = [
  { icon:"✦", label:"Unlimited AI requests" },
  { icon:"🧠", label:"Cleo's full memory & learning" },
  { icon:"◈", label:"Google + Apple + Outlook calendar sync" },
  { icon:"💰", label:"Household CFO — full scenario planning" },
  { icon:"✈️", label:"Complete trip intelligence" },
  { icon:"👫", label:"Partner sync & shared briefings" },
  { icon:"🎨", label:"Full Style AI" },
  { icon:"◎", label:"Priority support" },
];

export function UpgradeScreen() {
  const { user, profile } = useStore();
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
      toast.success("You're on the list ✦");
    } catch {
      toast.error("Something went wrong — try again");
    }
    setLoading(false);
  };

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle title="HerNest Pro" />

      {/* Hero */}
      <div style={{ background:`linear-gradient(135deg,${T.esp},#3D2E22)`, borderRadius:24, padding:"32px 24px", marginBottom:20, textAlign:"center" }}>
        <p style={{ fontFamily:F.sans, fontSize:11, fontWeight:700, letterSpacing:"0.16em", textTransform:"uppercase", color:"rgba(255,255,255,0.5)", margin:"0 0 8px" }}>COMING SOON</p>
        <p style={{ fontFamily:F.serif, fontSize:30, fontStyle:"italic", color:"#fff", margin:"0 0 12px", fontWeight:500 }}>Your household deserves a real chief of staff</p>
        <p style={{ fontFamily:F.sans, fontSize:13, color:"rgba(255,255,255,0.7)", margin:0, lineHeight:1.7 }}>
          HerNest Pro is almost ready. Join the waitlist and you'll be first to know — with a founding member discount.
        </p>
      </div>

      {/* Features */}
      <div style={{ background:T.ivory, borderRadius:20, padding:"20px", marginBottom:20, border:`1px solid ${T.linen}` }}>
        <p style={{ fontFamily:F.sans, fontSize:10, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.taupe, margin:"0 0 16px" }}>WHAT'S INCLUDED</p>
        {PRO_FEATURES.map((f, i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom: i < PRO_FEATURES.length - 1 ? `1px solid ${T.linen}` : "none" }}>
            <span style={{ fontSize:18, width:28, textAlign:"center", flexShrink:0 }}>{f.icon}</span>
            <p style={{ fontFamily:F.sans, fontSize:13, color:T.esp, margin:0 }}>{f.label}</p>
          </div>
        ))}
      </div>

      {/* Pricing hint */}
      <div style={{ background:T.sand, borderRadius:16, padding:"16px 20px", marginBottom:20, textAlign:"center", border:`1px solid ${T.linen}` }}>
        <p style={{ fontFamily:F.serif, fontSize:22, fontStyle:"italic", color:T.esp, margin:"0 0 4px" }}>From $12/month</p>
        <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0 }}>Founding members get 40% off for life</p>
      </div>

      {/* CTA */}
      {!joined ? (
        <button onClick={joinWaitlist} disabled={loading}
          style={{ width:"100%", padding:"16px", background:T.esp, color:"#fff", border:"none", borderRadius:16, fontFamily:F.sans, fontSize:15, fontWeight:700, cursor:"pointer", marginBottom:12 }}>
          {loading ? "Joining..." : "Join the waitlist ✦"}
        </button>
      ) : (
        <div style={{ background:`${T.sage}15`, border:`1px solid ${T.sage}30`, borderRadius:16, padding:"20px", textAlign:"center" }}>
          <p style={{ fontSize:32, margin:"0 0 8px" }}>✦</p>
          <p style={{ fontFamily:F.serif, fontSize:20, fontStyle:"italic", color:T.esp, margin:"0 0 4px" }}>You're on the list</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0 }}>We'll be in touch with your founding member offer.</p>
        </div>
      )}

      <p style={{ fontFamily:F.sans, fontSize:11, color:T.taupe, textAlign:"center", margin:"8px 0 0", lineHeight:1.6 }}>
        No credit card required. We'll email you when Pro launches.
      </p>
    </div>
  );
}
