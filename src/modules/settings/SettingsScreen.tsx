import { loadMemoriesV2, deleteMemory } from '../../core/memoryServiceV2';
import React, { useState } from "react";
import { CleoSetupScreen } from "../onboarding/OnboardingScreen";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle } from "../../shared/components";
import { saveData, loadData } from "../../core/firebase";
import { SUPPORTED_CURRENCIES } from "../../shared/utils/money";
import { auth } from "../../core/firebase";
import toast from "react-hot-toast";

const SECTIONS = ["privacy","legal","account"] as const;
type Section = typeof SECTIONS[number];

// Opened from the You menu: "Notifications & account" starts on Account,
// "Account & privacy" on Privacy.
export function SettingsScreen({ initialSection = "account" }: { initialSection?: Section }) {
  const { user, profile, reset, setProfile } = useStore();
  const [section, setSection] = useState<Section>(initialSection);

  // Delete account
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showDeleteFlow, setShowDeleteFlow] = useState(false);
  const [showCleoSetup, setShowCleoSetup] = useState(false);
  const [memoryV2List, setMemoryV2List] = useState<any[]>([]);
  const [showMemoryV2, setShowMemoryV2] = useState(false);

  const loadMemories = async () => {
    if (!user?.uid) return;
    try {
      // Only what Cleo actually uses; suggestions wait in What Cleo knows.
      const mems = await loadMemoriesV2(user.uid);
      setMemoryV2List(mems.filter(m => m.status === "active"));
      setShowMemoryV2(true);
    } catch { setMemoryV2List([]); setShowMemoryV2(true); }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== "DELETE" || !user?.uid) return;
    setDeleting(true);
    try {
      // Apple requires cutting off Sign in with Apple on deletion. This shows
      // the Apple sheet once more; cancelling it stops the deletion. If the
      // revoke itself fails we still delete, since erasing the data matters more.
      const { revokeAppleSignIn } = await import("../../core/appleRevoke");
      const { Capacitor } = await import("@capacitor/core");
      const apple = await revokeAppleSignIn(auth, Capacitor.isNativePlatform());
      if (apple === "cancelled") { setDeleting(false); return; }

      // The server erases everything (data, connected accounts, household
      // links, push devices), cancels any subscription, then deletes the login.
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("not_signed_in");
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) throw new Error(`delete_failed_${res.status}`);
      const { signOutCompletely } = await import("../../core/signOut");
      toast.success("Account deleted. We're sorry to see you go.");
      // Clears this device and restarts the app on the sign-in screen.
      await signOutCompletely().catch(() => reset());
    } catch {
      toast.error("Couldn't delete account. Please try again or contact support@hernest.app");
    }
    setDeleting(false);
  };

  if (showCleoSetup) return <CleoSetupScreen onComplete={() => setShowCleoSetup(false)} />;

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="Account" title="Settings"/>

      {/* Section tabs */}
      <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:4, marginBottom:16 }}>
        {[
          { id:"privacy", label:"Privacy" },
          { id:"legal",   label:"Legal" },
          { id:"account", label:"Account" },
        ].map(s=>(
          <button key={s.id} onClick={()=>setSection(s.id as Section)} style={{ padding:"8px 16px", borderRadius:20, border:`1.5px solid ${section===s.id?T.esp:T.linen}`, background:section===s.id?T.esp:"#fff", color:section===s.id?"#fff":T.bark, fontFamily:F.sans, fontSize:12, fontWeight:section===s.id?700:400, cursor:"pointer", whiteSpace:"nowrap", flexShrink:0, touchAction:"manipulation", minHeight:36 }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── PRIVACY ─────────────────────────────────────────────── */}
      {section==="privacy" && <>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:15, fontWeight:700, color:T.esp, margin:"0 0 12px" }}>Your Privacy at HerNest</p>
          <p style={{ fontFamily:F.sans, fontSize:13, color:T.taupe, lineHeight:1.7, margin:"0 0 16px" }}>
            HerNest is built on a foundation of trust. We take your privacy seriously — especially because you share sensitive family, health, and financial information with Cleo.
          </p>
          {[
            { icon:"🔒", title:"Your data is yours", body:"We never sell your personal data to third parties. Ever. Your information is used only to power your HerNest experience." },
            { icon:"✦", title:"How Cleo works", body:"When you chat with Cleo or generate briefings, the relevant parts of your household data are processed by Anthropic's Claude AI to create the response. It isn't used to train AI models." },
            { icon:"🤖", title:"How Cleo uses your data", body:"Cleo's memory is stored securely in Firestore under your user ID. AI conversations are processed via Anthropic's Claude API. Anthropic does not use your conversations to train their models." },
            { icon:"📍", title:"Location data", body:"We do not collect or store your location. Any location-based features use your device's local data only." },
            { icon:"🏦", title:"Financial data", body:"Budget data is stored securely in your personal Firestore database. We never have access to your actual bank accounts or cards." },
            { icon:"👧", title:"Children's data", body:"Information about your children is stored privately under your account and never shared or used for advertising." },
            { icon:"🗑", title:"Right to erasure", body:"You can delete your entire account and all associated data at any time from Settings → Account → Delete Account." },
            { icon:"🍪", title:"Cookies", body:"We use essential cookies only — for authentication and session management. No advertising or tracking cookies." },
            { icon:"📨", title:"Emails", body:"We only send transactional emails (password reset, partner invites). No marketing emails unless you opt in." },
          ].map(item=>(
            <div key={item.title} style={{ padding:"14px 0", borderBottom:`1px solid ${T.linen}` }}>
              <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                <span style={{ fontSize:20, flexShrink:0 }}>{item.icon}</span>
                <div>
                  <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:700, color:T.esp, margin:"0 0 4px" }}>{item.title}</p>
                  <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0, lineHeight:1.6 }}>{item.body}</p>
                </div>
              </div>
            </div>
          ))}
          <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"16px 0 0", textAlign:"center" }}>
            Questions? Email us at privacy@hernest.app
          </p>
        </Card>

        {/* What Cleo Knows — Memory V2 */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div>
              <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:700, color:T.esp, margin:"0 0 2px" }}>What Cleo Knows</p>
              <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:0 }}>Facts, preferences and patterns Cleo has learned about your household</p>
            </div>
            <button onClick={loadMemories}
              style={{ background:T.esp, color:"#fff", border:"none", borderRadius:10, padding:"6px 14px", fontFamily:F.sans, fontSize:12, fontWeight:600, cursor:"pointer" }}>
              View
            </button>
          </div>
          {showMemoryV2 && (
            <div>
              {memoryV2List.length === 0 && (
                <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, textAlign:"center", padding:"16px 0" }}>Cleo is still getting to know you. Keep using the app and she'll learn your patterns.</p>
              )}
              {memoryV2List.length > 0 && memoryV2List.slice(0, 20).map((mem: any, i: number) => (
                <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"10px 0", borderBottom:`1px solid ${T.linen}` }}>
                  <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>
                    {mem.type === "preference" ? "◆" : mem.type === "pattern" ? "◈" : mem.type === "financial_context" ? "💰" : "◎"}
                  </span>
                  <div style={{ flex:1 }}>
                    <p style={{ fontFamily:F.sans, fontSize:12, color:T.esp, margin:"0 0 2px", lineHeight:1.5 }}>{mem.content}</p>
                    <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:0, textTransform:"capitalize" }}>{mem.type} · {mem.sourceModule} · {mem.confidence} confidence</p>
                  </div>
                  <button onClick={async () => { await deleteMemory(user!.uid, mem.id); setMemoryV2List(p => p.filter((m: any) => m.id !== mem.id)); }}
                    style={{ background:"none", border:"none", color:T.taupe, cursor:"pointer", fontSize:14, padding:0, flexShrink:0 }}>×</button>
                </div>
              ))}
              {memoryV2List.length > 20 && (
                <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, textAlign:"center", padding:"8px 0" }}>+{memoryV2List.length - 20} more memories</p>
              )}
            </div>
          )}
        </Card>

        {/* Data export */}
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:700, color:T.esp, margin:"0 0 8px" }}>Export your data</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 12px", lineHeight:1.6 }}>You can download a copy of all the data HerNest holds about you.</p>
          <button onClick={async()=>{
            if (!user?.uid) return;
            const collections = ["profile","bills","tasks","calendar","calendar_synced","school","meals","family","thrive","trips","circle","style","cleo_memory","cleo_memory_v2","cleo_feedback","budget","budget_v2"];
            const allData: Record<string,unknown> = {};
            await Promise.all(collections.map(async c => { allData[c] = await loadData(user.uid!, c); }));
            // Chores are one record each now (tasks and bills come back through loadData).
            allData.chores = await (await import("../../core/householdItems")).listItems(user.uid!, "chores").catch(() => null);
            const blob = new Blob([JSON.stringify(allData, null, 2)], { type:"application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href=url; a.download=`hernest-data-${new Date().toISOString().split("T")[0]}.json`;
            a.click(); URL.revokeObjectURL(url);
            toast.success("Data exported ✓");
          }} style={{ width:"100%", padding:"12px", background:T.sand, border:`1px solid ${T.linen}`, borderRadius:12, fontFamily:F.sans, fontSize:13, color:T.esp, cursor:"pointer", minHeight:44, touchAction:"manipulation" }}>
            📥 Export My Data (JSON)
          </button>
        </Card>
      </>}

      {/* ── LEGAL ───────────────────────────────────────────────── */}
      {section==="legal" && <>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:15, fontWeight:700, color:T.esp, margin:"0 0 4px" }}>Terms of Service</p>
          <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"0 0 16px" }}>Last updated: May 2026</p>
          {[
            { title:"1. Acceptance", body:"By using HerNest, you agree to these Terms. If you don't agree, please don't use the service." },
            { title:"2. The Service", body:"HerNest is an AI-powered personal assistant for mothers and caregivers. We provide tools for planning, budgeting, wellness tracking, and more. The service is provided 'as is' and we may update or modify features at any time." },
            { title:"3. Your Account", body:"You are responsible for maintaining the security of your account. You must be 18 or older to use HerNest. One account per person." },
            { title:"4. Acceptable Use", body:"You may not use HerNest for illegal activities, to harm others, or to attempt to access other users' data. We reserve the right to suspend accounts that violate these terms." },
            { title:"5. AI Limitations", body:"Cleo is an AI assistant and may make mistakes. Do not rely on HerNest for medical, legal, or financial advice. Always consult qualified professionals for important decisions." },
            { title:"6. Subscription & Billing", body:"HerNest offers a free tier with limited AI requests. Premium plans are billed monthly or annually. You may cancel at any time. Refunds are offered within 14 days of purchase." },
            { title:"7. Intellectual Property", body:"HerNest and its content are owned by HerNest Ltd. You retain ownership of all data you create in the app." },
            { title:"8. Limitation of Liability", body:"To the maximum extent permitted by law, HerNest is not liable for indirect, incidental, or consequential damages arising from your use of the service." },
            { title:"9. Termination", body:"We may terminate accounts for violations of these terms. You may delete your account at any time. Upon termination, your data will be deleted within 30 days." },
            { title:"10. Governing Law", body:"These terms are governed by the laws of England and Wales. Disputes shall be resolved in the courts of England." },
          ].map(item=>(
            <div key={item.title} style={{ padding:"12px 0", borderBottom:`1px solid ${T.linen}` }}>
              <p style={{ fontFamily:F.sans, fontSize:12, fontWeight:700, color:T.esp, margin:"0 0 4px" }}>{item.title}</p>
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0, lineHeight:1.6 }}>{item.body}</p>
            </div>
          ))}
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize:15, fontWeight:700, color:T.esp, margin:"0 0 4px" }}>Privacy Policy</p>
          <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"0 0 16px" }}>Last updated: May 2026</p>
          {[
            { title:"Data Controller", body:"HerNest Ltd is the data controller for personal data collected through this app. Contact: privacy@hernest.app" },
            { title:"Data We Collect", body:"Account data (email, name), app usage data (tasks, bills, wellness logs), AI conversation summaries, and device information." },
            { title:"How We Use It", body:"To provide and improve the service, personalize your Cleo experience, send important account notifications, and ensure security." },
            { title:"Legal Basis (GDPR)", body:"We process your data under: contract performance (providing the service), legitimate interests (improving the service), and consent (marketing communications)." },
            { title:"Data Retention", body:"We retain your data for as long as your account is active. Upon deletion, data is removed within 30 days. Anonymised analytics may be retained longer." },
            { title:"Your Rights (GDPR)", body:"You have the right to: access your data, correct inaccuracies, request deletion, restrict processing, data portability, and object to processing. Contact privacy@hernest.app to exercise these rights." },
            { title:"Third Parties", body:"We use: Firebase (Google) for authentication and storage, Anthropic Claude for AI processing, Stripe for payments, and Vercel for hosting. Each has their own privacy policy." },
            { title:"International Transfers", body:"Your data may be processed in the US (Firebase, Anthropic). We ensure adequate protections via Standard Contractual Clauses." },
            { title:"Children", body:"HerNest is not directed at children under 13. We do not knowingly collect data from children. Children's data entered by parents (e.g. kids' names) is treated as family data." },
            { title:"Changes", body:"We'll notify you of significant changes via email or in-app notification. Continued use constitutes acceptance." },
          ].map(item=>(
            <div key={item.title} style={{ padding:"12px 0", borderBottom:`1px solid ${T.linen}` }}>
              <p style={{ fontFamily:F.sans, fontSize:12, fontWeight:700, color:T.esp, margin:"0 0 4px" }}>{item.title}</p>
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0, lineHeight:1.6 }}>{item.body}</p>
            </div>
          ))}
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize:15, fontWeight:700, color:T.esp, margin:"0 0 4px" }}>Cookie Policy</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 12px", lineHeight:1.6 }}>HerNest uses essential cookies only:</p>
          {[
            { name:"Firebase Auth", purpose:"Keeps you signed in", duration:"30 days", type:"Essential" },
            { name:"Session token", purpose:"Secure API access", duration:"Session", type:"Essential" },
          ].map(c=>(
            <div key={c.name} style={{ padding:"10px 0", borderBottom:`1px solid ${T.linen}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div>
                  <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:"0 0 2px" }}>{c.name}</p>
                  <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:0 }}>{c.purpose} · {c.duration}</p>
                </div>
                <span style={{ background:`${T.sage}20`, color:T.sage, fontFamily:F.sans, fontSize: 12, fontWeight:700, padding:"3px 8px", borderRadius:10 }}>{c.type}</span>
              </div>
            </div>
          ))}
          <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"12px 0 0", lineHeight:1.6 }}>We do not use advertising, tracking, or analytics cookies. No third-party cookies are set without your consent.</p>
        </Card>
      </>}

      {/* ── ACCOUNT ─────────────────────────────────────────────── */}
      {section==="account" && <>
        {/* Was in the old Partner tab; the partner invite moved to Your family. */}
        <div style={{ background:T.sand, borderRadius:16, padding:"16px 20px", marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:700, color:T.esp, margin:"0 0 2px" }}>Set up with Cleo</p>
            <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:0 }}>Update your household info in a conversation with Cleo</p>
          </div>
          <button onClick={() => setShowCleoSetup(true)}
            style={{ background:T.esp, color:"#fff", border:"none", borderRadius:10, padding:"8px 16px", fontFamily:F.sans, fontSize:12, fontWeight:600, cursor:"pointer", flexShrink:0 }}>
            Start ✦
          </button>
        </div>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 10px" }}>Currency</p>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {SUPPORTED_CURRENCIES.map(c => {
              const active = ((profile as any)?.currency || "USD") === c.code;
              return (
                <button key={c.code} onClick={async()=>{
                  setProfile({ ...(profile as any), currency: c.code });
                  if (user?.uid) { try { await saveData(user.uid, "profile", { currency: c.code }); } catch { /* non-fatal */ } }
                  toast.success(`Currency set to ${c.code}`);
                }} style={{ padding:"7px 12px", borderRadius:16, border:`1.5px solid ${active?T.gold:T.linen}`, background:active?`${T.gold}20`:"#fff", color:active?"#5E4A8C":T.bark, fontFamily:F.sans, fontSize:12, fontWeight:active?700:400, cursor:"pointer", minHeight:36, touchAction:"manipulation" }}>
                  {c.label}
                </button>
              );
            })}
          </div>
          <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"10px 0 0" }}>Cleo and every screen will show money in this currency.</p>
        </Card>
        <Card>
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 12px" }}>Account info</p>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:16 }}>
            <div style={{ width:52, height:52, borderRadius:"50%", background:`linear-gradient(135deg,${T.gold},#5E4A8C)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>
              {(profile as any)?.avatar || "👩"}
            </div>
            <div>
              <p style={{ fontFamily:F.sans, fontSize:15, fontWeight:700, color:T.esp, margin:0 }}>{(profile as any)?.name || "Your name"}</p>
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"2px 0 0" }}>{user?.email}</p>
            </div>
          </div>
          {(window as any).Capacitor?.isNativePlatform?.() && (
            <>
              <button onClick={async()=>{
                const { enablePush } = await import("../../core/pushNotifications");
                const ok = await enablePush(user!.uid);
                if (ok) toast.success("Notifications on ✓");
                else toast("Enable notifications in iOS Settings to get reminders", { icon: "🔔" });
              }} style={{ width:"100%", padding:"12px", background:T.esp, border:"none", borderRadius:12, fontFamily:F.sans, fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", minHeight:44, marginBottom:8, touchAction:"manipulation" }}>
                🔔 Turn on notifications
              </button>
              <button onClick={async()=>{
                const { sendTestPush } = await import("../../core/pushNotifications");
                const r = await sendTestPush("briefing");
                if (r && r.sent > 0) toast.success("Morning briefing sent ✓");
                else if (r) toast("Turn on notifications first", { icon: "🔔" });
                else toast.error("Couldn't send notification");
              }} style={{ width:"100%", padding:"12px", background:"none", border:`1px solid ${T.linen}`, borderRadius:12, fontFamily:F.sans, fontSize:13, color:T.taupe, cursor:"pointer", minHeight:44, marginBottom:8, touchAction:"manipulation" }}>
                Preview morning briefing
              </button>
            </>
          )}
          <button onClick={async()=>{ const { signOutCompletely } = await import("../../core/signOut"); await signOutCompletely(); }} style={{ width:"100%", padding:"12px", background:"none", border:`1px solid ${T.linen}`, borderRadius:12, fontFamily:F.sans, fontSize:13, color:T.taupe, cursor:"pointer", minHeight:44, marginBottom:8 }}>
            Sign out of HerNest
          </button>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 8px" }}>Notifications</p>
          {/* What HerNest actually sends. (Replaced five switches that looked
              real but did nothing; per-type on/off can come back once the
              server reads a preference.) */}
          {[
            { label:"Morning briefing", desc:"Around 7am your time" },
            { label:"Bill reminders",   desc:"Before each bill is due. Change them on each bill in the Bills tab" },
            { label:"Birthdays",        desc:"On the day" },
          ].map(n=>(
            <div key={n.label} style={{ padding:"10px 0", borderBottom:`1px solid ${T.linen}` }}>
              <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:0 }}>{n.label}</p>
              <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"2px 0 0" }}>{n.desc}</p>
            </div>
          ))}
          <p style={{ fontFamily:F.sans, fontSize: 12, color:T.taupe, margin:"10px 0 0", lineHeight:1.5 }}>To turn notifications off, go to iPhone Settings, then Notifications, then HerNest.</p>
        </Card>

        <Card>
          <p style={{ fontFamily:F.sans, fontSize: 14, fontWeight: 600, color:T.taupe, margin:"0 0 4px" }}>Support</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 12px" }}>We're here to help.</p>
          <a
            href={`mailto:support@hernest.app?subject=${encodeURIComponent("HerNest feedback")}&body=${encodeURIComponent(`What happened:\n\nWhat I expected:\n\n—\nBuild: 2.0.0 · ${typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "dev"}\nScreen: ${window.innerWidth}×${window.innerHeight}\nDevice: ${navigator.userAgent}`)}`}
            style={{ display:"block", textAlign:"center", background:T.esp, color:"#fff", borderRadius:12, padding:"12px", fontFamily:F.sans, fontSize:13, fontWeight:700, textDecoration:"none", marginBottom:12, minHeight:44, boxSizing:"border-box" }}>
            ✦ Send feedback
          </a>
          {[
            { label:"Email support", value:"support@hernest.app", icon:"✉️" },
            { label:"Privacy requests", value:"privacy@hernest.app", icon:"🔒" },
            { label:"Version", value:`2.0.0 · ${typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "dev"}`, icon:"ℹ️" },
          ].map(item=>(
            <div key={item.label} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:`1px solid ${T.linen}` }}>
              <span style={{ fontSize:18 }}>{item.icon}</span>
              <div style={{ flex:1 }}>
                <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:0 }}>{item.label}</p>
                <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:600, color:T.esp, margin:"2px 0 0" }}>{item.value}</p>
              </div>
            </div>
          ))}
        </Card>

        {/* Delete Account */}
        <Card>
          <p style={{ fontFamily:F.sans, fontSize:13, fontWeight:700, color:"#dc2626", margin:"0 0 8px" }}>⚠ Delete Account</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 16px", lineHeight:1.6 }}>
            This will permanently delete your account and all data — profile, tasks, budget, memories, everything. This cannot be undone.
          </p>
          {!showDeleteFlow ? (
            <button onClick={()=>setShowDeleteFlow(true)} style={{ width:"100%", padding:"12px", background:"none", border:"1.5px solid #dc2626", borderRadius:12, fontFamily:F.sans, fontSize:13, color:"#dc2626", cursor:"pointer", minHeight:44, touchAction:"manipulation" }}>
              Delete My Account
            </button>
          ) : (
            <>
              {auth.currentUser?.providerData.some(p => p.providerId === "apple.com") && (
                <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 10px" }}>Apple will ask you to confirm once more so we can disconnect your Apple ID.</p>
              )}
              <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 10px" }}>Type <strong>DELETE</strong> to confirm:</p>
              <input value={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.value)} placeholder="Type DELETE" style={{ width:"100%", background:T.sand, border:`1.5px solid #dc262640`, borderRadius:12, padding:"12px 14px", fontFamily:F.sans, fontSize:16, color:T.esp, outline:"none", marginBottom:12, boxSizing:"border-box", minHeight:48 }}/>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>{ setShowDeleteFlow(false); setDeleteConfirm(""); }} style={{ flex:1, padding:"12px", background:"none", border:`1px solid ${T.linen}`, borderRadius:12, fontFamily:F.sans, fontSize:13, color:T.taupe, cursor:"pointer", minHeight:44 }}>Cancel</button>
                <button onClick={handleDeleteAccount} disabled={deleteConfirm!=="DELETE"||deleting} style={{ flex:1, padding:"12px", background:deleteConfirm==="DELETE"?"#dc2626":T.linen, color:"#fff", border:"none", borderRadius:12, fontFamily:F.sans, fontSize:13, fontWeight:700, cursor:deleteConfirm==="DELETE"?"pointer":"not-allowed", minHeight:44, touchAction:"manipulation" }}>
                  {deleting?"Deleting...":"Permanently Delete"}
                </button>
              </div>
            </>
          )}
        </Card>
      </>}
    </div>
  );
}
