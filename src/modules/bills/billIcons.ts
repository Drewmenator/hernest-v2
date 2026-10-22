// ─── Which icon each bill gets (see BillIcon.tsx) ───────────────────
import { T } from "../../config/theme";
import {
  House, Lightbulb, Flame, Droplet, Wifi, Smartphone, CreditCard, Car, ShieldCheck,
  HeartPulse, Baby, GraduationCap, Trash2, Clapperboard, Headphones, Sparkles, Tv,
  Package, Cloud, Dumbbell, Receipt, type LucideIcon,
} from "lucide-react";

export type Kind = "home" | "sub" | "family";
const BY_ID: Record<string, [LucideIcon, Kind]> = {
  rent: [House, "home"], electric: [Lightbulb, "home"], gas: [Flame, "home"], water: [Droplet, "home"],
  internet: [Wifi, "home"], phone: [Smartphone, "home"], credit_card: [CreditCard, "home"], car: [Car, "home"],
  car_ins: [ShieldCheck, "home"], health_ins: [HeartPulse, "family"], childcare: [Baby, "family"],
  student: [GraduationCap, "family"], trash: [Trash2, "home"], netflix: [Clapperboard, "sub"],
  spotify: [Headphones, "sub"], disney: [Sparkles, "sub"], hulu: [Tv, "sub"], prime: [Package, "sub"],
  icloud: [Cloud, "sub"], gym: [Dumbbell, "family"],
};
// Saved bills only have a name: match common words to the same icons.
const BY_WORD: [RegExp, string][] = [
  [/rent|mortgage|hoa/i, "rent"], [/electric|power|energy/i, "electric"], [/\bgas\b|propane/i, "gas"],
  [/water|sewer/i, "water"], [/internet|wifi|broadband|comcast|xfinity|spectrum/i, "internet"],
  [/phone|mobile|verizon|at&t|t-mobile|cell/i, "phone"], [/credit|card|amex|visa|discover/i, "credit_card"],
  [/daycare|childcare|nanny|preschool|sitter/i, "childcare"],
  [/car insurance|auto insurance|geico|progressive|allstate/i, "car_ins"], [/\bcar\b|\bauto\b|vehicle/i, "car"],
  [/health|medical|dental|vision|insurance/i, "health_ins"],
  [/student|loan|tuition|school/i, "student"], [/trash|garbage|waste/i, "trash"], [/netflix|movie/i, "netflix"],
  [/spotify|music|audible/i, "spotify"], [/disney/i, "disney"], [/hulu|tv|youtube|hbo|max|peacock|paramount|stream/i, "hulu"],
  [/prime|amazon/i, "prime"], [/icloud|google one|dropbox|storage/i, "icloud"], [/gym|fitness|yoga|peloton/i, "gym"],
];

export const KIND: Record<Kind, { bg: string; ink: string }> = {
  home:   { bg: T.householdBg, ink: T.householdInk },
  sub:    { bg: T.planBg,      ink: T.planInk },
  family: { bg: T.personalBg,  ink: T.personalInk },
};

export function billIconFor(name: string, presetId?: string): [LucideIcon, Kind] {
  if (presetId && BY_ID[presetId]) return BY_ID[presetId];
  const hit = BY_WORD.find(([re]) => re.test(name));
  return hit ? BY_ID[hit[1]] : [Receipt, "home"];
}

