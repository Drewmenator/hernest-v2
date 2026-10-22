// ─── Common US household bills for the tap-only setup ───────────────
import type { Cadence } from "../../core/bills";

export interface BillPreset {
  id: string;
  name: string;
  icon: string;
  cadence: Cadence;
  varies?: boolean;   // amount changes month to month
}

export const BILL_PRESETS: BillPreset[] = [
  { id: "rent",        name: "Rent or mortgage", icon: "🏠", cadence: "monthly" },
  { id: "electric",    name: "Electric",         icon: "💡", cadence: "monthly", varies: true },
  { id: "gas",         name: "Gas",              icon: "🔥", cadence: "monthly", varies: true },
  { id: "water",       name: "Water",            icon: "💧", cadence: "monthly", varies: true },
  { id: "internet",    name: "Internet",         icon: "📶", cadence: "monthly" },
  { id: "phone",       name: "Phone",            icon: "📱", cadence: "monthly" },
  { id: "credit_card", name: "Credit card",      icon: "💳", cadence: "monthly", varies: true },
  { id: "car",         name: "Car payment",      icon: "🚗", cadence: "monthly" },
  { id: "car_ins",     name: "Car insurance",    icon: "🛡️", cadence: "monthly" },
  { id: "health_ins",  name: "Health insurance", icon: "🩺", cadence: "monthly" },
  { id: "childcare",   name: "Childcare",        icon: "🧸", cadence: "monthly" },
  { id: "student",     name: "Student loan",     icon: "🎓", cadence: "monthly" },
  { id: "trash",       name: "Trash",            icon: "🗑️", cadence: "monthly" },
  { id: "netflix",     name: "Netflix",          icon: "🎬", cadence: "monthly" },
  { id: "spotify",     name: "Spotify",          icon: "🎧", cadence: "monthly" },
  { id: "disney",      name: "Disney+",          icon: "✨", cadence: "monthly" },
  { id: "hulu",        name: "Hulu",             icon: "📺", cadence: "monthly" },
  { id: "prime",       name: "Amazon Prime",     icon: "📦", cadence: "monthly" },
  { id: "icloud",      name: "iCloud",           icon: "☁️", cadence: "monthly" },
  { id: "gym",         name: "Gym",              icon: "💪", cadence: "monthly" },
];
