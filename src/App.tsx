// ─── HerNest V2 App ───────────────────────────────────────────────
import React, { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { onAuthStateChanged, getRedirectResult } from "firebase/auth";
import { auth } from "./core/firebase";
import { loadData } from "./core/firebase";
import { initConnectivity } from "./core/connectivity";
import { connectIntelligenceLayer } from "./core/intelligenceEvents";
import { useStore } from "./core/store";
import { bus } from "./core/events";
import { useContextGraph } from "./core/graph";
import { bootstrapHousehold, acceptInvite } from "./core/householdService";
import { isOnboarded } from "./core/onboarding";
import { ErrorBoundary } from "./shared/components/ErrorBoundary";
const EB = ({ name, children }: { name: string; children: React.ReactNode }) => <ErrorBoundary name={name}>{children}</ErrorBoundary>;
import { F, T } from "./config/theme";
import { TabBar } from "./shared/components/TabBar";
import { CleoMini } from "./shared/components/CleoMini";

// Screens
import { LoginScreen }      from "./modules/auth/LoginScreen";
import { OnboardingScreen } from "./modules/onboarding/OnboardingScreen";
import { HomeScreen }       from "./modules/home/HomeScreen";
import { CleoScreen }       from "./modules/cleo/CleoScreen";
const PlanScreen = React.lazy(() => import("./modules/plan/PlanScreen").then(m => ({ default: m.PlanScreen })));
const BudgetScreen = React.lazy(() => import("./modules/budget/BudgetScreen").then(m => ({ default: m.BudgetScreen })));
const BriefingScreen = React.lazy(() => import("./modules/briefing/BriefingScreen").then(m => ({ default: m.BriefingScreen })));
const ThriveScreen = React.lazy(() => import("./modules/thrive/ThriveScreen").then(m => ({ default: m.ThriveScreen })));
const StyleScreen = React.lazy(() => import("./modules/style/StyleScreen").then(m => ({ default: m.StyleScreen })));
const TripsScreen = React.lazy(() => import("./modules/trips/TripsScreen").then(m => ({ default: m.TripsScreen })));
const CircleScreen = React.lazy(() => import("./modules/circle/CircleScreen").then(m => ({ default: m.CircleScreen })));
const FamilyScreen = React.lazy(() => import("./modules/family/FamilyScreen").then(m => ({ default: m.FamilyScreen })));
const ProfileScreen = React.lazy(() => import("./modules/profile/ProfileScreen").then(m => ({ default: m.ProfileScreen })));
const CalendarScreen = React.lazy(() => import("./modules/calendar/CalendarScreen").then(m => ({ default: m.CalendarScreen })));
const MemoryScreen = React.lazy(() => import("./modules/memory/MemoryScreen").then(m => ({ default: m.MemoryScreen })));
const ConnectionsScreen = React.lazy(() => import("./modules/connections/ConnectionsScreen").then(m => ({ default: m.ConnectionsScreen })));
const SettingsScreen = React.lazy(() => import("./modules/settings/SettingsScreen").then(m => ({ default: m.SettingsScreen })));
const UpgradeScreen = React.lazy(() => import("./modules/upgrade/UpgradeScreen").then(m => ({ default: m.UpgradeScreen })));

// Global styles
const globalStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  
  /* Mobile-first base */
  html {
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
    height: 100%;
    /* Safe area support for iPhone notch/home indicator */
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  
  body {
    background: ${T.cream};
    font-family: 'DM Sans', sans-serif;
    overflow-x: hidden;
    overflow-y: auto;
    min-height: 100%;
    min-height: -webkit-fill-available;
    /* Smooth momentum scrolling on iOS */
    -webkit-overflow-scrolling: touch;
  }
  
  /* Remove tap highlights on mobile */
  * { -webkit-tap-highlight-color: transparent; }

  /* Keyboard focus must be visible — tap-highlight removal killed every
     focus cue. :focus-visible only fires for keyboard/AT, so touch is
     unaffected. */
  :focus-visible {
    outline: 2px solid ${T.gold} !important;
    outline-offset: 2px;
    border-radius: 4px;
  }

  /* Respect vestibular/motion preferences */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  
  /* Buttons — minimum 44px touch target per Apple HIG */
  button {
    cursor: pointer;
    touch-action: manipulation;
  }
  
  /* Inputs */
  input, textarea, select {
    font-family: 'DM Sans', sans-serif;
    /* Prevent zoom on focus in iOS */
    font-size: max(16px, 1em);
  }
  
  /* Scrollable containers */
  .scroll-x {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .scroll-x::-webkit-scrollbar { display: none; }

  /* Animations */
  @keyframes fadeUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
  @keyframes spin { to { transform:rotate(360deg) } }
  @keyframes breathe { 0%,100% { transform:scale(1) } 50% { transform:scale(1.04) } }
  @keyframes slideUp { from { transform:translateY(100%) } to { transform:translateY(0) } }
`;


// ── Graph event wirer — only mounts when user is logged in ────────
function GraphWirer() {
  const { handleEvent } = useContextGraph();
  useEffect(() => {
    const GRAPH_EVENTS = ["budget.expense.logged","budget.savings.goal.created","budget.threshold.hit","thrive.mood.logged","thrive.sleep.logged","trips.trip.created","plan.task.created","plan.task.completed","calendar.synced"];
    const unsub = bus.subscribe("*", async (event: any) => {
      if (!GRAPH_EVENTS.includes(event.type)) return;
      try { await handleEvent({ type: event.type, source: event.source, userId: event.userId, payload: event.payload as Record<string, unknown>, timestamp: new Date(event.timestamp).toISOString() }); } catch (e) { console.warn("[GraphWirer] event failed:", e); }
    });
    return unsub;
  }, [handleEvent]);
  return null;
}

export default function App() {
  const { screen, setScreen, setUser, setAuthChecked, setProfile, setShowUpgrade, setIsOnline, activeTab } = useStore();
  // Auth listener
  useEffect(() => {
    // Capture a pending partner invite before auth redirects (migration Step 1)
    const inviteToken = new URLSearchParams(window.location.search).get("invite");
    if (inviteToken) sessionStorage.setItem("hn_invite", inviteToken);
    getRedirectResult(auth).catch(() => {});
    // Safety timeout — never stay on loading screen forever
    const loadingTimeout = setTimeout(() => {
      const s = useStore.getState();
      if (s.screen === "loading") s.setScreen("login");
    }, 5000);
    const unsub = onAuthStateChanged(auth, async (u) => {
      clearTimeout(loadingTimeout);
      if (u) {
        // Shared-device guard: different account than last time → wipe
        // non-uid-scoped local caches (briefings etc.) before anything loads.
        try {
          const last = localStorage.getItem("hn_last_uid");
          if (last && last !== u.uid) {
            const { db: localDb } = await import("./core/db");
            await localDb.clearAllLocal();
            localStorage.removeItem("hn_getstarted_done");
          }
          localStorage.setItem("hn_last_uid", u.uid);
        } catch { /* non-fatal */ }
        setUser({ uid: u.uid, email: u.email || "", displayName: u.displayName });
        await bus.publish("auth.user.signed_in", { uid: u.uid }, { userId: u.uid, source: "app" });
        // ── Household identity (migration Step 1) ──
        // Accept any pending invite, then resolve + provision the household so
        // getHouseholdId() is populated before household-scoped data loads.
        try {
          const pendingInvite = sessionStorage.getItem("hn_invite");
          if (pendingInvite) {
            await acceptInvite(pendingInvite, u.uid);
            sessionStorage.removeItem("hn_invite");
            window.history.replaceState({}, "", window.location.pathname);
          }
          await bootstrapHousehold(u.uid);
          // One-time V1→V2 memory migration (migration Step 4)
          import("./core/memoryServiceV2").then(m => m.migrateV1MemoriesToV2(u.uid)).catch(() => {});
        } catch (e) {
          console.warn("[App] household bootstrap failed (non-fatal):", e);
        }
        // Load profile from Firebase into store
        let profileData: any = null;
        try {
          profileData = await loadData(u.uid, "profile");
          if (profileData) setProfile(profileData as any);
        } catch(e) {
          console.warn("[App] profile load failed:", e);
        }
        // Pro subscription status (written by the Stripe webhook)
        loadData(u.uid, "subscription").then(sub => {
          if (sub?.status === "active") useStore.getState().setIsPro(true);
        }).catch(() => {});
        // Wire up cross-module connectivity
        initConnectivity(u.uid);
        connectIntelligenceLayer(u.uid);
        // Wave 1: background-refresh all connected sources so the briefing
        // never reasons over stale data (previously only synced on the
        // Calendar screen).
        import("./core/connectorSync").then(m => m.syncAllConnectors(u.uid)).catch(() => {});
        // Native push: register this device for FCM (no-op on web). Fire-and-forget.
        import("./core/pushNotifications").then(m => m.registerPush(u.uid)).catch(() => {});
        setScreen(isOnboarded(profileData) ? "app" : "onboarding");
      } else {
        setUser(null);
        setScreen("login");
      }
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  // Handle OAuth callbacks
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("calendar_connected") === "google") {
      window.history.replaceState({}, "", window.location.pathname);
      // Small delay to let app load then show success
      setTimeout(() => {
        import("react-hot-toast").then(({ default: toast }) => toast.success("Google Calendar connected ✓"));
      }, 1500);
    }
    if (params.get("upgraded") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      // Don't celebrate until the webhook has actually confirmed the sub
      import("react-hot-toast").then(({ default: toast }) => toast("Finishing your upgrade...", { icon: "✦" }));
      // Webhook may land a moment after redirect — re-check shortly
      setTimeout(() => {
        const u = useStore.getState().user;
        if (u?.uid) loadData(u.uid, "subscription").then(sub => {
          if (sub?.status === "active") {
            useStore.getState().setIsPro(true);
            import("react-hot-toast").then(({ default: toast }) => toast.success("Welcome to HerNest Pro ✦"));
          }
        }).catch(() => {});
      }, 4000);
    }
    if (params.get("upgrade_cancelled") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("calendar_error")) {
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => {
        import("react-hot-toast").then(({ default: toast }) => toast.error("Calendar connection failed — try again"));
      }, 1500);
    }
  }, []);

  // Online/offline
  useEffect(() => {
    const online  = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online",  online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);

  // AI limit
  useEffect(() => {
    const handler = () => setShowUpgrade(true);
    window.addEventListener("hn_limit_reached", handler);
    return () => window.removeEventListener("hn_limit_reached", handler);
  }, []);


  if (screen === "loading") {
    return (
      <div style={{ height: "100svh", display: "flex", alignItems: "center", justifyContent: "center", background: T.esp }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: 40, color: T.gold, fontWeight: 400 }}>HerNest</h1>
          <p style={{ fontFamily: F.sans, fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 8 }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (screen === "login") return (
    <>
      <style>{globalStyles}</style>
      <LoginScreen />
    </>
  );

  if (screen === "onboarding") return (
    <>
      <style>{globalStyles}</style>
      <OnboardingScreen />
    </>
  );

  const renderScreen = () => {
    switch (activeTab) {
      case "home":     return <EB name="Home"><HomeScreen /></EB>;
      case "cleo":     return <EB name="Cleo"><CleoScreen /></EB>;
      case "plan":     return <EB name="Plan"><PlanScreen /></EB>;
      case "budget":   return <EB name="Budget"><BudgetScreen /></EB>;
      case "briefing": return <EB name="Briefing"><BriefingScreen /></EB>;
      case "thrive":   return <EB name="Thrive"><ThriveScreen /></EB>;
      case "style":    return <EB name="Style"><StyleScreen /></EB>;
      case "trips":    return <EB name="Trips"><TripsScreen /></EB>;
      case "circle":   return <EB name="Circle"><CircleScreen /></EB>;
      case "calendar": return <EB name="Calendar"><CalendarScreen /></EB>;
      case "memory":   return <EB name="Memory"><MemoryScreen /></EB>;
      case "connections": return <EB name="Connections"><ConnectionsScreen /></EB>;
      case "profile":  return <EB name="Profile"><ProfileScreen /></EB>;
      case "family":   return <EB name="Family"><FamilyScreen /></EB>;
      case "settings": return <EB name="Settings"><SettingsScreen /></EB>;
      case "upgrade":  return <EB name="Upgrade"><UpgradeScreen /></EB>;
      default:         return <EB name="Home"><HomeScreen /></EB>;
    }
  };

  // Graph event wiring moved to GraphWirer component


  return (
    <ErrorBoundary>
      <style>{globalStyles}</style>
      <BrowserRouter>
        <div style={{ maxWidth: 430, margin: "0 auto", minHeight: "100svh", background: T.cream, position: "relative", paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div style={{ padding: "16px 16px calc(160px + env(safe-area-inset-bottom, 0px))", animation: "fadeUp .3s ease both" }}>
            <React.Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"60vh"}}><div style={{width:24,height:24,borderRadius:"50%",border:"2px solid #C9A96130",borderTop:"2px solid #C9A961",animation:"spin 0.8s linear infinite"}}/></div>}>
              {renderScreen()}
            </React.Suspense>
          </div>
          <GraphWirer />
          <CleoMini />
          <TabBar />
          <Toaster position="bottom-center" toastOptions={{ style: { fontFamily: F.sans, fontSize: 13, background: T.esp, color: "#fff", borderRadius: 20, padding: "10px 18px" } }} />
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
