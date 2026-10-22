// ─── Calendar → now Plan → Week ──────────────────────────────────
// The calendar view moved into Plan → Week (calendar, school and chores in
// one list). School dates are added only in Plan → School. Google and Outlook
// are connected in Connections. What's left here is the Apple Calendar step,
// because Connections' "Apple Calendar" row opens this screen.
// (Removing the iCloud password option is planned; iPhone calendar access
// is the better route.)
import { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { Card, PageTitle } from "../../shared/components";
import { db, auth } from "../../core/firebase";
import toast from "react-hot-toast";
import { deviceCalendarSupported, deviceCalendarConnected, connectDeviceCalendar } from "../../core/deviceCalendar";
import { PLAN_TAB_KEY } from "../plan/planHelpers";

const onDevice = deviceCalendarSupported();

function openPlan(tab: "week" | "school") {
  try { sessionStorage.setItem(PLAN_TAB_KEY, tab); } catch { /* private mode */ }
  useStore.getState().setActiveTab("plan");
}

export function CalendarScreen() {
  const { user } = useStore();
  const [appleConnected, setAppleConnected] = useState(false);
  const [showAppleModal, setShowAppleModal] = useState(false);
  const [appleEmail, setAppleEmail] = useState("");
  const [applePassword, setApplePassword] = useState("");
  const [appleLoading, setAppleLoading] = useState(false);

  // Web OAuth returns here with ?calendar_connected=… on some flows.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const which = params.get("calendar_connected");
    if (which === "google") toast.success("Google Calendar connected ✓");
    if (which === "outlook") toast.success("Outlook Calendar connected ✓");
    if (params.get("calendar_error")) toast.error("Calendar connection failed — try again");
    if (which || params.get("calendar_error")) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    if (onDevice) { deviceCalendarConnected().then(setAppleConnected); return; }
    import("firebase/firestore").then(({ doc, getDoc }) =>
      getDoc(doc(db, "users", user.uid, "integrations", "apple_calendar"))
        .then(snap => setAppleConnected(snap.exists() && !!snap.data()?.email))
        .catch(() => setAppleConnected(false)));
  }, [user?.uid]);

  const connectApple = async () => {
    if (!onDevice) { setShowAppleModal(true); return; }
    if (await connectDeviceCalendar()) { setAppleConnected(true); toast.success("iPhone calendars connected ✓"); }
    else toast.error("Calendar access is off — turn it on in Settings → HerNest → Calendars");
  };

  const connectICloud = async () => {
    if (!appleEmail || !applePassword) return;
    setAppleLoading(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/auth/apple", { method: "POST", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: appleEmail, password: applePassword }) });
      if (res.ok || res.redirected) { setAppleConnected(true); setShowAppleModal(false); setApplePassword(""); toast.success("Apple Calendar connected ✓"); }
      else { const d = await res.json().catch(() => ({})); toast.error(d.error || "Connection failed"); }
    } catch { toast.error("Connection failed — check your details"); }
    setAppleLoading(false);
  };

  const rowBtn = { background: T.esp, color: "#fff", border: "none", borderRadius: 10, padding: "8px 16px", fontFamily: F.sans, fontSize: 12, fontWeight: 600, cursor: "pointer", minHeight: 36, flexShrink: 0 } as const;

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <PageTitle eyebrow="Calendar" title={onDevice ? "iPhone Calendars" : "Apple Calendar"} />

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }}></span>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>{onDevice ? "iPhone Calendars" : "Apple Calendar"}</p>
            <p style={{ fontFamily: F.sans, fontSize: 12, color: appleConnected ? T.sage : T.taupe, margin: "2px 0 0" }}>
              {appleConnected ? "✓ Connected — shows in Plan → Week" : onDevice ? "Every calendar on this iPhone" : "iCloud Calendar sync"}
            </p>
          </div>
          {appleConnected
            ? (!onDevice && <button onClick={() => setShowAppleModal(true)} style={{ ...rowBtn, background: `${T.sage}15`, color: T.sage }}>Reconnect</button>)
            : <button onClick={connectApple} style={rowBtn}>Connect</button>}
        </div>
      </Card>

      <button onClick={() => openPlan("week")} style={{ width: "100%", padding: "14px", background: T.goldP, border: `1px solid ${T.gold}40`, borderRadius: 14, fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: T.gold, cursor: "pointer", minHeight: 48, marginBottom: 8 }}>
        📅 See your week in Plan
      </button>
      <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, textAlign: "center", lineHeight: 1.6, margin: "4px 0 0" }}>
        Your calendar, school dates and chores are now together in Plan → Week.{" "}
        <button onClick={() => openPlan("school")} style={{ background: "none", border: "none", padding: 0, fontFamily: F.sans, fontSize: 12, color: T.gold, cursor: "pointer", textDecoration: "underline" }}>Add school dates in Plan → School</button>.
      </p>

      {showAppleModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(42,31,24,0.5)", zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: "24px 20px", width: "100%", maxWidth: 430, boxShadow: "0 -8px 40px rgba(42,31,24,0.15)" }}>
            <p style={{ fontFamily: F.serif, letterSpacing: "-0.02em", fontWeight: 700, fontSize: 22, color: T.esp, margin: "0 0 6px" }}>Connect Apple Calendar</p>
            <p style={{ fontFamily: F.sans, fontSize: 12, color: T.taupe, margin: "0 0 4px" }}>Use an app-specific password — not your Apple ID password.</p>
            <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noreferrer" style={{ fontFamily: F.sans, fontSize: 12, color: "#0071e3", display: "block", marginBottom: 16 }}>Generate one at appleid.apple.com ›</a>
            <input value={appleEmail} onChange={e => setAppleEmail(e.target.value)} placeholder="you@icloud.com" type="email" style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "12px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 12, boxSizing: "border-box" }} />
            <input value={applePassword} onChange={e => setApplePassword(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx" type="password" style={{ width: "100%", background: T.sand, border: `1.5px solid ${T.linen}`, borderRadius: 12, padding: "12px 14px", fontFamily: F.sans, fontSize: 16, color: T.esp, outline: "none", marginBottom: 20, boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={connectICloud} disabled={!appleEmail || !applePassword || appleLoading} style={{ flex: 1, padding: "14px", background: appleEmail && applePassword ? "#000" : "#ccc", color: "#fff", border: "none", borderRadius: 14, fontFamily: F.sans, fontSize: 14, fontWeight: 600, cursor: appleEmail && applePassword ? "pointer" : "not-allowed", minHeight: 52 }}>
                {appleLoading ? "Connecting..." : "Connect"}
              </button>
              <button onClick={() => setShowAppleModal(false)} style={{ flex: 1, padding: "14px", background: "none", border: `1.5px solid ${T.linen}`, borderRadius: 14, fontFamily: F.sans, fontSize: 14, color: T.bark, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
