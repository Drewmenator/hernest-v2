import React, { useEffect, useState } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { loadData } from "../../core/firebase";
import { Spinner } from "../../shared/components";
import { computeHouseholdScores, type AttentionSeverity } from "../../core/intelligence/householdScores";
import { SEV_COLOR, SEV_RANK, SOURCE_TAB, cc_str } from "./homeShared";
import { onEnterSpace } from "../../shared/utils/a11y";

// ── Today's Intelligence Card (unchanged) ─────────────────────────
// ── Phase 4: Household Intelligence scores + Risk Radar ──────────

// ── Phase 6: Command Center — the unified "what needs you today" ──
// Merges the Risk Radar (bills, tasks, school, trips, sleep) and proactive
// alerts into ONE ranked queue at the top of home. Old budget alerts and the
// stored "recommended actions" are skipped: both came from the Budget screen,
// which was replaced by Bills in Oct 2026, so they can no longer update.
interface CCItem { id: string; severity: AttentionSeverity; label: string; detail: string; tab: string; }

export function CommandCenterCard() {
  const { user, profile } = useStore();
  const setActiveTab = useStore(s => s.setActiveTab);
  const [items, setItems] = useState<CCItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    // Safety ceiling: never leave the Command Center spinning on a hung read
    const ceiling = setTimeout(() => { if (alive) setLoading(false); }, 12_000);
    (async () => {
      const out: CCItem[] = [];
      try {
        const { buildAppContext } = await import("../../core/contextBuilder");
        const appCtx = await buildAppContext(user.uid, (profile ?? {}) as unknown as Record<string, unknown>);
        for (const a of computeHouseholdScores(appCtx).attention) {
          out.push({ id: `radar_${a.id}`, severity: a.severity, label: cc_str(a.title), detail: cc_str(a.suggestedAction), tab: SOURCE_TAB[a.source] || "plan" });
        }
      } catch (e) { console.warn("[CommandCenter] radar failed:", e); }
      try {
        const alerts = ((await loadData(user.uid, "alerts"))?.alerts as any[]) || [];
        // Relationship nudges are gentle by design — surface at most one, as info.
        let circleShown = false;
        for (const al of alerts.filter(a => cc_str(a?.type) !== "budget").slice(0, 6)) {
          const isCircle = cc_str(al?.type) === "circle";
          if (isCircle && circleShown) continue;
          if (isCircle) circleShown = true;
          const sev: AttentionSeverity = isCircle ? "info" : al?.severity === "critical" ? "alert" : al?.severity === "warning" ? "watch" : "info";
          let label = cc_str(al?.message);
          // Sanitize legacy stored copies of the old guilt-y circle wording
          const legacy = label.match(/^(.+?) — (\d+) days since last contact$/);
          if (legacy) label = Number(legacy[2]) >= 999 ? `Say hi to ${legacy[1]} when you have a moment ✦` : `${legacy[1]} might love to hear from you — it's been ${legacy[2]} days`;
          if (label) out.push({ id: `alert_${cc_str(al?.type)}_${label.slice(0, 12)}`, severity: sev, label, detail: "", tab: SOURCE_TAB[cc_str(al?.type)] || "home" });
        }
      } catch { /* non-fatal */ }
      // Dedup by label, rank by severity, keep the top few.
      const seen = new Set<string>();
      const ranked = out
        .filter(i => i.label && !seen.has(i.label.toLowerCase()) && seen.add(i.label.toLowerCase()))
        .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])
        .slice(0, 5);
      if (alive) { setItems(ranked); setLoading(false); }
      clearTimeout(ceiling);
    })();
    return () => { alive = false; clearTimeout(ceiling); };
  }, [user?.uid]);

  if (loading) return (
    <div style={{ background: T.esp, borderRadius: 20, padding: "18px", marginBottom: 12, display: "flex", justifyContent: "center" }}>
      <Spinner size={20} />
    </div>
  );

  const allClear = items.length === 0;

  return (
    <div style={{ background: T.esp, borderRadius: 20, padding: "18px", marginBottom: 12, color: "#fff" }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", margin: "0 0 6px" }}>COMMAND CENTER</p>
      <p style={{ fontFamily: F.serif, fontSize: 22, fontStyle: "italic", color: "#fff", margin: "0 0 14px", lineHeight: 1.15 }}>
        {allClear ? "You're all caught up ✦" : `${items.length} thing${items.length > 1 ? "s" : ""} need${items.length > 1 ? "" : "s"} you today`}
      </p>
      {allClear ? (
        <p style={{ fontFamily: F.sans, fontSize: 13, color: "rgba(255,255,255,0.7)", margin: 0, lineHeight: 1.5 }}>Nothing pressing across your bills, schedule, tasks or people. I'll flag anything that needs a decision.</p>
      ) : (
        items.map(it => {
          const color = SEV_COLOR[it.severity];
          return (
            <div key={it.id} onClick={() => setActiveTab(it.tab)}
              role="button" tabIndex={0} onKeyDown={onEnterSpace} aria-label={it.label}
              style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "10px 12px", background: "rgba(255,255,255,0.06)", borderRadius: 12, marginBottom: 7, cursor: "pointer", borderLeft: `3px solid ${color}` }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 5 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: F.sans, fontSize: 13.5, fontWeight: 700, color: "#fff", margin: "0 0 1px" }}>{it.label}</p>
                {it.detail && <p style={{ fontFamily: F.sans, fontSize: 12, color: "rgba(255,255,255,0.7)", margin: 0, lineHeight: 1.4 }}>{it.detail}</p>}
              </div>
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 16, flexShrink: 0 }}>›</span>
            </div>
          );
        })
      )}
    </div>
  );
}

