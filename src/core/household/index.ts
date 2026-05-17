// ─── HerNest Household Intelligence Layer ────────────────────────
// Clean export surface for all modules

export {
  runScenario,
  analyzeScenario,
  saveScenario,
  loadScenarios,
  quickAffordabilityCheck,
  buildSpendingTrends,
  buildFinancialContextString,
  COMPLIANCE_DISCLAIMER,
} from "./DecisionEngine";

export type {
  HerNestCFOResponse,
  ScenarioRecord,
  SpendingTrend,
} from "./DecisionEngine";

export {
  generateHouseholdInsights,
  saveHouseholdInsights,
  loadHouseholdInsights,
  buildHouseholdSnapshot,
  buildIntelligencePromptContext,
  getTopInsight,
} from "./HouseholdIntelligence";
