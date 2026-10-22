// ─── AI pilot limits + cost tracking ───────────────────────────────
// Every /api/claude call is limited per household per day (one family can't
// run up the bill) and per user per minute (a runaway loop stops fast). Each
// call's tokens and estimated cost are added to a per-household daily doc,
// split by feature, so we can see what the pilot really costs.
//
// Firestore (admin SDK only; firestore.rules denies all client access):
//   ai_usage/{YYYY-MM-DD}/households/{householdId}   (the user's LOCAL date)
//     { date, householdId, calls, inputTokens, outputTokens, cacheReadTokens,
//       cacheWriteTokens, costUsd, features: { [feature]: same fields } }
//   ai_burst/{uid}  { minute: "YYYY-MM-DDTHH:MM", count }
import { FieldValue } from "firebase-admin/firestore";
import { localParts, isValidTimeZone } from "./localTime.js";

const int = (v, d) => {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export function limits(env = process.env) {
  return {
    householdDaily: int(env.AI_HOUSEHOLD_DAILY_LIMIT, 60),
    proHouseholdDaily: int(env.AI_PRO_HOUSEHOLD_DAILY_LIMIT, 200),
    userPerMinute: int(env.AI_USER_PER_MINUTE_LIMIT, 10),
  };
}

// USD per million tokens. The one place prices live: update here when
// Anthropic's prices change. Cache writes are 1.25x input, reads 0.1x.
export const PRICES = {
  "claude-sonnet-5-5": { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5":  { input: 0.1, output: 0.5,  cacheWrite: 0.125, cacheRead: 0.01 },
};

export function normalizeUsage(u) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    inputTokens: n(u?.input_tokens),
    outputTokens: n(u?.output_tokens),
    cacheReadTokens: n(u?.cache_read_input_tokens),
    cacheWriteTokens: n(u?.cache_creation_input_tokens),
  };
}

// Estimated cost of one call. Unknown models are priced as the most
// expensive known one so an estimate never comes out too low.
export function estimateCostUsd(model, usage) {
  const p = PRICES[model] || PRICES["claude-sonnet-5-5"];
  const cost = (usage.inputTokens * p.input + usage.outputTokens * p.output
    + usage.cacheWriteTokens * p.cacheWrite + usage.cacheReadTokens * p.cacheRead) / 1e6;
  return Math.round(cost * 1e6) / 1e6;
}

// Reads token usage out of a streamed (SSE) response as it passes through.
// message_start carries the input + cache counts; message_delta carries the
// running output total (and repeats input counts on newer API versions).
export function sseUsageTracker() {
  let buffer = "";
  const usage = {};
  const take = (u) => {
    if (!u || typeof u !== "object") return;
    for (const k of ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]) {
      if (u[k] != null) usage[k] = u[k];
    }
  };
  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        try {
          const e = JSON.parse(t.slice(5).trim());
          if (e.type === "message_start") take(e.message?.usage);
          else if (e.type === "message_delta") take(e.usage);
        } catch { /* partial or non-JSON frame */ }
      }
    },
    usage: () => normalizeUsage(usage),
  };
}

// The daily limit resets at the user's local midnight, not UTC midnight (which
// is 7-8pm on the US east coast). The client sends its IANA zone (header
// x-hn-tz or body tz); without a valid one we use the US pilot's default.
export const DEFAULT_USAGE_TZ = "America/Chicago";
export const usageTimeZone = (tz) => (isValidTimeZone(tz) ? tz : DEFAULT_USAGE_TZ);
export const dayKey = (now = new Date(), tz) => localParts(now, usageTimeZone(tz))?.date || now.toISOString().slice(0, 10);
const minuteKey = (now) => now.toISOString().slice(0, 16);

// Household = the owner's uid when this user joined someone's household.
export async function householdIdFor(db, uid) {
  try {
    const snap = await db.doc(`users/${uid}/data/household_link`).get();
    const owner = snap.exists ? snap.data()?.primaryUid : null;
    return typeof owner === "string" && owner ? owner : uid;
  } catch {
    return uid;
  }
}

export const usageDocPath = (date, householdId) => `ai_usage/${date}/households/${householdId}`;

// Checks both limits and counts the call in one transaction, so parallel
// requests can't all slip past. Returns { ok: true } or { ok: false, reason }.
export async function takeQuota(db, { uid, householdId, now = new Date(), env = process.env, tz }) {
  const lim = limits(env);
  const date = dayKey(now, tz);
  const minute = minuteKey(now);
  const dayRef = db.doc(usageDocPath(date, householdId));
  const burstRef = db.doc(`ai_burst/${uid}`);
  const subRef = db.doc(`users/${householdId}/data/subscription`);
  return db.runTransaction(async (tx) => {
    const [daySnap, burstSnap, subSnap] = await Promise.all([tx.get(dayRef), tx.get(burstRef), tx.get(subRef)]);
    const isPro = subSnap.exists && subSnap.data()?.status === "active";
    const dailyLimit = isPro ? lim.proHouseholdDaily : lim.householdDaily;
    const calls = daySnap.exists ? (daySnap.data()?.calls || 0) : 0;
    if (calls >= dailyLimit) return { ok: false, reason: "daily_limit_reached" };
    const b = burstSnap.exists ? burstSnap.data() : null;
    const inMinute = b?.minute === minute ? (b.count || 0) : 0;
    if (inMinute >= lim.userPerMinute) return { ok: false, reason: "burst_limit_reached" };
    tx.set(dayRef, { date, householdId, calls: FieldValue.increment(1) }, { merge: true });
    tx.set(burstRef, { minute, count: inMinute + 1 });
    return { ok: true };
  });
}

// Adds one call's tokens + cost to the household's daily doc. Never throws:
// a failed write must not break the reply the user is waiting for.
export async function recordUsage(db, { householdId, uid, feature, model, usage, now = new Date(), tz }) {
  const costUsd = estimateCostUsd(model, usage);
  const inc = (v) => FieldValue.increment(v);
  const fields = {
    inputTokens: inc(usage.inputTokens),
    outputTokens: inc(usage.outputTokens),
    cacheReadTokens: inc(usage.cacheReadTokens),
    cacheWriteTokens: inc(usage.cacheWriteTokens),
    costUsd: inc(costUsd),
  };
  // One line per call in the Vercel logs, for spot checks.
  console.log(JSON.stringify({ tag: "ai_usage", householdId, uid, feature, model, ...usage, costUsd }));
  try {
    await db.doc(usageDocPath(dayKey(now, tz), householdId)).set({
      ...fields,
      features: { [feature]: { calls: inc(1), ...fields } },
    }, { merge: true });
  } catch (e) {
    console.error("[HerNest] usage record failed:", e?.message);
  }
  return costUsd;
}

export const LIMIT_MESSAGES = {
  daily_limit_reached: "Cleo has done a lot for your family today. She'll be ready to help again tomorrow.",
  burst_limit_reached: "That's a lot of requests at once. Give Cleo a minute, then try again.",
};
