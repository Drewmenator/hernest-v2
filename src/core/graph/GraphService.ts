// ─── HerNest Household Context Graph — Service ───────────────────
// src/core/graph/GraphService.ts
//
// All 8 graph operations matching the HerNest Context Graph brief.
//
// This file is now a barrel: the implementation is split into focused
// modules, re-exported here so existing importers keep working.

export { COMPLIANCE_NOTE } from "./internals";
export { createContextGraph } from "./graphBuilder";
export { updateGraphFromModuleEvent } from "./graphEvents";
export { getRelevantContextForAI, detectCrossModulePatterns } from "./patternDetection";
export {
  generateContextPackForCleo,
  generateContextPackForCFO,
  formatCleoContextPackForPrompt,
  formatCFOContextPackForPrompt,
} from "./contextPacks";
export { saveMemoryFromInsight, explainWhyRecommendationWasMade } from "./explainability";
export { saveGraphToFirestore, loadGraphFromFirestore } from "./persistence";
