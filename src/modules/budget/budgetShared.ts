import { T } from "../../config/theme";
import { currencySymbol } from "../../shared/utils/money";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface Category {
  id: string;
  label: string;
  budget: number;
  spent: number;
  color: string;
  icon: string;
}

export interface Expense {
  id: string;
  amount: number;
  category: string;
  merchant: string;
  note: string;
  date: string;
  method: "manual" | "receipt" | "csv" | "plaid";
}

export interface Income {
  id: string;
  label: string;
  amount: number;
  frequency: "monthly" | "biweekly" | "weekly" | "annual";
  type: "salary" | "freelance" | "rental" | "other";
}

export interface Debt {
  id: string;
  label: string;
  balance: number;
  apr: number;
  minimumPayment: number;
  monthlyPayment: number;
  type: "credit_card" | "student_loan" | "car_loan" | "mortgage" | "personal" | "other";
  payoffDate?: string; // computed
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  cadence: "monthly" | "yearly" | "weekly" | "once";
  dueDay?: number;      // 1–31, for monthly
  dueDate?: string;     // YYYY-MM-DD anchor, for once/yearly/weekly
  category?: string;
  autopay?: boolean;
  lastPaidDate?: string; // YYYY-MM-DD
}

export interface FinancialGoal {
  id: string;
  name: string;
  type: "emergency_fund" | "vacation" | "school_fees" | "medical" | "home" | "car" | "debt_payoff" | "family_event" | "other";
  targetAmount: number;
  currentAmount: number;
  targetDate?: string;
  monthlyContribution: number;
  riskStatus: "on_track" | "at_risk" | "off_track";
  aiRecommendation?: string;
  linkedDebtId?: string;
}

export interface Scenario {
  id: string;
  question: string;
  result?: ScenarioResult;
  createdAt: string;
}

export interface ScenarioResult {
  financialImpact: string;
  tradeoffs: string[];
  riskLevel: "low" | "medium" | "high";
  recommendedAction: string;
  confidenceLevel: number;
}

export interface AIInsight {
  id: string;
  observation: string;
  whyItMatters: string;
  options: string[];
  recommendation: string;
  confidenceLevel: number;
  category: "spending" | "savings" | "debt" | "cashflow" | "stress";
  createdAt: string;
}

export interface FinancialHealthScore {
  score: number; // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  summary: string;
  breakdown: { label: string; score: number; color: string }[];
}

export interface MonthlyBudgetSummary {
  totalIncome: number;
  fixedExpenses: number;
  variableExpenses: number;
  cashRemaining: number;
  savingsRate: number;
  totalDebt: number;
  debtToIncomeRatio: number;
}

// ═══════════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════════

export const DEFAULT_CATS: Category[] = [
  { id: "groceries",     label: "Groceries",    budget: 700,  spent: 0, color: T.sage,  icon: "◈" },
  { id: "kids",          label: "Kids",          budget: 400,  spent: 0, color: T.sky,   icon: "🧒" },
  { id: "fitness",       label: "Fitness",       budget: 120,  spent: 0, color: T.blush, icon: "💪" },
  { id: "dining",        label: "Dining",        budget: 300,  spent: 0, color: T.gold,  icon: "◆" },
  { id: "shopping",      label: "Shopping",      budget: 500,  spent: 0, color: T.lav,   icon: "🛍" },
  { id: "transport",     label: "Transport",     budget: 200,  spent: 0, color: T.teal,  icon: "🚗" },
  { id: "health",        label: "Health",        budget: 200,  spent: 0, color: T.sage,  icon: "💊" },
  { id: "bills",         label: "Bills",         budget: 1000, spent: 0, color: T.bark,  icon: "◎" },
  { id: "entertainment", label: "Entertainment", budget: 150,  spent: 0, color: T.lav,   icon: "🎬" },
  { id: "subscriptions", label: "Subscriptions", budget: 100,  spent: 0, color: T.teal,  icon: "🔄" },
  { id: "childcare",     label: "Childcare",     budget: 600,  spent: 0, color: T.sky,   icon: "👶" },
  { id: "medical",       label: "Medical",       budget: 150,  spent: 0, color: T.blush, icon: "🏥" },
  { id: "other",         label: "Other",         budget: 200,  spent: 0, color: T.taupe, icon: "📦" },
];

export const GOAL_TYPES = [
  { id: "emergency_fund", label: "Emergency Fund", icon: "🛡" },
  { id: "vacation",       label: "Vacation",        icon: "✈️" },
  { id: "school_fees",    label: "School Fees",     icon: "🎓" },
  { id: "medical",        label: "Medical / Therapy", icon: "💊" },
  { id: "home",           label: "Home Purchase",   icon: "🏠" },
  { id: "car",            label: "Car Purchase",    icon: "🚗" },
  { id: "debt_payoff",    label: "Debt Payoff",     icon: "💳" },
  { id: "family_event",   label: "Family Event",    icon: "🎉" },
  { id: "other",          label: "Other",           icon: "🎯" },
];

export const getScenarioPrompts = (): string[] => [
  "Can we afford a vacation this summer?",
  `What if rent increases by ${currencySymbol()}300/month?`,
  "Can we hire a nanny?",
  "What if one parent stops working?",
  "Should we pay off the car loan early?",
  "Can we afford private school next year?",
  `What happens if we add ${currencySymbol()}200/month to savings?`,
  `Can we handle a ${currencySymbol()}5,000 emergency right now?`,
];

// ═══════════════════════════════════════════════════════════════════
// HELPER HOOKS & UTILS
// ═══════════════════════════════════════════════════════════════════

export function computePayoffDate(debt: Debt): string {
  if (debt.monthlyPayment <= 0 || debt.balance <= 0) return "—";
  const monthlyRate = debt.apr / 100 / 12;
  if (monthlyRate === 0) {
    const months = Math.ceil(debt.balance / debt.monthlyPayment);
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  const n = -Math.log(1 - (monthlyRate * debt.balance) / debt.monthlyPayment) / Math.log(1 + monthlyRate);
  if (!isFinite(n) || n < 0) return "Never (payment too low)";
  const d = new Date();
  d.setMonth(d.getMonth() + Math.ceil(n));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function computeTotalInterest(debt: Debt): number {
  const monthlyRate = debt.apr / 100 / 12;
  if (monthlyRate === 0) return 0;
  const n = -Math.log(1 - (monthlyRate * debt.balance) / debt.monthlyPayment) / Math.log(1 + monthlyRate);
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(debt.monthlyPayment * n - debt.balance);
}

export function gradeScore(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function gradeColor(grade: string): string {
  const map: Record<string, string> = { A: T.sage, B: T.teal, C: T.gold, D: T.blush, F: "#ff4444" };
  return map[grade] || T.taupe;
}
