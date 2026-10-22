export * from "../../modules/briefing/generateBriefing";
import type { Briefing } from "../../modules/briefing/generateBriefing";
import { sampleBriefing } from "./sampleData";
export const cachedBriefing = async () => sampleBriefing as unknown as Briefing;
