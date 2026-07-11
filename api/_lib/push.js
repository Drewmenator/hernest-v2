// ─── Push sender (server) ──────────────────────────────────────────
// Sends FCM notifications to a user's registered devices and prunes tokens
// FCM reports as dead. Import from cron/event handlers; not a route itself.
import { getMessaging } from "firebase-admin/messaging";
import { adminDb } from "./secure.js";
import { isBirthdayToday, turningAge, daysUntilBirthday, todayISO } from "./dates.js";
import { daysUntilDue } from "./bills.js";

// Send one notification to every device registered under users/{uid}/devices.
// Returns { sent, pruned }. Safe to call when the user has no devices.
export async function sendPushToUser(uid, { title, body, data = {} }) {
  const snap = await adminDb.collection(`users/${uid}/devices`).get();
  const tokens = snap.docs.map(d => d.id).filter(Boolean);
  if (!tokens.length) return { sent: 0, pruned: 0 };

  // FCM data payload values must be strings.
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: stringData,
    apns: { payload: { aps: { sound: "default" } } },
  });

  // Remove tokens FCM says are no longer valid so we don't keep retrying them.
  let pruned = 0;
  await Promise.all(res.responses.map(async (r, i) => {
    if (r.success) return;
    const code = r.error?.code || "";
    if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
      pruned++;
      await adminDb.doc(`users/${uid}/devices/${tokens[i]}`).delete().catch(() => {});
    }
  }));

  return { sent: res.successCount, pruned };
}

// calendar_synced is household-scoped (partners' data under the primary uid).
async function ownerFor(uid) {
  try {
    const link = await adminDb.doc(`users/${uid}/data/household_link`).get();
    return (link.exists ? link.data()?.primaryUid : null) || uid;
  } catch { return uid; }
}

async function docData(path) {
  try { return (await adminDb.doc(path).get()).data() || {}; } catch { return {}; }
}

// Everyone with a birthday the user tracks: household family roster (has full
// DOBs) + profile kids/parents/inlaws/partner + circle contacts. Deduped by
// name, preferring a full "YYYY-MM-DD" so we can compute the age they turn.
// family/circle are household-scoped, so read them from the household owner.
async function birthdayPeople(uid) {
  const owner = await ownerFor(uid);
  const map = new Map();
  const add = (name, date) => {
    if (!name || !date) return;
    const key = String(name).trim().toLowerCase();
    const cur = map.get(key);
    if (!cur || (String(date).length >= 10 && String(cur.date).length < 10)) map.set(key, { name, date });
  };
  const family = await docData(`users/${owner}/data/family`);
  for (const m of (family.members || [])) add(m?.name, m?.birthDate || m?.birthday);
  const profile = await docData(`users/${uid}/data/profile`);
  for (const k of (profile.kids || profile.children || [])) add(k?.name, k?.birthDate || k?.birthday);
  for (const p of (profile.parents || [])) add(p?.name, p?.birthday);
  for (const p of (profile.inlaws || [])) add(p?.name, p?.birthday);
  if (profile.partner) add(profile.partner.name, profile.partner.birthday);
  const circle = await docData(`users/${owner}/data/circle`);
  for (const c of (circle.contacts || [])) add(c?.name, c?.birthday);
  return [...map.values()];
}

