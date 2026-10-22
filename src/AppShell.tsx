// ─── App shell ─────────────────────────────────────────────────────
// The signed-in layout: the current screen, the tab bar and toasts.
// Split out of App.tsx so the design preview renders the same layout.
import React from "react";
import { Toaster } from "react-hot-toast";
import { useStore } from "./core/store";
import { ErrorBoundary } from "./shared/components/ErrorBoundary";
import { Skeleton } from "./shared/components";
import { F, T, SHADOWS } from "./config/theme";
import { TabBar } from "./shared/components/TabBar";
import { CrisisSheet } from "./shared/components/CrisisSheet";
import { isSubScreen, tabFor, TAB_LABEL } from "./shared/components/tabParents";
import { setPageTab } from "./shared/appearance";
import { CloudOff } from "lucide-react";
// Offline: a calm strip pinned under the status bar. Changes are kept on
// this phone and sent when the connection returns (Firestore's offline
// cache and the retry queue), so the copy says exactly that.
function OfflineBanner() {
  const online = useStore(s => s.isOnline);
  if (online) return null;
  return (
    <div role="status" style={{
      position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 6px)", left: "50%", transform: "translateX(-50%)",
      width: "calc(100% - 24px)", maxWidth: 406, zIndex: 110, display: "flex", alignItems: "center", gap: 10,
      padding: "10px 14px", borderRadius: 16, background: T.frost, border: `1px solid ${T.glass}`, boxShadow: SHADOWS.md,
      backdropFilter: "blur(20px) saturate(170%)", WebkitBackdropFilter: "blur(20px) saturate(170%)",
      fontFamily: F.sans, fontSize: 14, color: T.text,
    }}>
      <CloudOff size={18} color={T.text2} strokeWidth={1.9} aria-hidden="true" />
      <span>You're offline. Changes stay on this phone and sync when you're back online.</span>
    </div>
  );
}

// While a tab's code loads: the shape of a page, shimmering.
function ScreenSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton width={120} height={13} style={{ margin: "8px 0 10px" }} />
      <Skeleton width="55%" height={30} radius={10} style={{ marginBottom: 24 }} />
      <Skeleton height={190} radius={24} style={{ marginBottom: 12 }} />
      <Skeleton height={120} radius={24} style={{ marginBottom: 12 }} />
      <Skeleton height={120} radius={24} />
    </div>
  );
}
const EB = ({ name, children }: { name: string; children: React.ReactNode }) => <ErrorBoundary name={name}>{children}</ErrorBoundary>;

// Screens
import { TodayScreen }      from "./modules/home/TodayScreen";
import { lastMeSegment }    from "./modules/me/meSegment";
import { CleoScreen }       from "./modules/cleo/CleoScreen";
const PlanScreen = React.lazy(() => import("./modules/plan/PlanScreen").then(m => ({ default: m.PlanScreen })));
// The "budget" tab is now Bills (Oct 2026 redesign). The old Budget screens
// were deleted in simplify phase 3; their saved data is untouched.
const BillsScreen = React.lazy(() => import("./modules/bills/BillsScreen").then(m => ({ default: m.BillsScreen })));
const BriefingScreen = React.lazy(() => import("./modules/briefing/BriefingScreen").then(m => ({ default: m.BriefingScreen })));
// Me tab: Wellness (Thrive) and Style, shown as they are.
const MeScreen = React.lazy(() => import("./modules/me/MeScreen").then(m => ({ default: m.MeScreen })));
const TripsScreen = React.lazy(() => import("./modules/trips/TripsScreen").then(m => ({ default: m.TripsScreen })));
const CircleScreen = React.lazy(() => import("./modules/circle/CircleScreen").then(m => ({ default: m.CircleScreen })));
const FamilyScreen = React.lazy(() => import("./modules/family/FamilyScreen").then(m => ({ default: m.FamilyScreen })));
const ProfileScreen = React.lazy(() => import("./modules/profile/ProfileScreen").then(m => ({ default: m.ProfileScreen })));
const CalendarScreen = React.lazy(() => import("./modules/calendar/CalendarScreen").then(m => ({ default: m.CalendarScreen })));
const MemoryScreen = React.lazy(() => import("./modules/memory/MemoryScreen").then(m => ({ default: m.MemoryScreen })));
const ConnectionsScreen = React.lazy(() => import("./modules/connections/ConnectionsScreen").then(m => ({ default: m.ConnectionsScreen })));
const SettingsScreen = React.lazy(() => import("./modules/settings/SettingsScreen").then(m => ({ default: m.SettingsScreen })));
const UpgradeScreen = React.lazy(() => import("./modules/upgrade/UpgradeScreen").then(m => ({ default: m.UpgradeScreen })));

