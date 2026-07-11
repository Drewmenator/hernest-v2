// ─── Gmail intelligence (Wave 2) ───────────────────────────────────
// Pulls categorized message summaries from /api/connectors (gmail sync),
// runs Cleo extraction, and routes results:
//   school/travel events → calendar_synced (source "gmail")
//   receipts             → gmail_receipts inbox (reviewed in Budget later)
import { auth, loadData, saveData } from "./firebase";
import { aiJSON } from "./ai";
import { bus } from "./events";
import { todayLocal } from "./dateAwareness";

interface GmailMessage { id: string; category: string; subject: string; from: string; date: string; snippet: string; }

interface Extraction {
  events: { title: string; date: string; time?: string | null }[];
  receipts: { merchant: string; amount: number; date: string; category: string }[];
}

export interface GmailScanResult {
  scanned: number;
  eventsAdded: number;
  receiptsFound: number;
  error?: string;
}

export async function scanGmail(uid: string): Promise<GmailScanResult> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { scanned: 0, eventsAdded: 0, receiptsFound: 0, error: "not_authenticated" };

  const res = await fetch("/api/connectors?provider=gmail&action=sync", {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res || !res.ok) {
    return { scanned: 0, eventsAdded: 0, receiptsFound: 0, error: res?.status === 401 ? "reauth_required" : "sync_failed" };
  }
  const { messages } = (await res.json()) as { messages: GmailMessage[] };
  if (!messages?.length) return { scanned: 0, eventsAdded: 0, receiptsFound: 0 };

  const today = todayLocal();
  const msgList = messages.map(m =>
    `[${m.category}] From: ${m.from} | Subject: ${m.subject} | Date: ${m.date} | ${m.snippet}`
  ).join("\n");

  const sys = `You are Cleo extracting structured household data from email summaries.
ONLY extract what is explicitly present — never invent merchants, amounts, or dates.
Today: ${today}. Return ONLY valid JSON:
{
  "events": [{"title":"string","date":"YYYY-MM-DD","time":"string or null"}],
  "receipts": [{"merchant":"string","amount":0.00,"date":"YYYY-MM-DD","category":"groceries|dining|shopping|transport|kids|home|other"}]
}
Rules: events only for school/travel items with a clear future date. Receipts only where an amount is visible. Skip marketing emails.`;

  const extracted = await aiJSON<Extraction>(sys, msgList, "gmail_extract", { events: [], receipts: [] });

  // Route events → calendar_synced
  let eventsAdded = 0;
  const validEvents = (extracted.events || []).filter(e => e?.title && /^\d{4}-\d{2}-\d{2}$/.test(e?.date || ""));
  if (validEvents.length) {
    const existing = ((await loadData(uid, "calendar_synced"))?.events as any[]) || [];
    const byId = new Map<string, any>(existing.map((e: any) => [e.id, e]));
    for (const e of validEvents) {
      const id = `gmail_${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}_${e.date}`;
      if (!byId.has(id)) {
        byId.set(id, { id, title: e.title, date: e.date, time: e.time || undefined, source: "gmail", color: "#C9A961", allDay: !e.time });
        eventsAdded++;
      }
    }
    if (eventsAdded) {
      await saveData(uid, "calendar_synced", { events: [...byId.values()] });
      bus.publish("calendar.synced", { source: "gmail", count: eventsAdded }, { userId: uid, source: "gmail" }).catch(() => {});
    }
  }

  // Route receipts → gmail_receipts inbox (deduped by merchant+date+amount)
  let receiptsFound = 0;
  const validReceipts = (extracted.receipts || []).filter(r => r?.merchant && typeof r?.amount === "number" && r.amount > 0);
  if (validReceipts.length) {
    const existing = ((await loadData(uid, "gmail_receipts"))?.receipts as any[]) || [];
    const seen = new Set(existing.map((r: any) => `${r.merchant}_${r.date}_${r.amount}`));
    const fresh = validReceipts.filter(r => !seen.has(`${r.merchant}_${r.date}_${r.amount}`));
    receiptsFound = fresh.length;
    if (fresh.length) {
      await saveData(uid, "gmail_receipts", {
        receipts: [...fresh.map(r => ({ ...r, foundAt: Date.now(), status: "pending" })), ...existing].slice(0, 100),
      });
      bus.publish("budget.receipts.found", { count: fresh.length }, { userId: uid, source: "gmail" }).catch(() => {});
    }
  }

  return { scanned: messages.length, eventsAdded, receiptsFound };
}
