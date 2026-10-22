import { loadMemoriesV2, deleteMemory } from '../../core/memoryServiceV2';
import React, { useState } from "react";
import { CleoSetupScreen } from "../onboarding/OnboardingScreen";
import { T, F, S, TYPE } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle, Emoji, Segmented, ListRow, Button, Pill, StatusChip, Input, GlowCard, Headline, Detail } from "../../shared/components";
import { getAppearance, setAppearance, type Appearance } from "../../shared/appearance";
import { Bookmark, Repeat, Wallet, Brain, X, Mail, Info } from "lucide-react";
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

  const exportData = async()=>{
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
    toast.success("Data exported");
  };

  const label = (t: string, hint?: string) => (
    <div style={{ marginBottom: S.sm }}>
      <p style={{ fontFamily:F.sans, fontSize:TYPE.card, fontWeight:600, color:T.text, margin:0 }}>{t}</p>
      {hint && <p style={{ fontFamily:F.sans, fontSize:TYPE.support, color:T.text2, margin:"2px 0 0", lineHeight:1.4 }}>{hint}</p>}
    </div>
  );
  const small: React.CSSProperties = { fontFamily:F.sans, fontSize:TYPE.support, color:T.text2, margin:`${S.md}px 0 0`, lineHeight:1.5 };

  return (
    <div style={{ animation:"fadeUp .45s ease both" }}>
      <PageTitle eyebrow="Account" title="Settings"/>

      <Segmented label="Settings sections" value={section} onChange={setSection}
        options={[
          { id:"privacy", label:"Privacy" },
          { id:"legal",   label:"Legal" },
          { id:"account", label:"Account" },
        ]} />

      {/* ── PRIVACY ─────────────────────────────────────────────── */}
      {section==="privacy" && <>
        <GlowCard tint="cleo" style={{ marginBottom: S.md }}>
          <Headline size={22}>Your privacy at HerNest</Headline>
          <Detail>
            HerNest is built on a foundation of trust. We take your privacy seriously — especially because you share sensitive family, health, and financial information with Cleo.
          </Detail>
        </GlowCard>

        <Card>
          {PRIVACY_ITEMS.map((item, idx)=>(
            <ListRow key={item.title} divider={idx>0}
              leading={<Emoji e={item.icon} tile size={16} />}
              title={item.title}
              detail={item.body} />
          ))}
          <p style={{ ...small, textAlign:"center" }}>
            Questions? Email us at privacy@hernest.app
          </p>
        </Card>

        {/* What Cleo Knows — Memory V2 */}
        <Card>
          <ListRow divider={false}
            title="What Cleo knows"
            detail="Facts, preferences and patterns Cleo has learned about your household"
            trailing={<Button size="sm" variant="gentle" onClick={loadMemories} style={{ width:"auto", flexShrink:0 }}>View</Button>} />
          {showMemoryV2 && (
            <div>
              {memoryV2List.length === 0 && (
                <p style={{ ...small, textAlign:"center", padding:"8px 0" }}>Cleo is still getting to know you. Keep using the app and she'll learn your patterns.</p>
              )}
              {memoryV2List.length > 0 && memoryV2List.slice(0, 20).map((mem: any, i: number) => (
                <ListRow key={mem.id ?? i}
                  leading={
                    <span aria-hidden="true" style={{ flexShrink:0, display:"inline-flex", color:T.action }}>
                      {mem.type === "preference" ? <Bookmark size={18} strokeWidth={1.9} /> : mem.type === "pattern" ? <Repeat size={18} strokeWidth={1.9} /> : mem.type === "financial_context" ? <Wallet size={18} strokeWidth={1.9} /> : <Brain size={18} strokeWidth={1.9} />}
                    </span>
                  }
                  title={<span style={{ fontWeight:500, fontSize:TYPE.body }}>{mem.content}</span>}
                  detail={<span style={{ textTransform:"capitalize" }}>{mem.type} · {mem.sourceModule} · {mem.confidence} confidence</span>}
                  trailing={
                    <button aria-label="Forget this memory" onClick={async () => { await deleteMemory(user!.uid, mem.id); setMemoryV2List(p => p.filter((m: any) => m.id !== mem.id)); }}
                      style={{ background:"none", border:"none", color:T.text2, cursor:"pointer", width:44, height:44, margin:"-8px -10px -8px 0", display:"grid", placeItems:"center", flexShrink:0, touchAction:"manipulation" }}><X size={18} strokeWidth={1.9} aria-hidden="true" /></button>
                  } />
              ))}
              {memoryV2List.length > 20 && (
                <p style={{ ...small, textAlign:"center" }}>+{memoryV2List.length - 20} more memories</p>
              )}
            </div>
          )}
        </Card>

        {/* Data export */}
        <Card>
          {label("Export your data", "You can download a copy of all the data HerNest holds about you.")}
          <Button variant="secondary" onClick={exportData}>
            <Emoji e="📥" /> Export my data (JSON)
          </Button>
        </Card>
      </>}

      {/* ── LEGAL ───────────────────────────────────────────────── */}
      {section==="legal" && <>
        <Card>
          {label("Terms of Service", "Last updated: May 2026")}
          {TERMS.map((item, idx)=>(
            <ListRow key={item.title} divider={idx>0} title={item.title} detail={item.body} />
          ))}
        </Card>

        <Card>
          {label("Privacy Policy", "Last updated: May 2026")}
          {POLICY.map((item, idx)=>(
            <ListRow key={item.title} divider={idx>0} title={item.title} detail={item.body} />
          ))}
        </Card>

        <Card>
          {label("Cookie Policy", "HerNest uses essential cookies only:")}
          {COOKIES.map((c, idx)=>(
            <ListRow key={c.name} divider={idx>0}
              title={c.name}
              detail={`${c.purpose} · ${c.duration}`}
              trailing={<StatusChip status="handled">{c.type}</StatusChip>} />
          ))}
          <p style={small}>We do not use advertising, tracking, or analytics cookies. No third-party cookies are set without your consent.</p>
        </Card>
      </>}

      {/* ── ACCOUNT ─────────────────────────────────────────────── */}
      {section==="account" && <>
        {/* Was in the old Partner tab; the partner invite moved to Your family. */}
        <GlowCard tint="cleo" style={{ marginBottom: S.md }}>
          <ListRow divider={false}
            title={<span style={{ fontFamily:F.display, fontSize:20, fontWeight:500 }}>Set up with Cleo</span>}
            detail="Update your household info in a conversation with Cleo"
            trailing={<Button size="sm" onClick={() => setShowCleoSetup(true)} style={{ width:"auto", flexShrink:0 }}>Start</Button>} />
        </GlowCard>
        <Card>
          {label("Currency", "Cleo and every screen will show money in this currency.")}
          <div style={{ display:"flex", gap:S.sm, flexWrap:"wrap" }}>
            {SUPPORTED_CURRENCIES.map(c => {
              const active = ((profile as any)?.currency || "USD") === c.code;
              return (
                <Pill key={c.code} label={c.label} active={active} onClick={async()=>{
                  setProfile({ ...(profile as any), currency: c.code });
                  if (user?.uid) { try { await saveData(user.uid, "profile", { currency: c.code }); } catch { /* non-fatal */ } }
                  toast.success(`Currency set to ${c.code}`);
                }} />
              );
            })}
          </div>
        </Card>
        <AppearanceCard />
        <Card>
          <div style={{ display:"flex", alignItems:"center", gap:S.lg, marginBottom:S.lg }}>
            <div style={{ width:52, height:52, flexShrink:0, borderRadius:"50%", background:`linear-gradient(135deg,${T.action},${T.actionPress})`, display:"flex", alignItems:"center", justifyContent:"center", color:T.onAction }}>
              {/^https?:\/\//.test((profile as { avatar?: string } | null)?.avatar || "") ? <img src={(profile as { avatar?: string }).avatar} alt="" style={{ width:"100%", height:"100%", borderRadius:"50%", objectFit:"cover" }} /> : <Emoji e={(profile as { avatar?: string } | null)?.avatar || "👩"} size={24} color={T.onAction} />}
            </div>
            <div style={{ minWidth:0 }}>
              <p style={{ fontFamily:F.display, fontSize:20, fontWeight:500, color:T.text, margin:0 }}>{(profile as any)?.name || "Your name"}</p>
              <p style={{ fontFamily:F.sans, fontSize:TYPE.support, color:T.text2, margin:"2px 0 0", overflowWrap:"anywhere" }}>{user?.email}</p>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:S.sm }}>
            {(window as any).Capacitor?.isNativePlatform?.() && (
              <>
                <Button onClick={async()=>{
                  const { enablePush } = await import("../../core/pushNotifications");
                  const ok = await enablePush(user!.uid);
                  if (ok) toast.success("Notifications on");
                  else toast("Enable notifications in iOS Settings to get reminders", { icon: <Emoji e="🔔" /> });
                }}>
                  <Emoji e="🔔" color={T.onAction} /> Turn on notifications
                </Button>
                <Button variant="secondary" onClick={async()=>{
                  const { sendTestPush } = await import("../../core/pushNotifications");
                  const r = await sendTestPush("briefing");
                  if (r && r.sent > 0) toast.success("Morning briefing sent");
                  else if (r) toast("Turn on notifications first", { icon: <Emoji e="🔔" /> });
                  else toast.error("Couldn't send notification");
                }}>
                  Preview morning briefing
                </Button>
              </>
            )}
            <Button variant="secondary" onClick={async()=>{ const { signOutCompletely } = await import("../../core/signOut"); await signOutCompletely(); }}>
              Sign out of HerNest
            </Button>
          </div>
        </Card>

        <Card>
          {label("Notifications")}
          {/* What HerNest actually sends. (Replaced five switches that looked
              real but did nothing; per-type on/off can come back once the
              server reads a preference.) */}
          {[
            { label:"Morning briefing", desc:"Around 7am your time" },
            { label:"Bill reminders",   desc:"Before each bill is due. Change them on each bill in the Bills tab" },
            { label:"Birthdays",        desc:"On the day" },
          ].map((n, idx)=>(
            <ListRow key={n.label} divider={idx>0} title={n.label} detail={n.desc} />
          ))}
          <p style={small}>To turn notifications off, go to iPhone Settings, then Notifications, then HerNest.</p>
        </Card>

        <Card>
          {label("Support", "We're here to help.")}
          <a
            href={`mailto:support@hernest.app?subject=${encodeURIComponent("HerNest feedback")}&body=${encodeURIComponent(`What happened:\n\nWhat I expected:\n\n—\nBuild: 2.0.0 · ${typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "dev"}\nScreen: ${window.innerWidth}×${window.innerHeight}\nDevice: ${navigator.userAgent}`)}`}
            style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:T.action, color:T.onAction, borderRadius:12, padding:"0 20px", fontFamily:F.sans, fontSize:TYPE.body, fontWeight:600, textDecoration:"none", marginBottom:S.xs, minHeight:50, boxSizing:"border-box" }}>
            <Emoji e="✦" size={16} color={T.onAction} /> Send feedback
          </a>
          <ListRow title="Email support" detail="support@hernest.app"
            leading={<Mail size={20} strokeWidth={1.9} color={T.action} aria-hidden="true" />} />
          <ListRow title="Privacy requests" detail="privacy@hernest.app"
            leading={<Emoji e="🔒" size={20} color={T.action} />} />
          <ListRow title="Version" detail={`2.0.0 · ${typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "dev"}`}
            leading={<Info size={20} strokeWidth={1.9} color={T.action} aria-hidden="true" />} />
        </Card>

        {/* Delete Account */}
        <Card>
          <p style={{ fontFamily:F.display, fontSize:TYPE.section, fontWeight:500, color:T.text, margin:`0 0 ${S.sm}px` }}>
            <span style={{ color:T.danger }}>Delete</span> account
          </p>
          <p style={{ fontFamily:F.sans, fontSize:TYPE.support, color:T.text2, margin:`0 0 ${S.lg}px`, lineHeight:1.6 }}>
            This will permanently delete your account and all data — profile, tasks, budget, memories, everything. This cannot be undone.
          </p>
          {!showDeleteFlow ? (
            <Button variant="secondary" onClick={()=>setShowDeleteFlow(true)} style={{ color:T.danger, border:`1.5px solid ${T.danger}`, background:"transparent" }}>
              Delete my account
            </Button>
          ) : (
            <>
              {auth.currentUser?.providerData.some(p => p.providerId === "apple.com") && (
                <p style={{ fontFamily:F.sans, fontSize:TYPE.support, color:T.text2, margin:`0 0 ${S.md}px` }}>Apple will ask you to confirm once more so we can disconnect your Apple ID.</p>
              )}
              <p style={{ fontFamily:F.sans, fontSize:TYPE.support, color:T.text2, margin:`0 0 ${S.md}px` }}>Type <strong style={{ color:T.text }}>DELETE</strong> to confirm:</p>
              <Input value={deleteConfirm} onChange={setDeleteConfirm} placeholder="Type DELETE" style={{ marginBottom:S.md, borderColor:T.danger }} />
              <div style={{ display:"flex", gap:S.sm }}>
                <Button variant="secondary" onClick={()=>{ setShowDeleteFlow(false); setDeleteConfirm(""); }}>Cancel</Button>
                <Button onClick={handleDeleteAccount} disabled={deleteConfirm!=="DELETE"||deleting}
                  style={deleteConfirm==="DELETE" ? { background:T.danger, color:T.onAction } : { background:T.divider, color:T.text2 }}>
                  {deleting?"Deleting...":"Permanently delete"}
                </Button>
              </div>
            </>
          )}
        </Card>
      </>}
    </div>
  );
}

