import { useStore } from "../../core/store";
import { PLAN_TAB_KEY } from "../../modules/plan/planHelpers";

// Open Plan on a given segment. The tab bar opens Plan on the Calendar;
// anything about a task (Add task, Needs you, reminders) opens Tasks.
export type PlanSegment = "week" | "tasks" | "school" | "meals";
export function openPlan(segment: PlanSegment) {
  try { sessionStorage.setItem(PLAN_TAB_KEY, segment); } catch { /* private mode */ }
  useStore.getState().setActiveTab("plan");
}
