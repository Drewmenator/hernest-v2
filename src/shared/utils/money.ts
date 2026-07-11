// ─── Money formatting ────────────────────────────────────────────────
// Currency was hardcoded to "$" everywhere. Now it's a per-user setting
// (profile.currency, default "USD") so a household in Lagos can see ₦ and Cleo
// speaks the same currency. formatMoney is the single place UI money is built.
import { useStore } from "../../core/store";

const SYMBOLS: Record<string, string> = {
  USD: "$", NGN: "₦", GBP: "£", EUR: "€", CAD: "C$", AUD: "A$",
  GHS: "₵", KES: "KSh", ZAR: "R", INR: "₹", JPY: "¥",
};

export const SUPPORTED_CURRENCIES: { code: string; label: string }[] = [
  { code: "USD", label: "$ US Dollar" },
  { code: "NGN", label: "₦ Naira" },
  { code: "GBP", label: "£ Pound" },
  { code: "EUR", label: "€ Euro" },
  { code: "CAD", label: "C$ Canadian Dollar" },
  { code: "GHS", label: "₵ Cedi" },
  { code: "KES", label: "KSh Shilling" },
  { code: "ZAR", label: "R Rand" },
  { code: "INR", label: "₹ Rupee" },
];

export function currencySymbol(code?: string): string {
  return SYMBOLS[(code || "USD").toUpperCase()] || "$";
}

// The active currency code, read live from the signed-in user's profile.
export function getCurrency(): string {
  try { return (useStore.getState().profile as any)?.currency || "USD"; } catch { return "USD"; }
}

// Format a number as money in the active (or given) currency. Whole units.
export function formatMoney(n: number, code?: string): string {
  const value = Math.round(Number(n) || 0);
  return `${currencySymbol(code || getCurrency())}${value.toLocaleString()}`;
}