// Enriched morning digest: today's events, tasks due, school deadlines, and the
// nearest upcoming birthday — whichever apply. One tap opens the briefing.
export async function buildBriefingLine(uid, now = new Date()) {
  const owner = await ownerFor(uid);
  const today = todayISO(now);
  const bits = [];
  try {
    const events = ((await docData(`users/${owner}/data/calendar_synced`)).events) || [];
    const todays = events.filter(e => e.date === today);
    if (todays.length === 1) bits.push(`1 event: ${todays[0].title}`);
    else if (todays.length > 1) bits.push(`${todays.length} events`);
  } catch { /* skip */ }
  try {
    const tasks = ((await docData(`users/${owner}/data/tasks`)).tasks) || [];
    const due = tasks.filter(t => t?.dueDate === today && t?.status !== "done" && t?.status !== "completed");
    if (due.length) bits.push(`${due.length} task${due.length > 1 ? "s" : ""} due`);
  } catch { /* skip */ }
  try {
    const school = ((await docData(`users/${owner}/data/school`)).events) || [];
    const soon = school.filter(e => {
      const d = e.actionDeadline || e.date;
      if (!d || !e.requiresAction) return false;
      const days = Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86400000);
      return days >= 0 && days <= 3;
    });
    if (soon.length) bits.push(`${soon.length} school deadline${soon.length > 1 ? "s" : ""}`);
  } catch { /* skip */ }
  try {
    const bills = ((await docData(`users/${uid}/data/bills`)).bills) || [];
    const due = bills
      .map(b => ({ name: b.name, amount: b.amount, days: daysUntilDue(b, now), autopay: b.autopay }))
      .filter(b => b.days != null && b.days >= 0 && b.days <= 5)
      .sort((a, b) => a.days - b.days);
    if (due.length) {
      const b = due[0];
      const when = b.days === 0 ? "due today" : b.days === 1 ? "due tomorrow" : `due in ${b.days}d`;
      bits.push(`${b.name} ($${Math.round(b.amount).toLocaleString()}) ${when}${b.autopay ? " (autopay)" : ""}`);
    }
  } catch { /* skip */ }
  try {
    const soon = (await birthdayPeople(uid))
      .map(p => ({ name: p.name, days: daysUntilBirthday(p.date, now) }))
      .filter(p => p.days != null && p.days > 0 && p.days <= 7)
      .sort((a, b) => a.days - b.days);
    if (soon.length) bits.push(`${soon[0].name}'s birthday in ${soon[0].days}d`);
  } catch { /* skip */ }

  if (!bits.length) return "A clear day ahead. Tap for your briefing.";
  return bits.join(" · ") + ". Tap for your briefing.";
}

// Send the morning digest push. Reused by the cron and the manual test action.
export async function sendMorningBriefingTo(uid, now = new Date()) {
  const body = await buildBriefingLine(uid, now);
  return sendPushToUser(uid, { title: "Good morning ☀️", body, data: { screen: "briefing" } });
}

// Celebratory birthday push(es) for anyone whose birthday is today. Deduped by
// name+year in users/{uid}/data/push_state so a re-run can't double-send.
export async function sendBirthdayPushes(uid, now = new Date()) {
  const todays = (await birthdayPeople(uid)).filter(p => isBirthdayToday(p.date, now));
  if (!todays.length) return { sent: 0 };
  const yr = now.getFullYear();
  const stateRef = adminDb.doc(`users/${uid}/data/push_state`);
  const prevSent = (await docData(`users/${uid}/data/push_state`)).birthdaySent || {};
  // Prune to this year only so the map doesn't grow unbounded.
  const nextSent = Object.fromEntries(Object.entries(prevSent).filter(([k]) => k.endsWith(`:${yr}`)));
  let sent = 0;
  for (const p of todays) {
    const key = `${p.name}:${yr}`;
    if (nextSent[key]) continue;
    const age = turningAge(p.date, now);
    const body = age != null ? `${p.name} turns ${age} today 🎂` : `It's ${p.name}'s birthday today 🎂`;
    const r = await sendPushToUser(uid, { title: "Happy birthday!", body, data: { screen: "circle" } });
    if (r.sent > 0) { sent += r.sent; nextSent[key] = true; }
  }
  if (sent) await stateRef.set({ birthdaySent: nextSent }, { merge: true });
  return { sent };
}

// All uids in a user's household (primary + partners), for cross-notifying.
// Membership: a partner's users/{uid}/data/household_link points at primaryUid.
export async function householdMemberUids(uid) {
  const link = await docData(`users/${uid}/data/household_link`);
  const primaryUid = link.primaryUid || uid;
  const members = new Set([primaryUid]);
  try {
    // household_link docs live in the per-user `data` subcollection; only they
    // carry primaryUid, so a collection-group filter returns just those.
    const snap = await adminDb.collectionGroup("data").where("primaryUid", "==", primaryUid).get();
    for (const d of snap.docs) {
      if (d.id !== "household_link") continue;
      const memberUid = d.ref.parent.parent?.id;
      if (memberUid) members.add(memberUid);
    }
  } catch { /* no index / solo user — just the primary */ }
  return [...members];
}

// Notify every household member EXCEPT the actor of something they did.
export async function notifyHousehold(actorUid, { title, body, data }) {
  const members = await householdMemberUids(actorUid);
  let sent = 0;
  for (const m of members) {
    if (m === actorUid) continue;
    try { sent += (await sendPushToUser(m, { title, body, data })).sent; } catch { /* skip */ }
  }
  return { sent };
}

// Everything a user should get in the morning: birthday celebrations first,
// then the digest. Used by the daily cron.
export async function sendDailyPushesTo(uid, now = new Date()) {
  const b = await sendBirthdayPushes(uid, now);
  const d = await sendMorningBriefingTo(uid, now);
  return { birthday: b.sent, digest: d.sent };
}
