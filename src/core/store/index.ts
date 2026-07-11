// ─── HerNest Global Store (Zustand) ──────────────────────────────
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export interface SchoolInfo {
  country: string;
  schoolType: "public" | "private" | "homeschool" | "other";
  grade?: string;
  district?: string;
  schoolName?: string;
  termDates?: Array<{ term: string; start: string; end: string }>;
  calendarEvents?: Array<{ id: string; title: string; date: string; endDate?: string; type: "holiday" | "inset" | "exam" | "event" | "other" }>;
}

export interface FamilyMember {
  id: string;
  name: string;
  role: "partner" | "child" | "parent" | "inlaw" | "other";
  // birthDate (full YYYY-MM-DD) is the source of truth — age is computed live
  // from it via displayAge(). `age` is a fallback for members entered without
  // a date of birth; it does NOT update over time.
  birthDate?: string;
  age?: number;
  notes?: string;
  color: string;
  schoolInfo?: SchoolInfo;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  avatar: string;
  city: string;
  role: string;
  kids: Array<{ id: string; name: string; age: number; school?: string }>;
  partner?: string;
  parents: Array<{ name: string; birthday?: string }>;
  inlaws: Array<{ name: string; birthday?: string }>;
  priorities: string[];
  tripGoal: string;
  fitnessGoal: string;
  savingsGoal: string;
  challenge: string;
  soloParent: boolean;
  energyPattern: "morning" | "evening" | "variable";
  diet: string;
  style?: { bodyShape: string; size: string; height: string; vibe: string; dressCode: string; budget: string };
}

export type HouseholdModule = "budget" | "calendar" | "family" | "trips" | "thrive" | "style" | "cleo" | "home" | "plan" | "circle";
export type InsightCategory = "spending" | "savings" | "debt" | "cashflow" | "stress" | "scheduling" | "family" | "health" | "decision" | "opportunity";

export interface HouseholdInsight {
  id: string;
  observation: string;
  whyItMatters: string;
  options: string[];
  recommendation: string;
  confidenceLevel: number;
  category: InsightCategory;
  sourceModules: HouseholdModule[];
  createdAt: string;
  dismissed?: boolean;
}

export interface ScenarioResult {
  id: string;
  question: string;
  financialImpact: string;
  tradeoffs: string[];
  riskLevel: "low" | "medium" | "high";
  recommendedAction: string;
  confidenceLevel: number;
  affectedModules: HouseholdModule[];
  createdAt: string;
}

export interface FinancialSnapshot {
  monthlyIncome: number;
  totalBudget: number;
  totalSpent: number;
  cashRemaining: number;
  savingsRate: number;
  totalDebt: number;
  debtToIncomeRatio: number;
  projectedMonthEnd: number;
  topOverspendCategories: string[];
  financialHealthScore: number;
  financialHealthGrade: "A" | "B" | "C" | "D" | "F" | "—";
}

export interface HouseholdSnapshot {
  financial: FinancialSnapshot & {
    upcomingTripObligation?: { name: string; amount: number; daysUntil: number };
  };
  calendarLoad: "light" | "normal" | "heavy" | "critical";
  busyWeeksAhead: number;
  activeGoals: Array<{ name: string; riskStatus: "on_track" | "at_risk" | "off_track" }>;
  householdStressLevel: "low" | "moderate" | "high";
  wellness?: { avgMood: number; avgSleep: number; weeklyScore: number };
  lastRefreshed: string;
}

export type HouseholdRole = "owner" | "partner" | "member";
export interface HouseholdMember {
  uid: string;
  role: HouseholdRole;
  displayName: string;
  email?: string;
  joinedAt: number;
}

interface AppStore {
  user: { uid: string; email: string; displayName: string | null } | null;
  authChecked: boolean;
  profile: UserProfile | null;
  familyMembers: FamilyMember[];
  activeTab: string;
  screen: "loading" | "login" | "onboarding" | "app";
  showMore: boolean;
  showSettings: boolean;
  showUpgrade: boolean;
  isPro: boolean;
  setIsPro: (v: boolean) => void;
  isOnline: boolean;
  dailyUsage: number;
  usageLimit: number;
  householdSnapshot: HouseholdSnapshot | null;
  householdInsights: HouseholdInsight[];
  activeScenario: ScenarioResult | null;
  householdRefreshing: boolean;
  currentHouseholdId: string | null;
  householdRole: HouseholdRole | null;
  householdMembers: HouseholdMember[];
  setUser: (user: AppStore["user"]) => void;
  setAuthChecked: (checked: boolean) => void;
  setProfile: (profile: UserProfile | null) => void;
  updateProfile: (partial: Partial<UserProfile>) => void;
  setFamilyMembers: (members: FamilyMember[]) => void;
  setScreen: (screen: AppStore["screen"]) => void;
  setActiveTab: (tab: string) => void;
  setShowMore: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setShowUpgrade: (show: boolean) => void;
  setIsOnline: (online: boolean) => void;
  incrementUsage: () => void;
  reset: () => void;
  setHouseholdSnapshot: (snap: HouseholdSnapshot) => void;
  setHouseholdInsights: (insights: HouseholdInsight[]) => void;
  addHouseholdInsight: (insight: HouseholdInsight) => void;
  dismissInsight: (id: string) => void;
  setActiveScenario: (scenario: ScenarioResult | null) => void;
  setHouseholdRefreshing: (refreshing: boolean) => void;
  setHousehold: (h: { householdId: string; role: HouseholdRole; members?: HouseholdMember[] }) => void;
  updateFinancialSnapshot: (snap: Partial<FinancialSnapshot>) => void;
}

