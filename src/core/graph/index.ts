// ─── HerNest Context Graph — Exports ─────────────────────────────
// src/core/graph/index.ts

export {
  createContextGraph,
  updateGraphFromModuleEvent,
  getRelevantContextForAI,
  detectCrossModulePatterns,
  generateContextPackForNora,
  generateContextPackForCFO,
  saveMemoryFromInsight,
  explainWhyRecommendationWasMade,
  loadGraphFromFirestore,
  saveGraphToFirestore,
  formatNoraContextPackForPrompt,
  formatCFOContextPackForPrompt,
  COMPLIANCE_NOTE,
} from "./GraphService";

export { useContextGraph } from "./useContextGraph";

export type {
  HouseholdContextGraph,
  GraphNode,
  ContextRelationship,
  Person,
  FinancialContext,
  CalendarContext,
  RoutineContext,
  Goal,
  HouseholdStressContext,
  HouseholdDecision,
  Memory,
  Insight,
  ModuleEvent,
  DetectedPattern,
  RecommendationExplanation,
  NoraContextPack,
  CFOContextPack,
  RelationshipType,
  NodeType,
  HouseholdModule,
  StressSource,
  DecisionOption,
  GoalCategory,
  GoalStatus,
  MemoryType,
  InsightType,
  InsightSeverity,
} from "./types";
