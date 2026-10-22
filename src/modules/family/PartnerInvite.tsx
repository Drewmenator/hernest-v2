// ─── Invite your partner (moved here from Settings → Partner) ─────
// Sends a household invite by email, or makes a link to share when email
// isn't available. The partner signs in and sees the parts chosen below.
import React, { useState } from "react";
import { T, F, TYPE, S, R, ATMOS_TEXT2 } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, Button, Input, CheckBox, GlowCard, Headline, Detail, TextButton, Emoji } from "../../shared/components";
import { Check, Copy, CalendarDays, Wallet, CircleUser } from "lucide-react";
import { auth } from "../../core/firebase";
import { bus } from "../../core/events";
import toast from "react-hot-toast";

const SHARE_OPTIONS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: "tasks",    label: "Tasks & Plan",     icon: <Check size={18} strokeWidth={1.9} aria-hidden="true" /> },
  { id: "calendar", label: "Family calendar",  icon: <CalendarDays size={18} strokeWidth={1.9} aria-hidden="true" /> },
  { id: "budget",   label: "Bills",            icon: <Wallet size={18} strokeWidth={1.9} aria-hidden="true" /> },
  { id: "trips",    label: "Trip plans",       icon: <Emoji e="✈" /> },
  { id: "school",   label: "School events",    icon: <Emoji e="🏫" /> },
  { id: "circle",   label: "Family check-ins", icon: <CircleUser size={18} strokeWidth={1.9} aria-hidden="true" /> },
];

export function PartnerInvite() {
  const { user, profile } = useStore();
  const [open, setOpen] = useState(false);
  const [partnerEmail, setPartnerEmail] = useState("");
  const [shareCategories, setShareCategories] = useState<string[]>(["tasks", "calendar", "budget"]);
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);

  const toggleShare = (id: string) => {
    setShareCategories(p => p.includes(id) ? p.filter(s => s !== id) : [...p, id]);
  };

  const sendPartnerInvite = async () => {
    if (!partnerEmail.trim() || !user?.uid) return;
    setSendingInvite(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/invite/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          fromName: (profile as { name?: string } | null)?.name || "Your partner",
          toEmail: partnerEmail.trim(),
          shareCategories,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      await bus.publish("partner.invite.sent", { email: partnerEmail }, { userId: user.uid, source: "family" });
      if (data.acceptUrl) setInviteLink(data.acceptUrl);
      setInviteSent(true);
      toast.success(data.emailSent ? `Invite sent to ${partnerEmail} ` : "Invite ready. Share the link below");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't create invite. Try again");
    }
    setSendingInvite(false);
  };

  const shareLink = async () => {
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    try {
      if (nav.share) { await nav.share({ title: "Join my HerNest household", url: inviteLink }); }
      else { await navigator.clipboard.writeText(inviteLink); toast.success("Link copied"); }
    } catch {
      try { await navigator.clipboard.writeText(inviteLink); toast.success("Link copied"); }
      catch { toast("Long-press the link above to copy", { icon: <Emoji e="🔗" /> }); }
    }
  };

  if (!open) return (
    <GlowCard tint="cleo" onClick={() => setOpen(true)} ariaExpanded={false} style={{ marginTop: S.md, padding: S.lg, minHeight: 60 }}>
      <span style={{ display: "flex", alignItems: "center", gap: S.md }}>
        <Emoji e="💛" tile />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: F.sans, fontSize: TYPE.card, fontWeight: 600, color: T.text }}>Invite your partner to HerNest</span>
          <span style={{ display: "block", fontFamily: F.sans, fontSize: TYPE.support, color: ATMOS_TEXT2, marginTop: 2 }}>Share bills, plans and check-ins</span>
        </span>
      </span>
    </GlowCard>
  );

  return (
    <div style={{ marginTop: S.md }}>
      <Card>
        <h3 style={{ fontFamily: F.sans, fontSize: TYPE.card, fontWeight: 600, color: T.text, margin: "0 0 6px" }}>Invite your partner</h3>
        <p style={{ fontFamily: F.sans, fontSize: TYPE.support, color: T.text2, margin: `0 0 ${S.lg}px`, lineHeight: 1.5 }}>
          Your partner joins your household and sees the parts you choose. Bills are shared so either of you can mark one paid.
        </p>
        {!inviteSent ? <>
          <div style={{ marginBottom: S.lg }}>
            <Input label="Email" value={partnerEmail} onChange={setPartnerEmail} placeholder="Partner's email address" type="email" />
          </div>
          <p style={{ fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text, margin: `0 0 ${S.sm}px` }}>What to share</p>
          <div style={{ display: "flex", flexDirection: "column", gap: S.sm, marginBottom: S.lg }}>
            {SHARE_OPTIONS.map(opt => {
              const on = shareCategories.includes(opt.id);
              return (
                <div key={opt.id} onClick={() => toggleShare(opt.id)}
                  style={{ display: "flex", alignItems: "center", gap: S.md, minHeight: 52, padding: "4px 14px", background: on ? T.cleoBg : T.sand, borderRadius: R.button, cursor: "pointer", touchAction: "manipulation" }}>
                  <span style={{ display: "inline-flex", color: T.action }}>{opt.icon}</span>
                  <span style={{ fontFamily: F.sans, fontSize: TYPE.body, color: T.text, flex: 1 }}>{opt.label}</span>
                  <CheckBox checked={on} onToggle={() => { /* the row handles the toggle */ }} label={`Toggle sharing: ${opt.label}`} />
                </div>
              );
            })}
          </div>
          <Button onClick={sendPartnerInvite} disabled={!partnerEmail.trim() || sendingInvite}>
            {sendingInvite ? "Sending..." : "Send invite"}
          </Button>
          <div style={{ textAlign: "center", marginTop: S.xs }}>
            <TextButton onClick={() => setOpen(false)} color={T.text2}>Not now</TextButton>
          </div>
        </> : (
          <div style={{ textAlign: "center", padding: `${S.sm}px 0` }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: S.md }}><Emoji e="✦" size={26} tile /></div>
            <Headline size={22}>Invite ready</Headline>
            <Detail style={{ margin: `${S.sm}px 0 ${S.lg}px`, color: T.text2 }}>Share this link with {partnerEmail}. When they open it and sign in, they'll join your household.</Detail>
            {inviteLink && <>
              <div style={{ background: T.sand, borderRadius: R.button, padding: "12px 14px", marginBottom: S.md, wordBreak: "break-all", fontFamily: F.sans, fontSize: TYPE.meta, color: T.text, textAlign: "left", border: `1px solid ${T.divider}` }}>{inviteLink}</div>
              <Button onClick={shareLink} style={{ marginBottom: S.sm }}><Copy size={16} strokeWidth={2} aria-hidden="true" /> Copy / share link</Button>
            </>}
            <Button variant="secondary" onClick={() => { setInviteSent(false); setInviteLink(""); }}>Send another</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
