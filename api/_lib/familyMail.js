// ─── Family email scan (Gmail → calendar + "From your email" list) ──
// Finds the emails that matter to a busy family (school, kids' activities,
// doctor and dentist visits, travel, deadlines, receipts), reads them, and
// asks Cleo to pull out:
//   events   → the household calendar (calendar_synced, source "gmail")
//   tasks    → users/{uid}/data/mail_inbox, waiting for her to tap Add
//   receipts → users/{uid}/data/gmail_receipts (reviewed in Bills later)
// Runs nightly from /api/cron and on "Scan now" in Connections. Each email is
// read once (processedIds), so a rescan costs nothing for mail already seen.
// Read-only Gmail access; email bodies are never stored.
import { buildUpstreamBody } from "./claudeRequest.js";
import { householdIdFor, takeQuota, recordUsage, normalizeUsage } from "./aiUsage.js";

// ── Who sends family mail in the US ────────────────────────────────
// School platforms and district systems, kids' activities, health portals,
// travel. Matched on the sender's address or display name.
export const SENDER_DOMAINS = {
  school: [
    "skyward.com", "parentsquare.com", "schoolmessenger.com", "powerschool.com", "infinitecampus.com",
    "instructure.com", "classroom.google.com", "seesaw.me", "classdojo.com", "remind.com", "bloomz.net",
    "talkingpts.org", "peachjar.com", "schoology.com", "finalsite.com", "blackboard.com", "myschoolbucks.com",
    "schoolcashonline.com", "brightwheel.com", "procareconnect.com", "tylertech.com", "aeries.com",
  ],
  activities: [
    "teamsnap.com", "signupgenius.com", "gc.com", "gamechanger.io", "sportsengine.com", "leagueapps.com",
    "jackrabbitclass.com", "mindbodyonline.com", "evite.com", "punchbowl.com", "paperlesspost.com", "campminder.com",
  ],
  health: ["mychart.org", "followmyhealth.com", "zocdoc.com", "healow.com", "solutionreach.com", "weave.com"],
  travel: [
    "united.com", "delta.com", "aa.com", "southwest.com", "jetblue.com", "alaskaair.com", "spirit.com",
    "expedia.com", "booking.com", "airbnb.com", "vrbo.com", "marriott.com", "hilton.com", "hyatt.com", "tripit.com",
  ],
};

// Display-name words that mark a district or school (e.g. "Katy ISD").
const SENDER_WORDS = ["isd", "k12", "\"school district\"", "elementary", "\"middle school\"", "\"high school\"", "pta", "pto", "academy"];

export const SUBJECT_WORDS = {
  school: ["school", "\"permission slip\"", "\"field trip\"", "classroom", "teacher", "\"report card\"", "conference", "\"picture day\"", "\"early release\"", "\"no school\"", "homework", "lunch"],
  activities: ["practice", "game", "tournament", "recital", "rehearsal", "tryouts", "camp", "\"birthday party\"", "invitation", "rsvp", "season"],
  health: ["appointment", "\"appointment reminder\"", "dentist", "pediatric", "vaccine", "checkup", "prescription"],
  travel: ["flight", "itinerary", "\"boarding pass\"", "\"check in\"", "booking", "reservation", "confirmation", "hotel", "trip"],
  deadline: ["deadline", "due", "\"due date\"", "\"payment due\"", "\"past due\"", "\"action required\"", "reminder", "registration", "enroll", "renewal", "expires", "\"last day\"", "\"sign up\"", "form", "schedule", "calendar"],
};

const RECEIPT_SUBJECTS = ["receipt", "order", "invoice", "\"payment confirmation\""];

// Mailbox providers: never "learn" these as a school or club domain.
const PERSONAL_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "aol.com", "msn.com", "comcast.net", "att.net"]);

const or = (xs) => `(${xs.join(" OR ")})`;

