import { T } from "../../config/theme";
import type { ScoreBand, AttentionSeverity } from "../../core/intelligence/householdScores";

export const BAND_COLOR: Record<ScoreBand, string> = { fragile: T.blush, stretched: T.gold, steady: T.teal, resilient: T.sage };
export const SEV_COLOR: Record<AttentionSeverity, string> = { alert: T.blush, watch: T.gold, info: T.sky };
export const SEV_RANK: Record<AttentionSeverity, number> = { alert: 3, watch: 2, info: 1 };
export const SOURCE_TAB: Record<string, string> = { budget: "budget", tasks: "plan", school: "plan", trips: "trips", goals: "budget", thrive: "thrive", circle: "circle", calendar: "calendar" };
export const cc_str = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
