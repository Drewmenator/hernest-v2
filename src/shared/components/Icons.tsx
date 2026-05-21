import React from "react";

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

const I = ({ size = 22, color = "currentColor", strokeWidth = 1.4, children }: IconProps & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const HomeIcon = (p: IconProps) => <I {...p}>
  <path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1H5a1 1 0 01-1-1V10.5z"/>
  <path d="M9 22V12h6v10"/>
</I>;

export const CleoIcon = (p: IconProps) => <I {...p}>
  <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
</I>;

export const PlanIcon = (p: IconProps) => <I {...p}>
  <rect x="3" y="3" width="18" height="18" rx="3"/>
  <path d="M8 12l3 3 5-5"/>
</I>;

export const BudgetIcon = (p: IconProps) => <I {...p}>
  <circle cx="12" cy="12" r="9"/>
  <path d="M12 7v1m0 8v1M9.5 9.5C9.5 8.7 10.6 8 12 8s2.5.7 2.5 1.5S13.4 11 12 11s-2.5.7-2.5 1.5S10.6 16 12 16s2.5-.7 2.5-1.5"/>
</I>;

export const BriefIcon = (p: IconProps) => <I {...p}>
  <circle cx="12" cy="12" r="4"/>
  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
</I>;

export const FamilyIcon = (p: IconProps) => <I {...p}>
  <path d="M3 11.5L12 4l9 7.5"/>
  <path d="M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9"/>
  <circle cx="12" cy="8" r="1.5" fill="currentColor" stroke="none"/>
</I>;

export const ThriveIcon = (p: IconProps) => <I {...p}>
  <path d="M12 22V12"/>
  <path d="M12 12C12 12 8 10 6 6c3 0 5.5 1.5 6 6z"/>
  <path d="M12 12C12 12 16 10 18 6c-3 0-5.5 1.5-6 6z"/>
  <path d="M12 12C12 12 10 16 7 17c1-3 3-4.5 5-5z"/>
</I>;

export const StyleIcon = (p: IconProps) => <I {...p}>
  <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.57a1 1 0 00.99.84H5v10a2 2 0 002 2h10a2 2 0 002-2V10h1.15a1 1 0 00.99-.84l.58-3.57a2 2 0 00-1.34-2.23z"/>
</I>;

export const TripsIcon = (p: IconProps) => <I {...p}>
  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
</I>;

export const CircleIcon = (p: IconProps) => <I {...p}>
  <circle cx="9" cy="8" r="3"/>
  <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
  <circle cx="17" cy="8" r="2.5"/>
  <path d="M21 20c0-2.8-1.8-5-4-5.5"/>
</I>;

export const CalendarIcon = (p: IconProps) => <I {...p}>
  <rect x="3" y="4" width="18" height="18" rx="2"/>
  <path d="M16 2v4M8 2v4M3 10h18"/>
</I>;

export const ProfileIcon = (p: IconProps) => <I {...p}>
  <circle cx="12" cy="8" r="4"/>
  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
</I>;

export const SettingsIcon = (p: IconProps) => <I {...p}>
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
</I>;

export const UpgradeIcon = (p: IconProps) => <I {...p}>
  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
</I>;

export const MoreIcon = (p: IconProps) => <I {...p}>
  <line x1="4" y1="7" x2="20" y2="7"/>
  <line x1="4" y1="12" x2="20" y2="12"/>
  <line x1="4" y1="17" x2="20" y2="17"/>
</I>;

// ── Additional in-app icons ───────────────────────────────────────
export const HeartIcon = (p: IconProps) => <I {...p}>
  <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
</I>;

export const StarIcon = (p: IconProps) => <I {...p}>
  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
</I>;

export const SparkleIcon = (p: IconProps) => <I {...p}>
  <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/>
</I>;

export const LeafIcon = (p: IconProps) => <I {...p}>
  <path d="M17 8C8 10 5.9 16.17 3.82 19.34 3.82 19.34 2 22 2 22c0 0 14-2 17-13 0 0 1-7-7-7z"/>
  <path d="M2 22l8-8"/>
</I>;

export const SunIcon = (p: IconProps) => <I {...p}>
  <circle cx="12" cy="12" r="4"/>
  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
</I>;

export const MoonIcon = (p: IconProps) => <I {...p}>
  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
</I>;

export const CheckIcon = (p: IconProps) => <I {...p}>
  <path d="M20 6L9 17l-5-5"/>
</I>;

export const PlusIcon = (p: IconProps) => <I {...p}>
  <line x1="12" y1="5" x2="12" y2="19"/>
  <line x1="5" y1="12" x2="19" y2="12"/>
</I>;

export const ArrowRightIcon = (p: IconProps) => <I {...p}>
  <line x1="5" y1="12" x2="19" y2="12"/>
  <polyline points="12 5 19 12 12 19"/>
</I>;

export const EditIcon = (p: IconProps) => <I {...p}>
  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
</I>;

export const TrashIcon = (p: IconProps) => <I {...p}>
  <polyline points="3 6 5 6 21 6"/>
  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
  <path d="M10 11v6M14 11v6"/>
  <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
</I>;

export const MapPinIcon = (p: IconProps) => <I {...p}>
  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
  <circle cx="12" cy="10" r="3"/>
</I>;

export const CameraIcon = (p: IconProps) => <I {...p}>
  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
  <circle cx="12" cy="13" r="4"/>
</I>;

export const BellIcon = (p: IconProps) => <I {...p}>
  <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
  <path d="M13.73 21a2 2 0 01-3.46 0"/>
</I>;

export const LockIcon = (p: IconProps) => <I {...p}>
  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
  <path d="M7 11V7a5 5 0 0110 0v4"/>
</I>;

export const GlobeIcon = (p: IconProps) => <I {...p}>
  <circle cx="12" cy="12" r="10"/>
  <line x1="2" y1="12" x2="22" y2="12"/>
  <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
</I>;

export const ShoppingBagIcon = (p: IconProps) => <I {...p}>
  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
  <line x1="3" y1="6" x2="21" y2="6"/>
  <path d="M16 10a4 4 0 01-8 0"/>
</I>;

export const RefreshIcon = (p: IconProps) => <I {...p}>
  <polyline points="23 4 23 10 17 10"/>
  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
</I>;

export const ChevronDownIcon = (p: IconProps) => <I {...p}>
  <polyline points="6 9 12 15 18 9"/>
</I>;

export const ChevronUpIcon = (p: IconProps) => <I {...p}>
  <polyline points="18 15 12 9 6 15"/>
</I>;

export const DocumentIcon = (p: IconProps) => <I {...p}>
  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
</I>;

export const PassportIcon = (p: IconProps) => <I {...p}>
  <rect x="3" y="2" width="18" height="20" rx="2"/>
  <circle cx="12" cy="11" r="3"/>
  <path d="M7 19h10"/>
  <path d="M9 15h6"/>
</I>;

export const WalletIcon = (p: IconProps) => <I {...p}>
  <path d="M21 4H3a2 2 0 00-2 2v12a2 2 0 002 2h18a2 2 0 002-2V6a2 2 0 00-2-2z"/>
  <path d="M16 14a2 2 0 100-4 2 2 0 000 4z" fill="currentColor" stroke="none"/>
</I>;

export const TrendingUpIcon = (p: IconProps) => <I {...p}>
  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
  <polyline points="17 6 23 6 23 12"/>
</I>;

export const ZapIcon = (p: IconProps) => <I {...p}>
  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
</I>;

export const MessageIcon = (p: IconProps) => <I {...p}>
  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
</I>;

export const UserPlusIcon = (p: IconProps) => <I {...p}>
  <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
  <circle cx="8.5" cy="7" r="4"/>
  <line x1="20" y1="8" x2="20" y2="14"/>
  <line x1="17" y1="11" x2="23" y2="11"/>
</I>;
