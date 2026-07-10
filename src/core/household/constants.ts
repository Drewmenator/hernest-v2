// Leaf module (no imports) to break the DecisionEngine ↔ DecisionEngineV2
// circular dependency. DecisionEngine imports runDecisionV2 from V2, and V2
// (plus HouseholdIntelligence) needs the disclaimer — importing it from
// DecisionEngine created a cycle whose TDZ crashes dev ESM
// ("Cannot access 'COMPLIANCE_DISCLAIMER' before initialization").
export const COMPLIANCE_DISCLAIMER =
  "This is general information to help you think through household finances — not financial, tax, or legal advice. For decisions with big consequences, please check with a qualified professional.";
