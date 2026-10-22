// ─── "From your email" ─────────────────────────────────────────────
// The nightly Gmail scan (api/_lib/familyMail.js) puts the to-dos it finds
// (sign a form, RSVP, pay by a date, check in for a flight) in
// users/{uid}/data/mail_inbox. Nothing becomes a task until she taps Add.
// Dates it finds go straight onto the calendar.
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth, loadData, saveData } from "./firebase";

export type MailCategory = "school" | "activities" | "health" | "travel" | "deadline" | "other";

export interface MailItem {
  id: string;
  title: string;
  dueDate?: string;
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
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));

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
export function taskFromMailItem(item: MailItem, now = Date.now()) {
  return {
    id: `task_${item.id}`.slice(0, 200),
    title: item.title,
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

// Add: becomes a confirmed task in Plan. (When tasks move to one record per
// item, swap the two task lines for createItem(uid, "tasks", task).)
export async function addMailItem(uid: string, item: MailItem): Promise<void> {
  const task = taskFromMailItem(item);
  const existing = ((await loadData(uid, "tasks"))?.tasks as Array<{ id: string }>) || [];
  if (!existing.some(t => t.id === task.id)) await saveData(uid, "tasks", { tasks: [...existing, task] });
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
