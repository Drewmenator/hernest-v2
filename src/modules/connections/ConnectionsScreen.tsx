// ─── Connections (Waves 1+2 — Connectors hub with sync health) ────
// One place to see everything feeding the household OS. Each connector is
// an event publisher into the same household stream. Shows real freshness
// (last synced, item counts, errors) from users/{uid}/integrations/{doc},
// written server-side on every sync.
import React, { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { auth } from "../../core/firebase";
import { PageTitle } from "../../shared/components";
import { connectOAuth, getConnectorHealth, syncAllConnectors, type ConnectorHealth } from "../../core/connectorSync";
import toast from "react-hot-toast";

type ConnectorKind = "oauth" | "deeplink" | "soon" | "health";

interface Connector {
  id: string;
  name: string;
  category: "Calendar" | "Email" | "School" | "Finance" | "Wellness";
  blurb: string;
  icon: string;
  kind: ConnectorKind;
  oauthProvider?: "google" | "gmail" | "outlook" | "oura";
  tab?: string;
  statusDoc?: string;
  statusField?: string;
}

const CONNECTORS: Connector[] = [
  { id: "google_calendar", name: "Google Calendar", category: "Calendar", blurb: "Events flow into your household calendar", icon: "◈", kind: "oauth", oauthProvider: "google", statusDoc: "google_calendar", statusField: "accessToken" },
  { id: "outlook_calendar", name: "Outlook Calendar", category: "Calendar", blurb: "Sync your Microsoft calendar", icon: "◈", kind: "oauth", oauthProvider: "outlook", statusDoc: "outlook_calendar", statusField: "accessToken" },
  { id: "apple_calendar", name: "Apple Calendar", category: "Calendar", blurb: "Connect via iCloud in the Calendar screen", icon: "✦", kind: "deeplink", tab: "calendar", statusDoc: "apple_calendar", statusField: "email" },
  { id: "gmail", name: "Gmail", category: "Email", blurb: "Receipts → budget · school & travel emails → calendar", icon: "✉", kind: "oauth", oauthProvider: "gmail", statusDoc: "gmail", statusField: "accessToken" },
  { id: "plaid", name: "Bank accounts", category: "Finance", blurb: "Live transactions, auto-categorized — connect in Budget", icon: "◎", kind: "deeplink", tab: "budget", statusDoc: "plaid", statusField: "connected" },
  { id: "oura", name: "Oura Ring", category: "Wellness", blurb: "Sleep, readiness & activity → your wellness score", icon: "○", kind: "oauth", oauthProvider: "oura", statusDoc: "oura", statusField: "accessToken" },
  { id: "apple_health", name: "Apple Health", category: "Wellness", blurb: "Send sleep & steps via an iOS Shortcut", icon: "♡", kind: "health", statusDoc: "apple_health", statusField: "token" },
];

// Manual data sources already built into other screens — surfaced here so this
// screen is the complete inventory of what feeds Cleo.
const MANUAL_SOURCES = [
  { id: "csv", name: "Bank CSV import", blurb: "Upload statements into the budget", icon: "◎", tab: "budget" },
  { id: "receipts", name: "Receipt scanner", blurb: "Snap receipts, Cleo logs the expense", icon: "◉", tab: "budget" },
  { id: "newsletter", name: "School newsletter paste", blurb: "Paste any newsletter, events extracted per child", icon: "◆", tab: "calendar" },
];

const CATEGORIES: Connector["category"][] = ["Calendar", "Email", "School", "Finance", "Wellness"];

function timeAgo(ts?: number): string {
  if (!ts) return "";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ConnectionsScreen() {
  const { user } = useStore();
  const setActiveTab = useStore(s => s.setActiveTab);
  const [health, setHealth] = useState<Record<string, ConnectorHealth>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [scanningGmail, setScanningGmail] = useState(false);
  const [healthSetup, setHealthSetup] = useState<{ token: string; endpoint: string } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const loadHealth = async (uid: string) => {
    const checks = CONNECTORS.filter(c => c.statusDoc);
    const results = await Promise.all(checks.map(async c =>
      [c.id, await getConnectorHealth(uid, c.statusDoc!, c.statusField || "accessToken")] as const
    ));
    setHealth(Object.fromEntries(results));
  };

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    (async () => {
      try { await loadHealth(user.uid); } catch (e) { console.warn("[Connections] health check failed:", e); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [user?.uid]);

  const onConnect = async (c: Connector) => {
    if (c.kind === "oauth" && c.oauthProvider) {
      const ok = await connectOAuth(c.oauthProvider);
      if (!ok) toast.error("Couldn't start the connection — try again");
      // On native, connectOAuth resolves after the in-app sheet closes — refresh
      // so a just-completed connection shows immediately. (On web the page has
      // already navigated away, so this only runs in the native flow.)
      else if (user?.uid) { await loadHealth(user.uid); syncAllConnectors(user.uid).catch(() => {}); }
    } else if (c.kind === "deeplink" && c.tab) {
      setActiveTab(c.tab);
    } else if (c.kind === "health") {
      await setupHealth();
    } else {
      toast("Coming in a future wave ✦", { icon: "🔌" });
    }
  };

  const setupHealth = async () => {
    if (!user?.uid || healthLoading) return;
    setHealthLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/connectors?action=health_token", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.token) setHealthSetup({ token: data.token, endpoint: data.endpoint });
      else toast.error("Couldn't set up — try again");
    } catch {
      toast.error("Couldn't set up — try again");
    }
    setHealthLoading(false);
  };

  const onSyncNow = async () => {
    if (!user?.uid || syncing) return;
    setSyncing(true);
    try {
      await syncAllConnectors(user.uid);
      await loadHealth(user.uid);
      toast.success("Sources refreshed ✓");
    } catch {
      toast.error("Sync hit a snag — try again");
    }
    setSyncing(false);
  };

  const onScanGmail = async () => {
    if (!user?.uid || scanningGmail) return;
    setScanningGmail(true);
    try {
      const { scanGmail } = await import("../../core/gmailIntelligence");
      const r = await scanGmail(user.uid);
      if (r.error === "reauth_required") toast.error("Gmail needs reconnecting");
      else if (r.error) toast.error("Scan failed — try again");
      else if (r.eventsAdded || r.receiptsFound) toast.success(`Found ${r.eventsAdded} event${r.eventsAdded === 1 ? "" : "s"} · ${r.receiptsFound} receipt${r.receiptsFound === 1 ? "" : "s"} ✓`);
      else toast(`Scanned ${r.scanned} emails — nothing new`, { icon: "✉" });
      await loadHealth(user.uid);
    } catch {
      toast.error("Scan failed — try again");
    }
    setScanningGmail(false);
  };

  const liveCount = Object.values(health).filter(h => h.connected).length;

  return (
    <div style={{ paddingBottom: 80 }}>
      <PageTitle eyebrow="YOUR INTEGRATIONS" title="Connections" />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "4px 0 18px" }}>
        <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: 0, lineHeight: 1.6, flex: 1 }}>
          Connect the services that feed your household. Each becomes a source Cleo can see and reason about.
          {liveCount > 0 && <> <span style={{ color: T.sage, fontWeight: 700 }}>{liveCount} connected.</span></>}
        </p>
        {liveCount > 0 && (
          <button onClick={onSyncNow} disabled={syncing}
            style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: T.esp, background: "none", border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "7px 12px", cursor: "pointer", flexShrink: 0, minHeight: 32 }}>
            {syncing ? "Syncing..." : "↺ Sync now"}
          </button>
        )}
      </div>

      {CATEGORIES.map(cat => {
        const items = CONNECTORS.filter(c => c.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} style={{ marginBottom: 20 }}>
            <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" }}>{cat}</p>
            {items.map(c => {
              const h = health[c.id];
              const isConnected = !loading && !!h?.connected;
              const hasError = isConnected && !!h?.lastError;
              const border = hasError ? `${T.blush}50` : isConnected ? `${T.sage}40` : T.linen;
              return (
                <div key={c.id} style={{ background: "#fff", border: `1.5px solid ${border}`, borderRadius: 16, padding: "13px 14px", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: isConnected ? `${T.sage}14` : `${T.taupe}10`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: isConnected ? T.sage : T.stone, flexShrink: 0 }}>{c.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 700, color: T.esp, margin: "0 0 2px" }}>{c.name}</p>
                      <p style={{ fontFamily: F.sans, fontSize: 11.5, color: T.taupe, margin: 0, lineHeight: 1.4 }}>
                        {hasError
                          ? <span style={{ color: T.blush }}>Needs reconnecting — token expired</span>
                          : isConnected && h?.lastSyncedAt
                          ? <>✓ {h.itemCount ?? 0} item{(h.itemCount ?? 0) === 1 ? "" : "s"} · synced {timeAgo(h.lastSyncedAt)}</>
                          : c.blurb}
                      </p>
                    </div>
                    {c.kind === "health" ? (
                      <button onClick={() => onConnect(c)} disabled={healthLoading} style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 700, color: isConnected ? T.esp : "#fff", background: isConnected ? "none" : T.esp, border: isConnected ? `1.5px solid ${T.linen}` : "none", borderRadius: 10, padding: "8px 16px", cursor: "pointer", flexShrink: 0, minHeight: 36 }}>
                        {healthLoading ? "..." : isConnected ? "Setup" : "Set up"}
                      </button>
                    ) : isConnected && !hasError ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: T.sage, flexShrink: 0 }}>✓ On</span>
                    ) : c.kind === "soon" ? (
                      <span style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color: T.stone, background: `${T.taupe}12`, padding: "5px 10px", borderRadius: 10, flexShrink: 0 }}>Soon</span>
                    ) : (
                      <button onClick={() => onConnect(c)} style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 700, color: "#fff", background: hasError ? T.blush : T.esp, border: "none", borderRadius: 10, padding: "8px 16px", cursor: "pointer", flexShrink: 0, minHeight: 36 }}>
                        {hasError ? "Reconnect" : "Connect"}
                      </button>
                    )}
                  </div>
                  {c.id === "gmail" && isConnected && !hasError && (
                    <button onClick={onScanGmail} disabled={scanningGmail}
                      style={{ width: "100%", marginTop: 10, padding: "10px", background: `${T.gold}12`, border: `1.5px solid ${T.gold}30`, borderRadius: 12, fontFamily: F.sans, fontSize: 12.5, fontWeight: 700, color: T.esp, cursor: "pointer", minHeight: 40 }}>
                      {scanningGmail ? "✦ Cleo is reading your inbox..." : "✦ Scan inbox for receipts & events"}
                    </button>
                  )}
                  {c.id === "apple_health" && healthSetup && (
                    <div style={{ marginTop: 10, padding: "12px 14px", background: T.sand, borderRadius: 12, border: `1px solid ${T.linen}` }}>
                      <p style={{ fontFamily: F.sans, fontSize: 11.5, color: T.esp, margin: "0 0 8px", lineHeight: 1.5, fontWeight: 700 }}>iOS Shortcut setup</p>
                      <ol style={{ fontFamily: F.sans, fontSize: 11.5, color: T.taupe, margin: "0 0 10px", paddingLeft: 16, lineHeight: 1.7 }}>
                        <li>Open the <strong>Shortcuts</strong> app → new Automation → <strong>Time of Day</strong> (e.g. 8am daily)</li>
                        <li>Add <strong>Find Health Samples</strong> → Sleep → today; repeat for Steps</li>
                        <li>Add <strong>Get Contents of URL</strong> — method POST, JSON body below</li>
                      </ol>
                      <div style={{ background: "#fff", border: `1px solid ${T.linen}`, borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
                        <p style={{ fontFamily: "monospace", fontSize: 10, color: T.taupe, margin: "0 0 2px", wordBreak: "break-all" }}>{healthSetup.endpoint}</p>
                      </div>
                      <div style={{ background: "#fff", border: `1px solid ${T.linen}`, borderRadius: 8, padding: "8px 10px" }}>
                        <p style={{ fontFamily: "monospace", fontSize: 10, color: T.esp, margin: 0, wordBreak: "break-all", lineHeight: 1.5 }}>{`{ "token": "${healthSetup.token}", "sleepHours": [Sleep], "steps": [Steps] }`}</p>
                      </div>
                      <button onClick={() => { navigator.clipboard?.writeText(healthSetup.token); toast.success("Token copied ✓"); }}
                        style={{ marginTop: 8, fontFamily: F.sans, fontSize: 11.5, fontWeight: 700, color: T.esp, background: "none", border: `1.5px solid ${T.linen}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>Copy token</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Manual sources — already built, part of the same picture */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" }}>Manual Sources</p>
        {MANUAL_SOURCES.map(s => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: `1.5px solid ${T.linen}`, borderRadius: 16, padding: "13px 14px", marginBottom: 8 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: `${T.gold}12`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: T.gold, flexShrink: 0 }}>{s.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 700, color: T.esp, margin: "0 0 2px" }}>{s.name}</p>
              <p style={{ fontFamily: F.sans, fontSize: 11.5, color: T.taupe, margin: 0, lineHeight: 1.4 }}>{s.blurb}</p>
            </div>
            <button onClick={() => setActiveTab(s.tab)} style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 700, color: T.esp, background: "none", border: `1.5px solid ${T.linen}`, borderRadius: 10, padding: "8px 16px", cursor: "pointer", flexShrink: 0, minHeight: 36 }}>Open</button>
          </div>
        ))}
      </div>

      <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "8px 0 0", lineHeight: 1.6, fontStyle: "italic", textAlign: "center" }}>
        Connected sources refresh automatically when you open HerNest. Bank feeds and school connectors arrive in the next wave.
      </p>
    </div>
  );
}

export default ConnectionsScreen;
