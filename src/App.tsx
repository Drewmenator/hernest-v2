// ─── HerNest V2 App ───────────────────────────────────────────────
import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { onAuthStateChanged, getRedirectResult } from "firebase/auth";
import { auth } from "./core/firebase";
import { loadData } from "./core/firebase";
import { initConnectivity } from "./core/connectivity";
import { connectIntelligenceLayer } from "./core/intelligenceEvents";
import { useStore } from "./core/store";
import { bus } from "./core/events";
import { bootstrapHousehold, acceptInvite } from "./core/householdService";
import { isOnboarded } from "./core/onboarding";
import { ErrorBoundary } from "./shared/components/ErrorBoundary";
import { F, T } from "./config/theme";
import { globalStyles } from "./shared/globalStyles";
import { AppShell } from "./AppShell";
import { LoginScreen }      from "./modules/auth/LoginScreen";
import { OnboardingScreen } from "./modules/onboarding/OnboardingScreen";





export default function App() {
  const { screen, setScreen, setUser, setAuthChecked, setProfile, setIsOnline, activeTab } = useStore();
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
        // Usage tracking (off unless VITE_POSTHOG_KEY is set): the uid only.
        import("./core/analytics").then(m => m.identifyUser(u.uid)).catch(() => {});
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
          // One-time copy of tasks, chores and bills into one record per item
          // (the old list docs stay as a backup). Screens also run it on demand.
          import("./core/householdItems").then(m => m.migrateAllItems(u.uid)).catch(() => {});
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

  // AI limit: a friendly note from the server (household daily limit or the
  // per-minute limit). Fixed toast id so an agent loop can't stack several.
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ code?: string; message?: string }>).detail || {};
      const msg = d.message || (d.code === "burst_limit_reached"
        ? "That's a lot of requests at once. Give Cleo a minute, then try again."
        : "Cleo has done a lot for your family today. She'll be ready to help again tomorrow.");
      import("react-hot-toast").then(({ default: toast }) => toast(msg, { id: "hn_limit", duration: 6000 }));
    };
    window.addEventListener("hn_limit_reached", handler);
    return () => window.removeEventListener("hn_limit_reached", handler);
  }, []);


  // Count which tabs people open, so cut/keep decisions use real numbers.
  // (The "budget" tab id shows the Bills screen; "home" is Today.)
  useEffect(() => {
    if (screen !== "app") return;
    const name = activeTab === "budget" ? "bills" : activeTab === "home" ? "today" : activeTab;
    import("./core/analytics").then(m => m.trackScreen(name)).catch(() => {});
    window.scrollTo(0, 0);
  }, [screen, activeTab]);

  if (screen === "loading") {
    return (
      <div style={{ height: "100svh", display: "flex", alignItems: "center", justifyContent: "center", background: T.bg }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontFamily: F.sans, letterSpacing: "-0.03em", fontSize: 40, color: T.text, fontWeight: 800 }}>HerNest</h1>
          <p style={{ fontFamily: F.sans, fontSize: 14, color: T.text2, marginTop: 8 }}>Loading…</p>
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

  return (
    <ErrorBoundary>
      <style>{globalStyles}</style>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
