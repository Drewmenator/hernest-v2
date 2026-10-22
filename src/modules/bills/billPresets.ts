// ─── Common US household bills for the tap-only setup ───────────────
// Icons live in BillIcon.tsx (by id).
import type { Cadence } from "../../core/bills";

export interface BillPreset {
  id: string;
  name: string;
  cadence: Cadence;
  varies?: boolean;   // amount changes month to month
}

export const BILL_PRESETS: BillPreset[] = [
  { id: "rent",        name: "Rent or mortgage", cadence: "monthly" },
  { id: "electric",    name: "Electric",         cadence: "monthly", varies: true },
  { id: "gas",         name: "Gas",              cadence: "monthly", varies: true },
  { id: "water",       name: "Water",            cadence: "monthly", varies: true },
  { id: "internet",    name: "Internet",         cadence: "monthly" },
  { id: "phone",       name: "Phone",            cadence: "monthly" },
  { id: "credit_card", name: "Credit card",      cadence: "monthly", varies: true },
  { id: "car",         name: "Car payment",      cadence: "monthly" },
  { id: "car_ins",     name: "Car insurance",    cadence: "monthly" },
  { id: "health_ins",  name: "Health insurance", cadence: "monthly" },
  { id: "childcare",   name: "Childcare",        cadence: "monthly" },
  { id: "student",     name: "Student loan",     cadence: "monthly" },
  { id: "trash",       name: "Trash",            cadence: "monthly" },
  { id: "netflix",     name: "Netflix",          cadence: "monthly" },
  { id: "spotify",     name: "Spotify",          cadence: "monthly" },
  { id: "disney",      name: "Disney+",          cadence: "monthly" },
  { id: "hulu",        name: "Hulu",             cadence: "monthly" },
  { id: "prime",       name: "Amazon Prime",     cadence: "monthly" },
  { id: "icloud",      name: "iCloud",           cadence: "monthly" },
  { id: "gym",         name: "Gym",              cadence: "monthly" },
];
