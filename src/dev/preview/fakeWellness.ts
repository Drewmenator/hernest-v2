// ─── Design preview: wearable, Cleo's notes, weather ───────────────
export * from "../../core/wellnessAutoTrack";
import { sampleWearable } from "./sampleData";
export const readWearable = async () => sampleWearable;
export const autoTrackWellness = async () => ({ wearable: sampleWearable, sleepLogged: false, moveDone: false });
