// ─── HerNest Response Validation Layer ───────────────────────────
// Sits between AI response and UI.
// Claude responses NEVER go directly to the screen.
//
// Responsibilities:
// 1. Schema validation    — is the JSON structure valid?
// 2. Safety guardrails    — does it contain forbidden advice?
// 3. Tone validation      — is it consistent with Cleo's voice?
// 4. Confidence scoring   — normalize overconfident claims
// 5. Repair step          — retry malformed JSON once before fallback
// 6. Length normalization — adapt to household state
//
// All validation is non-blocking — failures return safe fallbacks,
// never crash a screen.

import type { OrchestratorFeature, AIIntent } from "../aiOrchestrator";
import type { HouseholdStateResult } from "./householdStateEngine";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  text: string;               // final text to show (may be repaired or fallback)
  parsed?: unknown;           // parsed JSON if requireJson was true
  warnings: ValidationWarning[];
  repaired: boolean;          // true if JSON was malformed and we fixed it
  safetyFlag?: string;        // set if forbidden content was detected
  confidenceNormalized: boolean;
  lengthAdjusted: boolean;
}

export interface ValidationWarning {
  code: string;
  message: string;
  severity: "info" | "warn" | "error";
}

// ═══════════════════════════════════════════════════════════════════
// SAFETY GUARDRAILS
// Patterns that must NEVER appear in Cleo responses
// ═══════════════════════════════════════════════════════════════════

const FORBIDDEN_PATTERNS: { pattern: RegExp; code: string; reason: string }[] = [
  // Investment advice
  { pattern: /\b(buy|sell|invest in|put money into|stock|crypto|bitcoin|etf|fund)\b/i,
    code: "investment_advice", reason: "Contains investment advice" },

  // Tax advice
  { pattern: /\b(tax deduct|write off|irs|tax return|file taxes|taxable)\b/i,
    code: "tax_advice", reason: "Contains tax advice" },

  // Legal advice
  { pattern: /\b(legally|lawyer|attorney|legal advice|sue|lawsuit|contract clause)\b/i,
    code: "legal_advice", reason: "Contains legal advice" },

  // Guarantees
  { pattern: /\b(guaranteed|I guarantee|will definitely|100% certain|certain to)\b/i,
    code: "false_guarantee", reason: "Contains guaranteed outcome claim" },

  // Shame language
  { pattern: /\b(you failed|you wasted|irresponsible|bad with money|you should have)\b/i,
    code: "shame_language", reason: "Contains shame or blame language" },

  // Medical/mental health diagnosis
  { pattern: /\b(you have|diagnosed with|symptoms of|disorder|depression|anxiety disorder)\b/i,
    code: "medical_advice", reason: "Contains medical or mental health diagnosis" },
];

// Patterns that are warnings but not blockers
const WARNING_PATTERNS: { pattern: RegExp; code: string; message: string }[] = [
  { pattern: /\b(always|never|every time|without exception)\b/i,
    code: "absolute_language", message: "Uses absolute language — consider softening" },
  { pattern: /\$[\d,]+,[\d]{3}/,
    code: "large_number", message: "Contains large dollar amount — verify accuracy" },
];

// ═══════════════════════════════════════════════════════════════════
// TONE VALIDATOR
// Ensures response matches Cleo's voice
// ═══════════════════════════════════════════════════════════════════

const NORA_TONE_MARKERS = {
  // Good signals
  warm: /\b(I can see|that makes sense|understandable|here's|let's|together)\b/i,
  practical: /\b(step|option|consider|try|start with|focus on)\b/i,
};

function validateTone(text: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const isWarm = NORA_TONE_MARKERS.warm.test(text);
  const isPractical = NORA_TONE_MARKERS.practical.test(text);

  if (!isWarm && !isPractical && text.length > 200) {
    warnings.push({
      code: "tone_mismatch",
      message: "Response may not match Cleo's warm, practical voice",
      severity: "info",
    });
  }
  return warnings;
}

// ═══════════════════════════════════════════════════════════════════
// CONFIDENCE NORMALIZER
// Prevents overconfident claims in AI responses
// ═══════════════════════════════════════════════════════════════════

const OVERCONFIDENCE_PATTERNS = [
  { pattern: /confidence[:\s]+(?:very\s+)?high/gi, replacement: "confidence: medium-high" },
  { pattern: /\b(definitely|certainly|absolutely will|100%)\b/gi, replacement: "likely" },
  { pattern: /\bwill save you exactly\b/gi, replacement: "could save approximately" },
  { pattern: /\bI know for certain\b/gi, replacement: "Based on available data" },
];

function normalizeConfidence(text: string): { text: string; normalized: boolean } {
  let result = text;
  let normalized = false;

  for (const { pattern, replacement } of OVERCONFIDENCE_PATTERNS) {
    if (pattern.test(result)) {
      result = result.replace(pattern, replacement);
      normalized = true;
    }
    pattern.lastIndex = 0; // reset regex state
  }

  return { text: result, normalized };
}

// ═══════════════════════════════════════════════════════════════════
// LENGTH ADAPTER
// Adjusts response length based on household state
// ═══════════════════════════════════════════════════════════════════

function adaptLength(
  text: string,
  householdState: HouseholdStateResult | null,
  intent: AIIntent
): { text: string; adjusted: boolean } {
  if (!householdState) return { text, adjusted: false };

  const state = householdState.primary.state;
  const tone  = householdState.cleoTone;

  // Overloaded state: truncate long responses
  if (tone === "validating_brief" && text.length > 800) {
    // Keep first paragraph + recommendation
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
    if (paragraphs.length > 3) {
      const shortened = paragraphs.slice(0, 3).join("\n\n");
      return {
        text: shortened + "\n\n_I've kept this short — you have a lot on right now._",
        adjusted: true,
      };
    }
  }

  // Emotional support: don't truncate
  if (intent === "emotional_support") return { text, adjusted: false };

  return { text, adjusted: false };
}

