// ─── Design preview: sample household ──────────────────────────────
// Made-up data so every screen can be seen without signing in. Dates are
// relative to today so the screens always look "live". Never shipped.
import type { Bill } from "../../core/bills";
import type { WearableDay, WearableDayPoint } from "../../core/wellnessAutoTrack";
import { todayLocal } from "../../core/dateAwareness";

export const PREVIEW_UID = "preview-user";

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return todayLocal(d); };
const dom = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getDate(); };

export const sampleBills: Bill[] = [
  { id: "b1", name: "Electric", amount: 142, amountVaries: true, cadence: "monthly", dueDay: dom(1), addedOn: day(-3) },
  { id: "b2", name: "Internet", amount: 70, cadence: "monthly", dueDay: dom(3), autopay: true, addedOn: day(-3) },
  { id: "b3", name: "Car insurance", amount: 188, cadence: "monthly", dueDay: dom(5), addedOn: day(-3) },
  { id: "b4", name: "Daycare", amount: 1250, cadence: "monthly", dueDay: dom(12), addedOn: day(-3) },
  { id: "b5", name: "Water", amount: 48, cadence: "monthly", dueDay: dom(18), addedOn: day(-3) },
  { id: "b6", name: "Streaming", amount: 16, cadence: "monthly", dueDay: dom(-4), autopay: true, addedOn: day(-60), paidThrough: day(-4),
    payments: [{ due: day(-4), paidOn: day(-4), amount: 16, auto: true, confirmedBy: PREVIEW_UID }] },
] as Bill[];

export const sampleTasks = [
  { id: "t1", title: "Sign Maya's field trip form", status: "pending", dueDate: day(0), createdBy: PREVIEW_UID },
  { id: "t2", title: "Book dentist for Leo", status: "pending", dueDate: day(2), createdBy: PREVIEW_UID },
  { id: "t3", title: "Pick up dry cleaning", status: "pending", createdBy: "partner", createdByName: "Sam", assigneeUid: "partner", assigneeName: "Sam", state: "accepted" },
];

export const sampleCalendar = {
  events: [
    { title: "School drop-off", date: day(0), time: "08:00" },
    { title: "Team standup", date: day(0), time: "09:30" },
    { title: "Leo's soccer practice", date: day(0), time: "16:30" },
    { title: "Family dinner at Grandma's", date: day(0), time: "18:30" },
    { title: "Parent-teacher conference", date: day(1), time: "15:00" },
  ],
};

const hist: WearableDayPoint[] = [7.1, 6.4, 7.6, 6.9, 5.8, 7.3, 7.4].map((h, i) => ({
  day: day(i - 6), sleepHours: h, sleepScore: null, readiness: null,
  hrv: [48, 44, 52, 50, 41, 47, 45][i], restingHr: [60, 62, 59, 60, 64, 61, 61][i],
  steps: [7200, 5400, 8900, 6100, 4300, 7600, 3100][i], stressDay: null, activeMins: [30, 12, 45, 22, 0, 35, 10][i],
}));

export const sampleWearable: WearableDay = {
  source: "apple_health", date: day(0),
  sleepHours: 7.4, sleepScore: null, readiness: null, steps: 3100,
  avgHrv: 45, restingHr: 61, readinessContributors: null,
  stressDay: null, stressHighMins: null, recoveryHighMins: null,
  activeCalories: null, sedentaryMins: null, activityScore: null,
  activeMins: 10, mindfulMins: 5, history: hist,
};

export const sampleDocs: Record<string, Record<string, unknown>> = {
  calendar: sampleCalendar,
  thrive: { moveGoal: { type: "minutes", amount: 20, days: 3 }, movedDays: [day(-2)], habitPicks: ["water", "stretch"] },
  circle: { contacts: [{ name: "Aunt Jo", birthday: day(3).slice(5) }] },
};

export const sampleBriefing = {
  focusWord: { word: "Steady", emoji: "", why: "A full afternoon, but nothing you can't handle" },
  greeting: "Good morning",
  priorities: [
    { rank: 1, text: "Sign Maya's field trip form before drop-off", emoji: "", source: "school", urgency: "high", whyToday: "" },
    { rank: 2, text: "Electric bill is due tomorrow, about $142", emoji: "", source: "bills", urgency: "medium", whyToday: "" },
    { rank: 3, text: "Leave by 4:10 for Leo's soccer practice", emoji: "", source: "calendar", urgency: "medium", whyToday: "" },
  ],
  calendar: { highlights: [] }, tasks: { aiSuggestion: "", completionNote: "" },
  circle: {}, affirmation: { text: "", theme: "" },
};
