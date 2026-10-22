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
    { id: "ev1", title: "School drop-off", date: day(0), time: "08:00" },
    { id: "ev2", title: "Team standup", date: day(0), time: "09:30" },
    { id: "ev3", title: "Leo's soccer practice", date: day(0), time: "16:30", child: "Leo" },
    { id: "ev4", title: "Family dinner at Grandma's", date: day(0), time: "18:30" },
    { id: "ev5", title: "Parent-teacher conference", date: day(1), time: "15:00" },
    { id: "school_maya_a", title: "Picture day", date: day(4), source: "school", child: "Maya", allDay: true, color: "#7A5A9E" },
    { id: "school_maya_b", title: "No school, teacher workday", date: day(9), source: "school", child: "Maya", allDay: true, color: "#7A5A9E" },
    { id: "school_leo_a", title: "Pajama day", date: day(6), source: "school", child: "Leo", allDay: true, color: "#4C7BB8" },
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


const sampleTrips = [
  {
    id: "trip1", destination: "Lisbon, Portugal", country: "Portugal", departureDate: day(12), returnDate: day(17), nights: 5, state: "preparing",
    travellers: [
      { id: "self", name: "Jess", age: 36, type: "adult", role: "other", fromProfile: true },
      { id: "p1", name: "Sam", age: 38, type: "adult", role: "partner", fromProfile: true },
      { id: "k1", name: "Maya", age: 7, type: "child", role: "kid", fromProfile: true },
      { id: "k2", name: "Leo", age: 4, type: "child", role: "kid", fromProfile: true },
    ],
    budget: { total: 4800, currency: "USD", spent: 1700, breakdown: { flights: 1680, accommodation: 1440, food: 720, activities: 480, transport: 240, contingency: 240 } },
    itinerary: [
      { day: 1, date: day(12), theme: "Arrive and wander Alfama", morning: "Land, taxi to the apartment", afternoon: "Slow walk through Alfama's lanes", evening: "Early family dinner near the square", tip: "Grab a rechargeable transit card at the airport.", mumMoment: "A quiet coffee on the terrace while the kids nap." },
      { day: 2, date: day(13), theme: "Belem and the river", morning: "Pastries and the riverside park", afternoon: "Tram ride and a playground stop", evening: "Casual seafood spot by the water", tip: "Go to Belem before 10 to skip the lines.", mumMoment: "A long, unhurried lunch with a glass of vinho verde." },
    ],
    packingList: [
      { name: "Mom", items: [
        { name: "Passport", quantity: 1, essential: true, checked: true, custom: false },
        { name: "Comfortable walking shoes", quantity: 1, essential: true, checked: false, custom: false, weatherDependent: true },
        { name: "Light rain jacket", quantity: 1, essential: false, checked: false, custom: false, weatherDependent: true },
      ] },
      { name: "Kids", items: [
        { name: "Favorite stuffed animals", quantity: 2, essential: true, checked: false, custom: false },
        { name: "Sun hats", quantity: 2, essential: false, checked: true, custom: false, weatherDependent: true },
        { name: "Snack stash", quantity: 1, essential: false, checked: false, custom: false },
      ] },
    ],
    preDeparture: [
      { task: "Check passport expiry dates", deadline: "60 days before", category: "document", completed: true },
      { task: "Book flights and accommodation", deadline: "90 days before", category: "booking", completed: true },
      { task: "Arrange travel insurance", deadline: "30 days before", category: "document", completed: false },
      { task: "Notify bank of travel dates", deadline: "7 days before", category: "notification", completed: false },
      { task: "Pack medications and first aid", deadline: "2 days before", category: "health", completed: false },
    ],
    documents: [
      { type: "passport", status: "ready", traveller: "Jess" },
      { type: "passport", status: "needed", traveller: "Sam" },
      { type: "passport", status: "expired", traveller: "Maya" },
      { type: "insurance", status: "needed" },
      { type: "booking", status: "ready" },
    ],
    createdAt: Date.now() - 86400000 * 20,
  },
  {
    id: "trip2", destination: "Asheville, North Carolina", country: "North Carolina", departureDate: day(-70), returnDate: day(-66), nights: 4, state: "completed",
    travellers: [{ id: "self", name: "Jess", age: 36, type: "adult" }, { id: "k1", name: "Maya", age: 7, type: "child" }],
    budget: { total: 1800, currency: "USD", spent: 1650, breakdown: { flights: 0, accommodation: 800, food: 400, activities: 300, transport: 200, contingency: 100 } },
    itinerary: [], packingList: [], preDeparture: [], documents: [], createdAt: Date.now() - 86400000 * 120,
  },
];

export const sampleDocs: Record<string, Record<string, unknown>> = {
  family: { members: [
    { id: "kid-maya", name: "Maya", role: "child", color: "#7A5A9E", birthDate: "2018-11-02", schoolInfo: { grade: "2nd" } },
    { id: "kid-leo", name: "Leo", role: "child", color: "#4C7BB8", birthDate: "2021-03-14" },
    { id: "partner-sam", name: "Sam", role: "partner", color: "#4F8A62", birthDate: "1987-06-20" },
  ] },
  calendar: sampleCalendar,
  thrive: { moveGoal: { type: "minutes", amount: 20, days: 3 }, movedDays: [day(-2)], habitPicks: ["water", "stretch"] },
  trips: { trips: sampleTrips },
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