export function AppShell() {
  const activeTab = useStore(s => s.activeTab);
  const setActiveTab = useStore(s => s.setActiveTab);

  // Each tab has its own light behind the page (see TAB_ATMOS in theme.ts).
  const pageTab = ({ home: "today", budget: "bills" } as Record<string, string>)[tabFor(activeTab)] ?? tabFor(activeTab);
  React.useEffect(() => { setPageTab(pageTab); }, [pageTab]);

  // Tab ids are kept from the old layout so notifications and links still
  // land: "home" is Today, "budget" is Bills, "thrive"/"style" open Me.
  const renderScreen = () => {
    switch (activeTab) {
      case "home":     return <EB name="Today"><TodayScreen /></EB>;
      case "cleo":     return <EB name="Cleo"><CleoScreen /></EB>;
      case "plan":     return <EB name="Plan"><PlanScreen /></EB>;
      case "budget":   return <EB name="Bills"><BillsScreen /></EB>;
      case "me":       return <EB name="Me"><MeScreen segment={lastMeSegment()} /></EB>;
      case "thrive":   return <EB name="Me"><MeScreen segment="wellness" /></EB>;
      case "style":    return <EB name="Me"><MeScreen segment="style" /></EB>;
      case "briefing": return <EB name="Briefing"><BriefingScreen /></EB>;
      case "trips":    return <EB name="Trips"><TripsScreen /></EB>;
      case "circle":   return <EB name="Circle"><CircleScreen /></EB>;
      case "calendar": return <EB name="Calendar"><CalendarScreen /></EB>;
      case "memory":   return <EB name="Memory"><MemoryScreen /></EB>;
      case "connections": return <EB name="Connections"><ConnectionsScreen /></EB>;
      case "profile":  return <EB name="Profile"><ProfileScreen /></EB>;
      case "family":   return <EB name="Family"><FamilyScreen /></EB>;
      case "settings": return <EB name="Settings"><SettingsScreen initialSection="account" /></EB>;
      case "privacy":  return <EB name="Settings"><SettingsScreen key="privacy" initialSection="privacy" /></EB>;
      // Go Pro is parked: the screen stays, but nothing in the app links to it.
      case "upgrade":  return <EB name="Upgrade"><UpgradeScreen /></EB>;
      default:         return <EB name="Today"><TodayScreen /></EB>;
    }
  };

  // Screens opened from a tab (You menu, See full briefing, ...) get a way back.
  const backTo = isSubScreen(activeTab) ? tabFor(activeTab) : null;



  return (
    <div style={{ maxWidth: 430, margin: "0 auto", minHeight: "100svh", position: "relative", paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div style={{ padding: "16px 20px calc(120px + env(safe-area-inset-bottom, 0px))", animation: "fadeUp .3s ease both" }}>
        {backTo && (
          <button onClick={() => setActiveTab(backTo)} style={{ background: "none", border: "none", padding: "4px 0", marginBottom: 4, fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.goldText, cursor: "pointer", minHeight: 44 }}>
            ‹ {TAB_LABEL[backTo] || "Back"}
          </button>
        )}
        <React.Suspense fallback={<ScreenSkeleton />}>
          {renderScreen()}
        </React.Suspense>
      </div>
      <OfflineBanner />
      <TabBar />
      <CrisisSheet />
      <Toaster position="bottom-center" containerStyle={{ bottom: "calc(max(env(safe-area-inset-bottom, 0px), 10px) + 84px)" }} toastOptions={{ style: { fontFamily: F.sans, fontSize: 15, fontWeight: 600, background: T.text, color: T.onAction, borderRadius: 16, padding: "12px 16px" } }} />
    </div>
  );
}
