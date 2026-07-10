import { T } from "../../config/theme";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type TripState =
  | "dreaming" | "evaluating" | "booking" | "preparing"
  | "countdown" | "travel_day" | "in_trip" | "returning"
  | "recovery" | "completed";

export interface Traveller {
  id: string;
  name: string;
  age: number;
  type: "adult" | "child" | "infant";
  role?: "partner" | "kid" | "parent" | "friend" | "other";
  fromProfile?: boolean;
}

export interface BudgetBreakdown {
  flights: number;
  accommodation: number;
  food: number;
  activities: number;
  transport: number;
  contingency: number;
}

export interface ItineraryDay {
  day: number;
  date: string;
  theme: string;
  morning: string;
  afternoon: string;
  evening: string;
  tip: string;
  mumMoment: string;
}

export interface PackingItem {
  name: string;
  quantity: number;
  essential: boolean;
  checked: boolean;
  custom: boolean;
  weatherDependent?: boolean;
  assignedTo?: string;
}

export interface PackingSection {
  name: string;
  items: PackingItem[];
}

export interface PreDepartureTask {
  task: string;
  deadline: string;
  completed: boolean;
  category: "booking" | "document" | "health" | "packing" | "home" | "notification";
  assignedTo?: string;
}

export interface TripDocument {
  type: "passport" | "visa" | "insurance" | "booking" | "health";
  status: "needed" | "ready" | "expired";
  traveller?: string;
  notes?: string;
}

export interface ReadinessScore {
  overall: number;
  documents: number;
  budget: number;
  packing: number;
  booking: number;
  tasks: number;
}

export interface Trip {
  id: string;
  destination: string;
  country: string;
  departureDate: string;
  returnDate?: string;
  nights: number;
  state: TripState;
  travellers: Traveller[];
  budget: { total: number; currency: string; breakdown: BudgetBreakdown; spent?: number };
  itinerary: ItineraryDay[];
  packingList: PackingSection[];
  preDeparture: PreDepartureTask[];
  documents: TripDocument[];
  stressLevel?: "low" | "moderate" | "high";
  householdImpact?: string;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

export const safeDate = (d: string) => { try { const dt = new Date(d); return isNaN(dt.getTime()) ? new Date() : dt; } catch { return new Date(); } };
export const daysUntil = (d: string) => Math.ceil((safeDate(d).getTime() - Date.now()) / 86400000);

export function computeTripState(trip: Trip): TripState {
  const du = daysUntil(trip.departureDate);
  if ((trip.state as string) === "completed" || (trip.state as string) === "recovery") return trip.state;
  if (du < 0) {
    const returnDu = trip.returnDate ? daysUntil(trip.returnDate) : -1;
    if (returnDu > 0) return "in_trip";
    if (returnDu > -3) return "returning";
    return trip.state === "recovery" ? "recovery" : "completed";
  }
  if (du === 0) return "travel_day";
  if (du <= 7) return "countdown";
  if (du <= 30) return "preparing";
  if (trip.state === "evaluating") return "evaluating";
  return "booking";
}

export function computeReadiness(trip: Trip): ReadinessScore {
  const docs = trip.documents.length > 0
    ? Math.round((trip.documents.filter(d => d.status === "ready").length / trip.documents.length) * 100) : 0;
  const budget = trip.budget.total > 0 ? 100 : 0;
  const packing = trip.packingList.length > 0
    ? Math.round((trip.packingList.flatMap(s => s.items).filter(i => i.checked).length / Math.max(1, trip.packingList.flatMap(s => s.items).length)) * 100) : 0;
  const booking = trip.documents.find(d => d.type === "booking")?.status === "ready" ? 100 : 0;
  const tasks = trip.preDeparture.length > 0
    ? Math.round((trip.preDeparture.filter(t => t.completed).length / trip.preDeparture.length) * 100) : 0;
  const overall = Math.round((docs + budget + packing + booking + tasks) / 5);
  return { overall, documents: docs, budget, packing, booking, tasks };
}

export function estimateBudgetBreakdown(total: number): BudgetBreakdown {
  return {
    flights: Math.round(total * 0.35),
    accommodation: Math.round(total * 0.30),
    food: Math.round(total * 0.15),
    activities: Math.round(total * 0.10),
    transport: Math.round(total * 0.05),
    contingency: Math.round(total * 0.05),
  };
}

export const STATE_CONFIG: Record<TripState, { label: string; color: string; emoji: string; description: string }> = {
  dreaming:   { label: "Dreaming",    color: T.lav,   emoji: "✦",  description: "Explore the idea" },
  evaluating: { label: "Evaluating",  color: T.sky,   emoji: "◎",  description: "Checking affordability" },
  booking:    { label: "Booking",     color: T.teal,  emoji: "◈",  description: "Securing reservations" },
  preparing:  { label: "Preparing",   color: T.gold,  emoji: "◆",  description: "Getting ready" },
  countdown:  { label: "Countdown",   color: T.sage,  emoji: "✓",  description: "Almost there" },
  travel_day: { label: "Travel Day",  color: "#dc2626", emoji: "✈", description: "Today's the day" },
  in_trip:    { label: "In Trip",     color: T.teal,  emoji: "☀",  description: "Enjoy every moment" },
  returning:  { label: "Returning",   color: T.gold,  emoji: "→",  description: "Heading home" },
  recovery:   { label: "Recovery",    color: T.sage,  emoji: "◦",  description: "Settling back in" },
  completed:  { label: "Completed",   color: T.taupe, emoji: "✦",  description: "A trip to remember" },
};

export const PRE_DEPARTURE_TASKS: Omit<PreDepartureTask, "completed">[] = [
  { task: "Check passport expiry dates",    deadline: "60 days before", category: "document" },
  { task: "Book flights & accommodation",   deadline: "90 days before", category: "booking" },
  { task: "Arrange travel insurance",       deadline: "30 days before", category: "document" },
  { task: "Check visa requirements",        deadline: "60 days before", category: "document" },
  { task: "Notify bank of travel dates",    deadline: "7 days before",  category: "notification" },
  { task: "Arrange pet / house care",       deadline: "14 days before", category: "home" },
  { task: "Complete online check-in",       deadline: "1 day before",   category: "booking" },
  { task: "Download offline maps",          deadline: "3 days before",  category: "packing" },
  { task: "Charge all devices",             deadline: "1 day before",   category: "packing" },
  { task: "Pack medications & first aid",   deadline: "2 days before",  category: "health" },
];

export function normTrip(t: any): Trip {
  return {
    ...t,
    travellers:   Array.isArray(t.travellers)   ? t.travellers   : [],
    itinerary:    Array.isArray(t.itinerary)    ? t.itinerary    : [],
    packingList:  Array.isArray(t.packingList)  ? t.packingList  : [],
    preDeparture: Array.isArray(t.preDeparture) ? t.preDeparture : [],
    documents:    Array.isArray(t.documents)    ? t.documents    : [],
    state: t.state || computeTripState(t),
  };
}
