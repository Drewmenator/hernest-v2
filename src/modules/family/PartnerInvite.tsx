// ─── Invite your partner (moved here from Settings → Partner) ─────
// Sends a household invite by email, or makes a link to share when email
// isn't available. The partner signs in and sees the parts chosen below.
import React, { useState } from "react";
import { T, F, alpha } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, Button, Emoji } from "../../shared/components";
import { Check, CalendarDays, Wallet, CircleUser } from "lucide-react";
import { auth } from "../../core/firebase";
import { bus } from "../../core/events";
import { onEnterSpace } from "../../shared/utils/a11y";
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
    <button onClick={() => setOpen(true)}
      style={{ width: "100%", marginTop: 12, padding: "14px", background: T.goldP, border: `1.5px solid ${alpha(T.gold, 0.25)}`, borderRadius: 16, fontFamily: F.sans, fontSize: 13, fontWeight: 700, color: T.esp, cursor: "pointer", minHeight: 48, touchAction: "manipulation" }}>
      <Emoji e="💛" /> Invite your partner to HerNest
    </button>
  );

  return (
    <div style={{ marginTop: 12 }}>
      <Card>
        <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.taupe, margin: "0 0 8px" }}>Invite your partner</p>
        <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: "0 0 16px", lineHeight: 1.6 }}>
          Your partner joins your household and sees the parts you choose. Bills are shared so either of you can mark one paid.
        </p>
        {!inviteSent ? <>
          <input value={partnerEmail} onChange={e => setPartnerEmail(e.target.value)} placeholder="Partner's email address" type="email"
            style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "12px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 16, boxSizing: "border-box", minHeight: 48 }} />
          <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.taupe, margin: "0 0 10px" }}>What to share</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {SHARE_OPTIONS.map(opt => {
              const on = shareCategories.includes(opt.id);
              return (
                <div key={opt.id} onClick={() => toggleShare(opt.id)} role="button" tabIndex={0} onKeyDown={onEnterSpace} aria-label={`Toggle sharing: ${opt.label}`}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: on ? T.goldP : T.sand, border: `1.5px solid ${on ? T.gold : T.linen}`, borderRadius: 12, cursor: "pointer", touchAction: "manipulation" }}>
                  <span style={{ display: "inline-flex", color: T.goldText }}>{opt.icon}</span>
                  <p style={{ fontFamily: F.sans, fontSize: 13, color: T.esp, margin: 0, flex: 1 }}>{opt.label}</p>
                  <div style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${on ? T.gold : T.linen}`, background: on ? T.gold : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: T.onAction, fontSize: 13 }}>
                    {on ? <Check size={14} strokeWidth={2.6} aria-hidden="true" /> : null}
                  </div>
                </div>
              );
            })}
          </div>
          <Button onClick={sendPartnerInvite} disabled={!partnerEmail.trim() || sendingInvite} variant="gold">
            {sendingInvite ? "Sending..." : "Send invite"}
          </Button>
          <button onClick={() => setOpen(false)} style={{ width: "100%", marginTop: 8, background: "none", border: "none", fontFamily: F.sans, fontSize: 13, color: T.taupe, cursor: "pointer", minHeight: 40 }}>Not now</button>
        </> : (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ marginBottom: 12, color: T.gold }}><Emoji e="✦" size={44} /></div>
            <p style={{ fontFamily: F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize: 20, color: T.esp, margin: "0 0 8px" }}>Invite ready!</p>
            <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: "0 0 16px" }}>Share this link with {partnerEmail}. When they open it and sign in, they'll join your household.</p>
            {inviteLink && <>
              <div style={{ background: T.sand, border: `1px solid ${T.linen}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12, wordBreak: "break-all", fontFamily: F.sans, fontSize: 12, color: T.bark, textAlign: "left" }}>{inviteLink}</div>
              <button onClick={shareLink} style={{ width: "100%", background: T.esp, color: T.onAction, border: "none", borderRadius: 12, padding: "13px", fontFamily: F.sans, fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 48, marginBottom: 8, touchAction: "manipulation" }}>Copy / share link</button>
            </>}
            <button onClick={() => { setInviteSent(false); setInviteLink(""); }} style={{ background: "none", border: `1px solid ${T.linen}`, borderRadius: 12, padding: "8px 20px", fontFamily: F.sans, fontSize: 13, color: T.taupe, cursor: "pointer", minHeight: 40 }}>Send another</button>
          </div>
        )}
      </Card>
    </div>
  );
}
