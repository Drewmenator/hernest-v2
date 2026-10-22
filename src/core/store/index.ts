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
  calendarEvents?: Array<{ id: string; title: string; date: string; endDate?: string; type: "holiday" | "no_school" | "inset" | "exam" | "event" | "other" }>;
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
  // Optional parts of the app, switched on in You → Extras. Missing means
  // "not chosen yet" (Trips then defaults to on only if trips are saved).
  extras?: { trips?: boolean };
}

// How full the household's week is (built by core/household/householdSnapshot.ts).
// The money, insight and scenario types went with the old Budget engines in
// simplify phase 3.
export interface HouseholdSnapshot {
  calendarLoad: "light" | "normal" | "heavy" | "critical";
  busyWeeksAhead: number;
  householdStressLevel: "low" | "moderate" | "high";
  upcomingTrip?: { name: string; daysUntil: number };
  wellness?: { avgMood: number; avgSleep: number };
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
  // A question to start the Cleo tab with (set by "Ask Cleo" buttons).
  isPro: boolean;
  setIsPro: (v: boolean) => void;
  isOnline: boolean;
  dailyUsage: number;
  usageLimit: number;
  householdSnapshot: HouseholdSnapshot | null;
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
  setHousehold: (h: { householdId: string; role: HouseholdRole; members?: HouseholdMember[] }) => void;
}

export const useStore = create<AppStore>()(
  immer((set) => ({
    user: null, authChecked: false, profile: null, activeTab: "home",
    screen: "loading", showMore: false, showSettings: false, showUpgrade: false, isPro: false,
    isOnline: navigator.onLine, familyMembers: [], dailyUsage: 0, usageLimit: 500,
    householdSnapshot: null,
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
      s.householdSnapshot = null;
      s.currentHouseholdId = null; s.householdRole = null; s.householdMembers = [];
      // Residue from these leaked across accounts on shared devices
      s.isPro = false; s.familyMembers = [];
      s.showMore = false; s.showSettings = false; s.showUpgrade = false;
    }),
    setHouseholdSnapshot: (snap) => set((s) => { s.householdSnapshot = snap; }),
    setHousehold: ({ householdId, role, members }) => set((s) => {
      s.currentHouseholdId = householdId;
      s.householdRole = role;
      if (members) s.householdMembers = members;
    }),
  }))
);
