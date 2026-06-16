// ─── Connections (Phase 5 — Connectors hub) ─────────────────────
// One place to connect the external services that feed the household OS.
// Architectural principle (per the 6-phase plan): connectors are just more
// EVENT PUBLISHERS — each normalizes its data into the same household event
// envelope. The calendar connectors (Google/Apple/Outlook) are live today and
// already publish `calendar.synced`; the rest are scaffolded here so wiring a
// new wave is uniform once its OAuth app exists.
import React, { useState, useEffect } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { PageTitle } from "../../shared/components";
import toast from "react-hot-toast";

type ConnectorKind = "oauth" | "deeplink" | "soon";
type ConnectorStatus = "connected" | "available" | "soon";

interface Connector {
  id: string;
  name: string;
  category: "Calendar" | "Email" | "School" | "Finance" | "Wellness";
  blurb: string;
  icon: string;
  kind: ConnectorKind;
  connectUrl?: string;     // oauth: redirect target
  tab?: string;            // deeplink: in-app screen that owns the connect flow
  statusDoc?: string;      // integrations/{doc} to check for a live connection
  statusField?: string;    // field that signals "connected"
}

const CONNECTORS: Connector[] = [
  { id: "google_calendar", name: "Google Calendar", category: "Calendar", blurb: "Events flow into your household calendar", icon: "◈", kind: "oauth", connectUrl: "/api/auth/google", statusDoc: "google_calendar", statusField: "accessToken" },
  { id: "outlook_calendar", name: "Outlook Calendar", category: "Calendar", blurb: "Sync your Microsoft calendar", icon: "◈", kind: "oauth", connectUrl: "/api/auth/outlook", statusDoc: "outlook_calendar", statusField: "accessToken" },
  { id: "apple_calendar", name: "Apple Calendar", category: "Calendar", blurb: "Connect via iCloud in the Calendar screen", icon: "✦", kind: "deeplink", tab: "calendar", statusDoc: "apple_calendar", statusField: "email" },
  { id: "gmail", name: "Gmail", category: "Email", blurb: "Turn key emails into tasks & events", icon: "✉", kind: "soon" },
  { id: "google_classroom", name: "Google Classroom", category: "School", blurb: "Assignments & school deadlines", icon: "◷", kind: "soon" },
  { id: "canvas", name: "Canvas", category: "School", blurb: "Coursework and due dates", icon: "◷", kind: "soon" },
  { id: "plaid", name: "Bank accounts", category: "Finance", blurb: "Live balances & transactions via Plaid", icon: "◎", kind: "soon" },
  { id: "apple_health", name: "Apple Health", category: "Wellness", blurb: "Sleep & activity for resilience scoring", icon: "♡", kind: "soon" },
];

const CATEGORIES: Connector["category"][] = ["Calendar", "Email", "School", "Finance", "Wellness"];

export function ConnectionsScreen() {
  const { user } = useStore();
  const setActiveTab = useStore(s => s.setActiveTab);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    (async () => {
      try {
        const { db } = await import("../../core/firebase");
        const { doc, getDoc } = await import("firebase/firestore");
        const checks = CONNECTORS.filter(c => c.statusDoc);
        const results = await Promise.all(checks.map(async c => {
          try {
            const snap = await getDoc(doc(db, "users", user.uid, "integrations", c.statusDoc!));
            return [c.id, snap.exists() && !!snap.data()?.[c.statusField || "accessToken"]] as const;
          } catch { return [c.id, false] as const; }
        }));
        if (alive) setConnected(Object.fromEntries(results));
      } catch (e) {
        console.warn("[Connections] status check failed:", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.uid]);

  const statusOf = (c: Connector): ConnectorStatus =>
    connected[c.id] ? "connected" : c.kind === "soon" ? "soon" : "available";

  const onConnect = (c: Connector) => {
    if (c.kind === "oauth" && c.connectUrl) {
      window.location.href = `${c.connectUrl}?uid=${user?.uid}`;
    } else if (c.kind === "deeplink" && c.tab) {
      setActiveTab(c.tab);
    } else {
      toast("Coming in a future wave ✦", { icon: "🔌" });
    }
  };

  const liveCount = Object.values(connected).filter(Boolean).length;

  return (
    <div style={{ paddingBottom: 80 }}>
      <PageTitle eyebrow="YOUR INTEGRATIONS" title="Connections" />
      <p style={{ fontFamily: F.sans, fontSize: 13, color: T.taupe, margin: "4px 0 18px", lineHeight: 1.6 }}>
        Connect the services that feed your household. Each one becomes a source Cleo can see and reason about.
        {liveCount > 0 && <> <span style={{ color: T.sage, fontWeight: 700 }}>{liveCount} connected.</span></>}
      </p>

      {CATEGORIES.map(cat => {
        const items = CONNECTORS.filter(c => c.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} style={{ marginBottom: 20 }}>
            <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: "0 0 10px" }}>{cat}</p>
            {items.map(c => {
              const status = loading ? "available" : statusOf(c);
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: `1.5px solid ${status === "connected" ? `${T.sage}40` : T.linen}`, borderRadius: 16, padding: "13px 14px", marginBottom: 8 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: status === "connected" ? `${T.sage}14` : `${T.taupe}10`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: status === "connected" ? T.sage : T.stone, flexShrink: 0 }}>{c.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 700, color: T.esp, margin: "0 0 2px" }}>{c.name}</p>
                    <p style={{ fontFamily: F.sans, fontSize: 11.5, color: T.taupe, margin: 0, lineHeight: 1.4 }}>{c.blurb}</p>
                  </div>
                  {status === "connected" ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: F.sans, fontSize: 12, fontWeight: 700, color: T.sage, flexShrink: 0 }}>✓ On</span>
                  ) : status === "soon" ? (
                    <span style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color: T.stone, background: `${T.taupe}12`, padding: "5px 10px", borderRadius: 10, flexShrink: 0 }}>Soon</span>
                  ) : (
                    <button onClick={() => onConnect(c)} style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 700, color: "#fff", background: T.esp, border: "none", borderRadius: 10, padding: "8px 16px", cursor: "pointer", flexShrink: 0, minHeight: 36 }}>Connect</button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      <p style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe, margin: "8px 0 0", lineHeight: 1.6, fontStyle: "italic", textAlign: "center" }}>
        More connectors (Gmail, School, Bank feeds, Health) arrive in waves. Each plugs into the same household event stream — no separate silos.
      </p>
    </div>
  );
}

export default ConnectionsScreen;