// ═══════════════════════════════════════════════════════════════════
// JSON REPAIR
// Attempts to fix malformed JSON before giving up
// ═══════════════════════════════════════════════════════════════════

function repairJSON(raw: string): unknown | null {
  // Strip markdown fences
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // Extract first JSON object or array
  const objStart = cleaned.indexOf("{");
  const arrStart = cleaned.indexOf("[");
  let start = -1;

  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) start = objStart;
  else if (arrStart !== -1) start = arrStart;

  if (start === -1) return null;

  // Find matching closing bracket
  const opener = cleaned[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let end = -1;

  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === opener) depth++;
    if (cleaned[i] === closer) depth--;
    if (depth === 0) { end = i; break; }
  }

  if (end === -1) return null;

  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    // Try adding missing closing brackets
    try { return JSON.parse(candidate + closer); } catch { return null; }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SAFETY CHECK
// Returns a flag string if forbidden content detected, null if clean
// ═══════════════════════════════════════════════════════════════════

function checkSafety(text: string): {
  flag: string | null;
  warnings: ValidationWarning[];
  sanitized: string;
} {
  const warnings: ValidationWarning[] = [];
  let sanitized = text;
  let flag: string | null = null;

  for (const { pattern, code, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      // For most violations, warn but don't block — add a disclaimer
      // Only hard-block investment/tax/legal advice
      if (["investment_advice", "tax_advice", "legal_advice"].includes(code)) {
        flag = code;
        warnings.push({ code, message: reason, severity: "error" });
      } else {
        warnings.push({ code, message: reason, severity: "warn" });
      }
      pattern.lastIndex = 0;
    }
  }

  for (const { pattern, code, message } of WARNING_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push({ code, message, severity: "info" });
      pattern.lastIndex = 0;
    }
  }

  // Append compliance note if financial analysis detected
  if (text.includes("$") && text.length > 300 && !text.includes("educational")) {
    sanitized += "\n\n_This is educational budgeting guidance, not financial advice._";
  }

  return { flag, warnings, sanitized };
}

// ═══════════════════════════════════════════════════════════════════
// SAFE FALLBACKS
// Per-intent fallbacks used when validation fails hard
// ═══════════════════════════════════════════════════════════════════

const VALIDATION_FALLBACKS: Partial<Record<AIIntent, string>> = {
  financial_analysis: "I want to give you accurate financial guidance — let me try that again with better data.",
  emotional_support:  "I'm here with you. Let me try that again. 💛",
  decision_support:   "I wasn't able to complete that analysis safely. Please try again.",
};

// ═══════════════════════════════════════════════════════════════════
// MAIN VALIDATOR
// ═══════════════════════════════════════════════════════════════════

export function validateResponse(params: {
  rawText: string;
  rawParsed?: unknown;
  intent: AIIntent;
  feature: OrchestratorFeature;
  requireJson: boolean;
  householdState: HouseholdStateResult | null;
  fallbackText: string;
}): ValidationResult {
  const {
    rawText, rawParsed, intent, feature,
    requireJson, householdState, fallbackText,
  } = params;

  const warnings: ValidationWarning[] = [];
  let text = rawText;
  let parsed = rawParsed;
  let repaired = false;
  let safetyFlag: string | undefined;

  // ── 1. JSON validation + repair ─────────────────────────────────
  if (requireJson) {
    if (!parsed || (typeof parsed === "object" && Object.keys(parsed as object).length === 0)) {
      // Try to repair
      const fixed = repairJSON(rawText);
      if (fixed) {
        parsed = fixed;
        text = JSON.stringify(fixed);
        repaired = true;
        warnings.push({ code: "json_repaired", message: "JSON was malformed and repaired", severity: "warn" });
      } else {
        // Can't repair — return fallback
        return {
          valid: false,
          text: fallbackText,
          warnings: [{ code: "json_invalid", message: "JSON could not be parsed or repaired", severity: "error" }],
          repaired: false,
          confidenceNormalized: false,
          lengthAdjusted: false,
        };
      }
    }
  }

  // ── 2. Safety check ──────────────────────────────────────────────
  const safety = checkSafety(text);
  warnings.push(...safety.warnings);
  text = safety.sanitized;

  if (safety.flag) {
    safetyFlag = safety.flag;
    // Hard block — return intent fallback
    const safeFallback = VALIDATION_FALLBACKS[intent] || fallbackText;
    return {
      valid: false,
      text: safeFallback,
      warnings,
      repaired,
      safetyFlag,
      confidenceNormalized: false,
      lengthAdjusted: false,
    };
  }

  // ── 3. Tone validation ───────────────────────────────────────────
  const toneWarnings = validateTone(text);
  warnings.push(...toneWarnings);

  // ── 4. Confidence normalization ──────────────────────────────────
  const { text: normalizedText, normalized } = normalizeConfidence(text);
  text = normalizedText;

  // ── 5. Length adaptation ─────────────────────────────────────────
  const { text: adaptedText, adjusted } = adaptLength(text, householdState, intent);
  text = adaptedText;

  return {
    valid: true,
    text,
    parsed,
    warnings,
    repaired,
    safetyFlag,
    confidenceNormalized: normalized,
    lengthAdjusted: adjusted,
  };
}