// Light (Wisteria Glow), dark (Midnight Wisteria), or follow the iPhone.
function AppearanceCard() {
  const [pref, setPref] = useState<Appearance>(getAppearance);
  return (
    <Card>
      <p style={{ fontFamily:F.sans, fontSize:TYPE.card, fontWeight:600, color:T.text, margin:`0 0 ${S.md}px` }}>Appearance</p>
      <Segmented label="Appearance" value={pref} onChange={v => { setPref(v); setAppearance(v); }} options={[
        { id: "auto", label: "Automatic" },
        { id: "light", label: "Light" },
        { id: "dark", label: "Dark" },
      ]} />
      <p style={{ fontFamily:F.sans, fontSize:TYPE.support, color:T.text2, margin:`-${S.xs}px 0 0` }}>Automatic follows your iPhone's light and dark setting.</p>
    </Card>
  );
}

const PRIVACY_ITEMS = [
            { icon:"🔒", title:"Your data is yours", body:"We never sell your personal data to third parties. Ever. Your information is used only to power your HerNest experience." },
            { icon:"✦", title:"How Cleo works", body:"When you chat with Cleo or generate briefings, the relevant parts of your household data are processed by Anthropic's Claude AI to create the response. It isn't used to train AI models." },
            { icon:"🤖", title:"How Cleo uses your data", body:"Cleo's memory is stored securely in Firestore under your user ID. AI conversations are processed via Anthropic's Claude API. Anthropic does not use your conversations to train their models." },
            { icon:"📍", title:"Location data", body:"We do not collect or store your location. Any location-based features use your device's local data only." },
            { icon:"🏦", title:"Financial data", body:"Budget data is stored securely in your personal Firestore database. We never have access to your actual bank accounts or cards." },
            { icon:"👧", title:"Children's data", body:"Information about your children is stored privately under your account and never shared or used for advertising." },
            { icon:"🗑", title:"Right to erasure", body:"You can delete your entire account and all associated data at any time from Settings → Account → Delete Account." },
            { icon:"🍪", title:"Cookies", body:"We use essential cookies only — for authentication and session management. No advertising or tracking cookies." },
            { icon:"📨", title:"Emails", body:"We only send transactional emails (password reset, partner invites). No marketing emails unless you opt in." },
          ];

const TERMS = [
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
          ];

const POLICY = [
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
          ];

const COOKIES = [
  { name:"Firebase Auth", purpose:"Keeps you signed in", duration:"30 days", type:"Essential" },
  { name:"Session token", purpose:"Secure API access", duration:"Session", type:"Essential" },
];