// Gmail searches, one per category. Promotions are skipped so sales email
// doesn't crowd out the real thing. learnedDomains: senders that produced
// school or activity items before (e.g. katyisd.org).
export function buildQueries({ learnedDomains = [], days = 14 } = {}) {
  const base = `newer_than:${days}d -category:promotions`;
  const q = [
    { category: "school", q: `${base} (from:${or(SENDER_DOMAINS.school)} OR from:${or(SENDER_WORDS)} OR subject:${or(SUBJECT_WORDS.school)})` },
    { category: "activities", q: `${base} (from:${or(SENDER_DOMAINS.activities)} OR subject:${or(SUBJECT_WORDS.activities)})` },
    { category: "health", q: `${base} (from:${or(SENDER_DOMAINS.health)} OR subject:${or(SUBJECT_WORDS.health)})` },
    { category: "travel", q: `newer_than:30d (from:${or(SENDER_DOMAINS.travel)} OR subject:${or(SUBJECT_WORDS.travel)})` },
    { category: "deadline", q: `${base} subject:${or(SUBJECT_WORDS.deadline)}` },
    { category: "receipt", q: `${base} subject:${or(RECEIPT_SUBJECTS)}` },
  ];
  const learned = learnedDomains.filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)).slice(0, 30);
  if (learned.length) q.unshift({ category: "school", q: `${base} from:${or(learned)}` });
  return q;
}

export function senderDomain(from) {
  const m = String(from || "").match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return m ? m[1].toLowerCase() : "";
}

// A district or school address we can learn from, e.g. katyisd.org,
// lausd.k12.ca.us, springfieldschools.org.
export function looksLikeSchoolDomain(domain) {
  return /(^|\.)[a-z0-9-]*isd\.(org|net|us|com)$/.test(domain)
    || /\.k12\.[a-z]{2}\.us$/.test(domain)
    || /(^|[.-])k12\./.test(domain)
    || /schools?\.(org|net|us)$/.test(domain);
}

// ── Reading an email ───────────────────────────────────────────────
function b64url(data) {
  try { return Buffer.from(String(data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); }
  catch { return ""; }
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, "\"");
}

// Plain-text body of a Gmail "full" message, trimmed for the AI. Prefers the
// text/plain part; falls back to the HTML part with tags removed.
export function messageText(payload, maxChars = 1800) {
  let plain = "", html = "";
  const walk = (p) => {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data && !plain) plain = b64url(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data && !html) html = b64url(p.body.data);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  const text = plain || (html ? htmlToText(html) : "");
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, maxChars);
}