const defaultFinancialSnapshot: FinancialSnapshot = {
  monthlyIncome: 0, totalBudget: 0, totalSpent: 0, cashRemaining: 0,
  savingsRate: 0, totalDebt: 0, debtToIncomeRatio: 0, projectedMonthEnd: 0,
  topOverspendCategories: [], financialHealthScore: 0, financialHealthGrade: "—",
};

export const useStore = create<AppStore>()(
  immer((set) => ({
    user: null, authChecked: false, profile: null, activeTab: "home",
    screen: "loading", showMore: false, showSettings: false, showUpgrade: false, isPro: false,
    isOnline: navigator.onLine, familyMembers: [], dailyUsage: 0, usageLimit: 500,
    householdSnapshot: null, householdInsights: [], activeScenario: null, householdRefreshing: false,
    currentHouseholdId: null, householdRole: null, householdMembers: [],
    setUser: (user) => set((s) => { s.user = user; }),
    setAuthChecked: (checked) => set((s) => { s.authChecked = checked; }),
    setProfile: (profile) => set((s) => { s.profile = profile; }),
    updateProfile: (partial) => set((s) => { if (s.profile) Object.assign(s.profile, partial); }),
    setFamilyMembers: (members) => set((s) => { s.familyMembers = members; }),
    setScreen: (screen) => set((s) => { s.screen = screen; }),
    setActiveTab: (tab) => set((s) => { s.activeTab = tab; }),
    setShowMore: (show) => set((s) => { s.showMore = show; }),
    setShowSettings: (show) => set((s) => { s.showSettings = show; }),
    setShowUpgrade: (show) => set((s) => { s.showUpgrade = show; }),
    setIsPro: (v) => set((s) => { s.isPro = v; }),
    setIsOnline: (online) => set((s) => { s.isOnline = online; }),
    incrementUsage: () => set((s) => { s.dailyUsage += 1; }),
    reset: () => set((s) => {
      s.user = null; s.profile = null; s.screen = "login";
      s.activeTab = "home"; s.dailyUsage = 0;
      s.householdSnapshot = null; s.householdInsights = []; s.activeScenario = null;
      s.currentHouseholdId = null; s.householdRole = null; s.householdMembers = [];
      // Residue from these leaked across accounts on shared devices
      s.isPro = false; s.familyMembers = [];
      s.showMore = false; s.showSettings = false; s.showUpgrade = false;
    }),
    setHouseholdSnapshot: (snap) => set((s) => { s.householdSnapshot = snap; }),
    setHouseholdInsights: (insights) => set((s) => { s.householdInsights = insights; }),
    addHouseholdInsight: (insight) => set((s) => {
      const exists = s.householdInsights.some(i => i.observation === insight.observation);
      if (!exists) s.householdInsights = [insight, ...s.householdInsights].slice(0, 20);
    }),
    dismissInsight: (id) => set((s) => {
      const idx = s.householdInsights.findIndex(i => i.id === id);
      if (idx !== -1) s.householdInsights[idx].dismissed = true;
    }),
    setActiveScenario: (scenario) => set((s) => { s.activeScenario = scenario; }),
    setHouseholdRefreshing: (refreshing) => set((s) => { s.householdRefreshing = refreshing; }),
    setHousehold: ({ householdId, role, members }) => set((s) => {
      s.currentHouseholdId = householdId;
      s.householdRole = role;
      if (members) s.householdMembers = members;
    }),
    updateFinancialSnapshot: (snap) => set((s) => {
      if (!s.householdSnapshot) {
        s.householdSnapshot = {
          financial: { ...defaultFinancialSnapshot, ...snap },
          calendarLoad: "normal", busyWeeksAhead: 0, activeGoals: [],
          householdStressLevel: "low", lastRefreshed: new Date().toISOString(),
        };
      } else {
        Object.assign(s.householdSnapshot.financial, snap);
        s.householdSnapshot.lastRefreshed = new Date().toISOString();
      }
    }),
  }))
);
