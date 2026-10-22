// ─── "From your email" ─────────────────────────────────────────────
// The Gmail scan (api/_lib/familyMail.js: nightly, plus when the app opens,
// at most every 2 hours) puts the to-dos it finds
// (sign a form, RSVP, pay by a date, check in for a flight) in
// users/{uid}/data/mail_inbox. Nothing becomes a task until she taps Add.
// School and kids' activity dates go straight onto the shared calendar;
// other dates (doctor, travel, deadlines) wait here too, since her partner
// can see the calendar and this list is hers alone.
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth, loadData, saveData } from "./firebase";
import { createItem } from "./householdItems";
import { withTimeout } from "./timeout";

export type MailCategory = "school" | "activities" | "health" | "travel" | "deadline" | "other";

export interface MailItem {
  id: string;
  kind?: "task" | "event";   // older items have no kind: they're tasks
  title: string;
  dueDate?: string;
  date?: string;             // events
  time?: string;
  category: MailCategory;
  child?: string;
  from: string;
  subject: string;
  messageId: string;
  foundAt: number;
  status: "pending" | "added" | "dismissed";
}

export const pendingMailItems = (items: MailItem[] | undefined): MailItem[] =>
  (items || []).filter(i => i?.status === "pending")
    .sort((a, b) => (a.dueDate || a.date || "9999").localeCompare(b.dueDate || b.date || "9999"));

export const isMailEvent = (i: MailItem) => i.kind === "event" && !!i.date;

// "Sun, Nov 2 at 7:05 AM"
export function whenLabel(i: MailItem): string {
  if (!i.date) return "";
  const d = new Date(`${i.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return i.time ? `${d} at ${i.time}` : d;
}

// "due tomorrow", "due in 4 days", "due Nov 15".
export function dueLabel(dueDate: string | undefined, today: string): string {
  if (!dueDate) return "";
  const days = Math.round((new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000);
  if (days <= 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days < 7) return `due in ${days} days`;
  return `due ${new Date(`${dueDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

const CATEGORY_TO_TASK: Record<MailCategory, string> = {
  school: "School", activities: "family", health: "family", travel: "travel", deadline: "home", other: "personal",
};

// The Plan task an email item becomes once she taps Add.
export function taskFromMailItem(item: MailItem, uid: string, now = Date.now()) {
  return {
    id: `task_${item.id}`.slice(0, 200),
    title: item.title,
    createdBy: uid,
    category: CATEGORY_TO_TASK[item.category] || "personal",
    priority: item.dueDate ? "high" : "medium",
    status: "pending",
    source: item.category === "school" ? "school" : "email",
    energyRequired: "low",
    userConfirmed: true,
    createdAt: now,
    ...(item.dueDate ? { dueDate: item.dueDate } : {}),
  };
}

// The calendar entry an email date becomes once she taps Add to calendar.
export function eventFromMailItem(item: MailItem) {
  return {
    id: `cal_${item.id}`.slice(0, 200),
    title: item.title,
    date: item.date as string,
    source: "email",
    allDay: !item.time,
    ...(item.time ? { time: item.time } : {}),
  };
}

const inboxRef = (uid: string) => doc(db, "users", uid, "data", "mail_inbox");

export async function loadMailInbox(uid: string): Promise<{ items: MailItem[]; needsReconnect: boolean; connected: boolean }> {
  const [inbox, gmail] = await Promise.all([
    getDoc(inboxRef(uid)).catch(() => null),
    getDoc(doc(db, "users", uid, "integrations", "gmail")).catch(() => null),
  ]);
  return {
    items: pendingMailItems((inbox?.data()?.items as MailItem[]) || []),
    connected: !!gmail?.exists(),
    needsReconnect: gmail?.data()?.lastError === "reauth_required",
  };
}

async function setStatus(uid: string, id: string, status: MailItem["status"]) {
  const snap = await getDoc(inboxRef(uid));
  const items = ((snap.data()?.items as MailItem[]) || []).map(i => (i.id === id ? { ...i, status } : i));
  await setDoc(inboxRef(uid), { items }, { merge: true });
}

// Add: a to-do becomes a confirmed task in Plan; a date goes on the calendar.
export async function addMailItem(uid: string, item: MailItem): Promise<void> {
  if (isMailEvent(item)) {
    const event = eventFromMailItem(item);
    const existing = ((await loadData(uid, "calendar"))?.events as Array<{ id: string }>) || [];
    if (!existing.some(e => e.id === event.id)) await saveData(uid, "calendar", { events: [...existing, event] });
  } else {
    await createItem(uid, "tasks", taskFromMailItem(item, uid));
  }
  await setStatus(uid, item.id, "added");
}

export const dismissMailItem = (uid: string, id: string) => setStatus(uid, id, "dismissed");

export interface MailScanResult {
  scanned: number;
  eventsAdded: number;
  tasksFound: number;
  receiptsFound: number;
  error?: string;
}

// "Scan now": the server reads new family email and sorts it.
export async function scanMailNow(): Promise<MailScanResult> {
  noteScan();
  const empty = { scanned: 0, eventsAdded: 0, tasksFound: 0, receiptsFound: 0 };
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { ...empty, error: "not_authenticated" };
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
  const res = await fetch(`/api/connectors?provider=gmail&action=sync&tz=${encodeURIComponent(tz)}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res) return { ...empty, error: "sync_failed" };
  if (res.status === 401) return { ...empty, error: "reauth_required" };
  if (res.status === 429) return { ...empty, error: "limit_reached" };
  if (!res.ok) return { ...empty, error: "sync_failed" };
  return { ...empty, ...(await res.json()) };
}

// ── Scan on app open ──
// The server scans every inbox once a night; this also scans when HerNest
// opens or comes back, at most every 2 hours, so new school mail shows up
// the same day. Cheap: mail already read is skipped, and the AI only runs
// when new family mail came in (inside the household's daily limit).
// Screens re-read when MAIL_UPDATED fires.
export const MAIL_UPDATED = "hn-mail-updated";
const AUTO_SCAN_GAP_MS = 2 * 60 * 60 * 1000;
const SCAN_KEY = "hn_mail_scan_at";
let lastScan = 0;
let autoScanning = false;

function noteScan() {
  lastScan = Date.now();
  try { localStorage.setItem(SCAN_KEY, String(lastScan)); } catch { /* private mode */ }
}

function lastScanAt(): number {
  try { return Math.max(lastScan, Number(localStorage.getItem(SCAN_KEY)) || 0); } catch { return lastScan; }
}

export async function autoScanMail(): Promise<void> {
  if (autoScanning || Date.now() - lastScanAt() < AUTO_SCAN_GAP_MS) return;
  autoScanning = true;
  try {
    const r = await withTimeout(scanMailNow(), 60_000);
    if (r && typeof r === "object" && !r.error && r.scanned > 0) window.dispatchEvent(new Event(MAIL_UPDATED));
  } finally {
    autoScanning = false;
  }
}

export function onMailUpdated(fn: () => void): () => void {
  window.addEventListener(MAIL_UPDATED, fn);
  return () => window.removeEventListener(MAIL_UPDATED, fn);
}