const header = (msg, name) => (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

// Lists matching messages, skips ones already read, and fetches up to `max`
// full emails. Returns [{ id, category, from, subject, date, text }].
export async function fetchFamilyMail(accessToken, { queries, processed = new Set(), max = 20, perQuery = 10, fetchImpl = fetch }) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const picked = new Map();
  for (const { category, q } of queries) {
    if (picked.size >= max) break;
    try {
      const r = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${perQuery}`, { headers });
      if (r.status === 401) throw Object.assign(new Error("reauth_required"), { reauth: true });
      const list = await r.json();
      for (const m of list.messages || []) {
        if (picked.size >= max) break;
        if (!processed.has(m.id) && !picked.has(m.id)) picked.set(m.id, category);
      }
    } catch (e) {
      if (e.reauth) throw e;
      console.error("[FamilyMail] query failed:", category, e?.message);
    }
  }
  const out = [];
  for (const [id, category] of picked) {
    try {
      const msg = await (await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers })).json();
      out.push({
        id, category,
        from: header(msg, "From"), subject: header(msg, "Subject"), date: header(msg, "Date"),
        text: messageText(msg.payload) || String(msg.snippet || ""),
      });
    } catch (e) { console.error("[FamilyMail] message read failed:", e?.message); }
  }
  return out;
}

// ── What Cleo pulls out ────────────────────────────────────────────
const CATEGORIES = ["school", "activities", "health", "travel", "deadline", "other"];
const nul = (t) => ({ anyOf: [t, { type: "null" }] });
const str = { type: "string" };
const date = { type: "string", description: "YYYY-MM-DD" };
const obj = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });

export const EXTRACT_SCHEMA = obj({
  events: { type: "array", items: obj({
    email: { type: "integer", description: "number of the email it came from" },
    title: str, date, time: nul({ type: "string", description: "like 3:30 PM" }),
    category: { type: "string", enum: CATEGORIES }, child: nul(str),
  }) },
  tasks: { type: "array", items: obj({
    email: { type: "integer" }, title: str, dueDate: nul(date),
    category: { type: "string", enum: CATEGORIES }, child: nul(str),
  }) },
  receipts: { type: "array", items: obj({
    email: { type: "integer" }, merchant: str, amount: { type: "number" }, date,
    category: { type: "string", enum: ["groceries", "dining", "shopping", "transport", "kids", "home", "other"] },
  }) },
});

export function extractionPrompt({ today, kids = [] }) {
  const kidLine = kids.length ? `Her kids: ${kids.join(", ")}. Set "child" when an email is clearly about one of them, else null.` : `Set "child" to null.`;
  return `You are Cleo, reading a busy mom's recent email to catch what her family needs to do and where they need to be.
Today is ${today}. ${kidLine}
Only use what the emails actually say. Never invent dates, times, amounts or details.
- events: things happening on a date she should see on the calendar (school closures, games, recitals, appointments, conferences, flights, hotel stays). Include the time if given. A flight's title names the airline, flight number and route.
- tasks: things she has to do (sign or return a form, pay, RSVP, register, bring something, send money, renew, check in for a flight). Short action titles like "Sign Emma's field trip form". dueDate is the deadline if given.
- receipts: purchases with a visible amount.
- An email with a schedule (a season of games, a payment plan, a list of due dates) gives one event per upcoming date, or one task per upcoming payment, up to 12.
Skip dates in the past, marketing, newsletters with nothing to act on, and anything already done. One email can give an event and a task. Return empty lists if nothing applies.`;
}

export function formatEmails(emails) {
  return emails.map((e, i) => `--- Email ${i} (${e.category}) ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\n${e.text}`).join("\n\n");
}

// One server-side AI call, inside the household's pilot limits and recorded
// in its cost report. Returns the reply text, or { error }.
export async function callClaude(db, { uid, feature, system, prompt, schema, fetchImpl = fetch }) {
  const built = buildUpstreamBody({ feature, system, prompt, schema });
  if (built.error) return { error: built.error };
  const householdId = await householdIdFor(db, uid);
  const quota = await takeQuota(db, { uid, householdId });
  if (!quota.ok) return { error: quota.reason };
  const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(built.upstream),
  });
  if (!r.ok) {
    console.error("[FamilyMail] Anthropic error:", r.status);
    return { error: "ai_unavailable" };
  }
  const data = await r.json();
  await recordUsage(db, { householdId, uid, feature, model: built.upstream.model, usage: normalizeUsage(data.usage) });
  const text = (data.content || []).find((b) => b?.type === "text")?.text || "";
  return { text };
}

// ── Putting results where they belong ──────────────────────────────
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
const clip = (s, n) => String(s || "").trim().slice(0, n);

// Pure: turns the AI's answer into calendar events, inbox tasks, receipts
// and newly learned sender domains. Drops anything malformed or past.
export function routeExtraction(extracted, emails, { today, foundAt = Date.now() }) {
  const src = (i) => (Number.isInteger(i) && emails[i]) || null;
  const events = [], tasks = [], receipts = [], learned = new Set();
  for (const e of extracted?.events || []) {
    const m = src(e?.email);
    if (!m || !e.title || !ISO.test(e.date || "") || e.date < today) continue;
    events.push({
      id: `gmail_${m.id}_${slug(e.title)}_${e.date}`, title: clip(e.title, 120), date: e.date,
      ...(e.time ? { time: clip(e.time, 20) } : {}), allDay: !e.time,
      source: "gmail", color: "#C9A961", category: CATEGORIES.includes(e.category) ? e.category : "other",
      ...(e.child ? { child: clip(e.child, 40) } : {}),
    });
    if (e.category === "school" || e.category === "activities") learned.add(senderDomain(m.from));
  }
  for (const t of extracted?.tasks || []) {
    const m = src(t?.email);
    if (!m || !t.title) continue;
    const due = ISO.test(t.dueDate || "") ? t.dueDate : null;
    if (due && due < today) continue;
    tasks.push({
      id: `gmail_${m.id}_${slug(t.title)}`, title: clip(t.title, 120), ...(due ? { dueDate: due } : {}),
      category: CATEGORIES.includes(t.category) ? t.category : "other", ...(t.child ? { child: clip(t.child, 40) } : {}),
      from: clip(m.from.replace(/<[^>]*>/g, ""), 80), subject: clip(m.subject, 140), messageId: m.id,
      foundAt, status: "pending",
    });
    if (t.category === "school" || t.category === "activities") learned.add(senderDomain(m.from));
  }
  for (const r of extracted?.receipts || []) {
    const m = src(r?.email);
    if (!m || !r.merchant || typeof r.amount !== "number" || r.amount <= 0 || !ISO.test(r.date || "")) continue;
    receipts.push({ merchant: clip(r.merchant, 80), amount: r.amount, date: r.date, category: r.category || "other" });
  }
  const learnedDomains = [...learned].filter((d) => d && !PERSONAL_DOMAINS.has(d));
  return { events, tasks, receipts, learnedDomains };
}

// ── The whole scan for one mailbox ─────────────────────────────────
export const INBOX_DOC = "mail_inbox";
const MAX_PROCESSED = 500;
const MAX_INBOX = 60;

export async function scanFamilyMail(db, { uid, accessToken, today, fetchImpl = fetch, now = Date.now() }) {
  const inboxRef = db.doc(`users/${uid}/data/${INBOX_DOC}`);
  const inbox = (await inboxRef.get()).data() || {};
  const processed = new Set(inbox.processedIds || []);
  const learnedDomains = inbox.learnedDomains || [];

  const emails = await fetchFamilyMail(accessToken, { queries: buildQueries({ learnedDomains }), processed, fetchImpl });
  const result = { scanned: emails.length, eventsAdded: 0, tasksFound: 0, receiptsFound: 0 };
  if (!emails.length) {
    await inboxRef.set({ lastScanAt: now }, { merge: true });
    return result;
  }

  const profile = (await db.doc(`users/${uid}/data/profile`).get()).data() || {};
  const kids = (Array.isArray(profile.kids) ? profile.kids : []).map((k) => k?.name).filter(Boolean).slice(0, 8);
  const ai = await callClaude(db, {
    uid, feature: "gmail_extract", system: extractionPrompt({ today, kids }), prompt: formatEmails(emails),
    schema: EXTRACT_SCHEMA, fetchImpl,
  });
  // Not marked as read: the next scan tries these emails again.
  if (ai.error) return { ...result, error: ai.error };
  let extracted;
  try { extracted = JSON.parse(ai.text); } catch { return { ...result, error: "parse_failed" }; }

  const routed = routeExtraction(extracted, emails, { today, foundAt: now });

  // Events → household calendar
  if (routed.events.length) {
    const owner = await householdIdFor(db, uid);
    const calRef = db.doc(`users/${owner}/data/calendar_synced`);
    const existing = (await calRef.get()).data()?.events || [];
    const byId = new Map(existing.map((e) => [e.id, e]));
    for (const e of routed.events) if (!byId.has(e.id)) { byId.set(e.id, e); result.eventsAdded++; }
    if (result.eventsAdded) await calRef.set({ events: [...byId.values()] }, { merge: true });
  }

  // Receipts → review list (deduped by merchant + date + amount)
  if (routed.receipts.length) {
    const recRef = db.doc(`users/${uid}/data/gmail_receipts`);
    const existing = (await recRef.get()).data()?.receipts || [];
    const seen = new Set(existing.map((r) => `${r.merchant}_${r.date}_${r.amount}`));
    const fresh = routed.receipts.filter((r) => !seen.has(`${r.merchant}_${r.date}_${r.amount}`));
    result.receiptsFound = fresh.length;
    if (fresh.length) {
      await recRef.set({ receipts: [...fresh.map((r) => ({ ...r, foundAt: now, status: "pending" })), ...existing].slice(0, 100) }, { merge: true });
    }
  }

  // Tasks → "From your email" list; mark every email read
  const items = inbox.items || [];
  const have = new Set(items.map((t) => t.id));
  const newTasks = routed.tasks.filter((t) => !have.has(t.id));
  result.tasksFound = newTasks.length;
  await inboxRef.set({
    items: [...newTasks, ...items].slice(0, MAX_INBOX),
    processedIds: [...emails.map((e) => e.id), ...(inbox.processedIds || [])].slice(0, MAX_PROCESSED),
    learnedDomains: [...new Set([...routed.learnedDomains, ...learnedDomains])].slice(0, 30),
    lastScanAt: now,
  }, { merge: true });
  return result;
}
