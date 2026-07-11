import React, { useEffect, useState } from "react";
import { T, F } from "../../config/theme";
import toast from "react-hot-toast";
import { useStore } from "../../core/store";
import { useAdaptiveUX, filterInsightsForDisplay, getStateBannerProps, getAdaptiveGreeting } from "../../core/household/adaptiveUX";
import { loadData } from "../../core/firebase";
import { db } from "../../core/db";
import { Spinner } from "../../shared/components";
import { createActionsFromInsight, executeRecommendedAction } from "../../core/recommendationActions";
import { CleoSetupScreen } from "../onboarding/OnboardingScreen";
import { buildHouseholdSnapshot, generateHouseholdInsights, getTopInsight, loadHouseholdInsights, saveHouseholdInsights } from "../../core/household";
import { computeHouseholdScores, type HouseholdScores, type ScoreBand, type AttentionSeverity } from "../../core/intelligence/householdScores";
import { formatMoney } from "../../shared/utils/money";
import { onEnterSpace } from "../../shared/utils/a11y";

// ── NEW: Household Pulse Card ─────────────────────────────────────
export function HouseholdPulseCard() {
  const { user, profile, householdSnapshot, householdInsights, setHouseholdSnapshot, setHouseholdInsights, dismissInsight } = useStore();
  const [loading, setLoading] = useState(false);
  const [insightLoading, setInsightLoading] = useState(false);
  const [showCleoSetup, setShowCleoSetup] = useState(false);

  // Load snapshot + insights on mount
  useEffect(() => {
    if (!user?.uid || householdSnapshot) return;
    setLoading(true);
    buildHouseholdSnapshot(user.uid)
      .then(snap => setHouseholdSnapshot(snap))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || householdInsights.length > 0) return;
    loadHouseholdInsights(user.uid).then(ins => {
      if (ins.length > 0) setHouseholdInsights(ins);
    });
  }, [user?.uid]);

  const handleGenerateInsight = async () => {
    if (!user?.uid || !householdSnapshot) return;
    setInsightLoading(true);
    try {
      const insights = await generateHouseholdInsights(householdSnapshot, user.uid, {
        profileName: profile?.name,
        kids: profile?.kids?.map((k: any) => k.name),
      });
      if (insights.length > 0) {
        setHouseholdInsights(insights);
        await saveHouseholdInsights(user.uid, insights);
      }
    } catch (e) {
      console.warn("[Home] insight generation failed:", e);
      toast.error("Couldn't generate insights — try again in a moment");
    }
    setInsightLoading(false);
  };

  if (showCleoSetup) return <CleoSetupScreen onComplete={() => setShowCleoSetup(false)} />;

  const snap = householdSnapshot;
  const adaptiveConfig = useAdaptiveUX(snap);
  const filteredInsights = filterInsightsForDisplay(householdInsights, adaptiveConfig);
  const topInsight = getTopInsight(filteredInsights.length ? filteredInsights : householdInsights);
  const banner = getStateBannerProps(adaptiveConfig);

  const gradeColor = (grade: string) => {
    const map: Record<string, string> = { A: T.sage, B: T.teal, C: T.gold, D: T.blush, F: "#ff4444", "—": T.taupe };
    return map[grade] || T.taupe;
  };

  const loadColor = (load: string) => {
    const map: Record<string, string> = { light: T.sage, normal: T.teal, heavy: T.gold, critical: T.blush };
    return map[load] || T.taupe;
  };

  const loadLabel = (load: string) => {
    const map: Record<string, string> = { light: "Light", normal: "Steady", heavy: "Heavy", critical: "Critical" };
    return map[load] || load;
  };

  if (loading) return (
    <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12, display: "flex", justifyContent: "center" }}>
      <Spinner size={20} />
    </div>
  );

  if (!snap) return null;

  const f = snap.financial;
  const pct = f.totalBudget > 0 ? Math.round((f.totalSpent / f.totalBudget) * 100) : 0;

  return (
    <div style={{ background: T.ivory, border: `1px solid ${T.linen}`, borderRadius: 20, padding: "16px", marginBottom: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.taupe, margin: 0 }}>HOUSEHOLD PULSE</p>
        <span style={{ fontFamily: F.sans, fontSize: 10, color: T.taupe }}>
          {new Date(snap.lastRefreshed).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>

      {/* Adaptive state banner */}
      {banner.show && (
        <div style={{ padding: "8px 10px", background: `${banner.color}15`, borderRadius: 10, marginBottom: 10, borderLeft: `3px solid ${banner.color}` }}>
          <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700, color: banner.color, margin: "0 0 2px" }}>{banner.label}</p>
          <p style={{ fontFamily: F.sans, fontSize: 11, color: T.esp, margin: 0 }}>{banner.description}</p>
        </div>
      )}

      {/* Three stat pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {/* Financial health */}
        <div onClick={() => useStore.getState().setActiveTab("budget")}
          role="button" tabIndex={0} onKeyDown={onEnterSpace} aria-label="Open budget"
          style={{ flex: 1, padding: "10px 8px", background: "#fff", borderRadius: 14, border: `1px solid ${T.linen}`, textAlign: "center", cursor: "pointer" }}>
          <p style={{ fontFamily: F.serif, fontSize: 22, fontWeight: 700, color: gradeColor(f.financialHealthGrade), margin: "0 0 2px" }}>
            {f.financialHealthGrade}
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Finance</p>
        </div>

        {/* Calendar load */}
        <div onClick={() => useStore.getState().setActiveTab("calendar")}
          role="button" tabIndex={0} onKeyDown={onEnterSpace} aria-label="Open schedule"
          style={{ flex: 1, padding: "10px 8px", background: "#fff", borderRadius: 14, border: `1px solid ${T.linen}`, textAlign: "center", cursor: "pointer" }}>
          <p style={{ fontFamily: F.serif, fontSize: 14, fontWeight: 700, color: loadColor(snap.calendarLoad), margin: "0 0 2px" }}>
            {loadLabel(snap.calendarLoad)}
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Schedule</p>
        </div>

        {/* Household stress */}
        <div onClick={() => useStore.getState().setActiveTab("briefing")}
          role="button" tabIndex={0} onKeyDown={onEnterSpace} aria-label="Open briefing"
          style={{ flex: 1, padding: "10px 8px", background: "#fff", borderRadius: 14, border: `1px solid ${T.linen}`, textAlign: "center", cursor: "pointer" }}>
          <p style={{ fontFamily: F.serif, fontSize: 14, fontWeight: 700,
            color: snap.householdStressLevel === "high" ? T.blush : snap.householdStressLevel === "moderate" ? T.gold : T.sage,
            margin: "0 0 2px", textTransform: "capitalize" }}>
            {snap.householdStressLevel}
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 9, color: T.taupe, margin: 0, textTransform: "uppercase", letterSpacing: "0.08em" }}>Stress</p>
        </div>
      </div>

      {/* Budget bar */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontFamily: F.sans, fontSize: 11, color: T.taupe }}>Budget this month</span>
          <span style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 700,
            color: pct > 90 ? T.blush : pct > 70 ? T.gold : T.sage }}>
            {pct}% · {formatMoney(f.cashRemaining)} left
          </span>
        </div>
        <div style={{ height: 4, background: T.linen, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: pct > 90 ? T.blush : pct > 70 ? T.gold : T.sage, borderRadius: 4, transition: "width 0.6s ease" }} />
        </div>
      </div>

      {/* Goals at risk */}
      {snap.activeGoals.filter(g => g.riskStatus !== "on_track").length > 0 && (
        <div style={{ padding: "8px 10px", background: `${T.gold}10`, borderRadius: 10, marginBottom: 10 }}>
          <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: 0 }}>
            ⚠ {snap.activeGoals.filter(g => g.riskStatus !== "on_track").map(g => g.name).join(", ")} {snap.activeGoals.filter(g => g.riskStatus !== "on_track").length === 1 ? "goal needs" : "goals need"} attention
          </p>
        </div>
      )}

      {/* Top AI insight */}
      {/* Top 3 insights */}
      {(filteredInsights.length ? filteredInsights : householdInsights)
        .filter(i => !i.dismissed)
        .slice(0, 3)
        .map((insight, idx) => {
          const CATEGORY_COLORS: Record<string, string> = {
            spending: T.blush, savings: T.sage, debt: T.gold,
            cashflow: T.teal, stress: T.lav, scheduling: T.sky,
            family: T.esp, health: T.sage, decision: T.gold, opportunity: T.teal,
          };
          const color = CATEGORY_COLORS[insight.category] || T.teal;
          return (
            <div key={insight.id} style={{ padding: "10px 12px", background: `${color}10`, borderRadius: 12, border: `1px solid ${color}25`, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, color, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    ✦ {insight.category?.toUpperCase() || "INSIGHT"} {idx === 0 ? "· TOP PRIORITY" : ""}
                  </p>
                  <p style={{ fontFamily: F.sans, fontSize: 12, color: T.esp, margin: "0 0 4px", lineHeight: 1.5 }}>
                    {insight.observation}
                  </p>
                  <p style={{ fontFamily: F.sans, fontSize: 11, fontWeight: 600, color, margin: 0 }}>
                    → {insight.recommendation}
                  </p>
                </div>
                <button onClick={() => dismissInsight(insight.id)}
                  style={{ background: "none", border: "none", color: T.taupe, cursor: "pointer", fontSize: 16, flexShrink: 0, padding: 0 }}>
                  ×
                </button>
              </div>
            </div>
          );
        })
      }

      {/* Empty state when no insights */}
      {householdInsights.filter(i => !i.dismissed).length === 0 && !insightLoading && (householdSnapshot?.financial?.monthlyIncome || 0) === 0 && (
        <div style={{ background:T.sand, borderRadius:16, padding:"20px", marginBottom:12, textAlign:"center" }}>
          <p style={{ fontFamily:F.serif, fontSize:18, fontStyle:"italic", color:T.esp, margin:"0 0 8px" }}>Cleo is ready when you are</p>
          <p style={{ fontFamily:F.sans, fontSize:12, color:T.taupe, margin:"0 0 16px", lineHeight:1.6 }}>Add your income and budget to unlock household insights, financial health scores, and Cleo's full intelligence.</p>
          <button onClick={() => setShowCleoSetup(true)}
            style={{ background:T.esp, color:"#fff", border:"none", borderRadius:12, padding:"10px 20px", fontFamily:F.sans, fontSize:13, fontWeight:600, cursor:"pointer" }}>
            Set up with Cleo ✦
          </button>
        </div>
      )}

      {/* Generate / refresh insights — hidden in relief mode */}
      {adaptiveConfig.showOptimizationNudges && (
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleGenerateInsight} disabled={insightLoading}
          style={{ flex: 1, padding: "8px", background: "none", border: `1px solid ${T.teal}`, borderRadius: 10, fontFamily: F.sans, fontSize: 11, color: T.teal, cursor: "pointer" }}>
          {insightLoading ? "Analyzing..." : householdInsights.length > 0 ? "↺ Refresh insights" : "✦ Generate insights"}
        </button>
        <button onClick={() => setShowCleoSetup(true)}
          style={{ flex: 1, padding: "8px", background: "none", border: `1px solid ${T.linen}`, borderRadius: 10, fontFamily: F.sans, fontSize: 11, color: T.esp, cursor: "pointer" }}>
          View CFO →
        </button>
      </div>
      )}

      {showCleoSetup && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: T.cream, overflowY: "auto" }}>
          <CleoSetupScreen onComplete={() => setShowCleoSetup(false)} />
        </div>
      )}
    </div>
  );
}

