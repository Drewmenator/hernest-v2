// ─── HerNest Calendar Sync ────────────────────────────────────────
// Handles OAuth tokens for Google + Outlook calendars
// Tokens persisted in Firestore so they survive page refreshes

import { saveData, loadData } from "./firebase";

export interface CalendarToken {
  provider: "google" | "outlook";
  accessToken: string;
  expiresAt: number;
  email?: string;
  connectedAt: number;
}

export interface ConnectedCalendars extends Record<string, unknown> {
  google?: CalendarToken;
  outlook?: CalendarToken;
}

// ── Token Storage ─────────────────────────────────────────────────
export async function saveCalendarToken(
  userId: string,
  token: CalendarToken
): Promise<void> {
  const existing = await loadCalendarTokens(userId);
  const updated = { ...existing, [token.provider]: token };
  await saveData(userId, "calendar_tokens", updated);
}

export async function loadCalendarTokens(
  userId: string
): Promise<ConnectedCalendars> {
  const data = await loadData(userId, "calendar_tokens");
  return (data || {}) as ConnectedCalendars;
}

export async function removeCalendarToken(
  userId: string,
  provider: "google" | "outlook"
): Promise<void> {
  const existing = await loadCalendarTokens(userId);
  delete existing[provider];
  await saveData(userId, "calendar_tokens", existing);
}

export function isTokenValid(token?: CalendarToken): boolean {
  if (!token) return false;
  return token.expiresAt > Date.now();
}

// ── Google Calendar API ───────────────────────────────────────────
export async function fetchGoogleEvents(
  token: CalendarToken,
  timeMin?: string,
  timeMax?: string
): Promise<any[]> {
  const min = timeMin || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const max = timeMax || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${min}&timeMax=${max}&singleEvents=true&orderBy=startTime&maxResults=250`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } }
    );

    if (!res.ok) throw new Error(`Google API ${res.status}`);
    const data = await res.json();

    return (data.items || []).map((e: any) => ({
      id: `google-${e.id}`,
      title: e.summary || "Untitled",
      date: (e.start?.date || e.start?.dateTime || "").split("T")[0],
      time: e.start?.dateTime ? e.start.dateTime.split("T")[1]?.substring(0, 5) : undefined,
      source: "google" as const,
      color: "#4285F4",
      allDay: !!e.start?.date,
      location: e.location,
      notes: e.description,
    }));
  } catch (e) {
    console.error("[Calendar] Google fetch failed:", e);
    return [];
  }
}

// ── Outlook Calendar API ──────────────────────────────────────────
export async function fetchOutlookEvents(
  token: CalendarToken,
  timeMin?: string,
  timeMax?: string
): Promise<any[]> {
  const min = timeMin || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const max = timeMax || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${min}&endDateTime=${max}&$orderby=start/dateTime&$top=250`,
      { headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" } }
    );

    if (!res.ok) throw new Error(`Outlook API ${res.status}`);
    const data = await res.json();

    return (data.value || []).map((e: any) => ({
      id: `outlook-${e.id}`,
      title: e.subject || "Untitled",
      date: (e.start?.dateTime || "").split("T")[0],
      time: e.start?.dateTime ? e.start.dateTime.split("T")[1]?.substring(0, 5) : undefined,
      source: "work" as const,
      color: "#0078D4",
      allDay: e.isAllDay,
      location: e.location?.displayName,
      notes: e.bodyPreview,
    }));
  } catch (e) {
    console.error("[Calendar] Outlook fetch failed:", e);
    return [];
  }
}

// ── OAuth URL Builders ────────────────────────────────────────────
export function getGoogleAuthUrl(): string {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
  const redirectUri = `${window.location.origin}/auth/google/callback`;
  const scope = encodeURIComponent("https://www.googleapis.com/auth/calendar.readonly profile email");
  const state = btoa(JSON.stringify({ provider: "google", returnUrl: window.location.pathname }));
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${scope}&state=${state}&prompt=consent`;
}

export function getOutlookAuthUrl(): string {
  const clientId = import.meta.env.VITE_OUTLOOK_CLIENT_ID || "";
  const redirectUri = `${window.location.origin}/auth/outlook/callback`;
  const scope = encodeURIComponent("Calendars.Read User.Read offline_access");
  const state = btoa(JSON.stringify({ provider: "outlook", returnUrl: window.location.pathname }));
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${scope}&state=${state}&prompt=consent`;
}

// ── Parse OAuth callback hash ─────────────────────────────────────
export function parseOAuthHash(hash: string): { accessToken: string; expiresIn: number } | null {
  const params = new URLSearchParams(hash.replace("#", ""));
  const accessToken = params.get("access_token");
  const expiresIn = parseInt(params.get("expires_in") || "3600");
  if (!accessToken) return null;
  return { accessToken, expiresIn };
}
