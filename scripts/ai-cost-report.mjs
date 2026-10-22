// ─── AI cost report ────────────────────────────────────────────────
// Prints one day's AI calls and estimated cost per household and per feature,
// from the records /api/claude writes (ai_usage/{date}/households/*).
//
//   npm run ai:cost                 yesterday (UTC)
//   npm run ai:cost -- 2026-10-20   a given day
//
// Needs the server Firebase credentials (FIREBASE_PROJECT_ID,
// FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) in .env.local, or exported.
// Costs are estimates from the price table in api/_lib/aiUsage.js.
import { existsSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const arg = process.argv[2];
if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
  console.error("Date must look like 2026-10-20");
  process.exit(1);
}
const date = arg || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

initializeApp({ credential: cert({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
}) });

const snap = await getFirestore().collection(`ai_usage/${date}/households`).get();
const usd = (n) => `$${(n || 0).toFixed(4)}`;
const tokens = (r) => `${r.inputTokens || 0} in / ${r.outputTokens || 0} out / ${r.cacheReadTokens || 0} cache read / ${r.cacheWriteTokens || 0} cache write`;

console.log(`AI usage for ${date} (UTC)\n`);
if (snap.empty) {
  console.log("No AI calls recorded.");
  process.exit(0);
}

const byFeature = {};
let totalCalls = 0, totalCost = 0;
const households = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.costUsd || 0) - (a.costUsd || 0));

console.log("Per household");
for (const h of households) {
  totalCalls += h.calls || 0;
  totalCost += h.costUsd || 0;
  console.log(`  ${h.id}  ${h.calls || 0} calls  ${usd(h.costUsd)}  (${tokens(h)})`);
  for (const [f, r] of Object.entries(h.features || {})) {
    const agg = (byFeature[f] ||= { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    for (const k of Object.keys(agg)) agg[k] += r[k] || 0;
  }
}

console.log("\nPer feature (all households)");
for (const [f, r] of Object.entries(byFeature).sort((a, b) => b[1].costUsd - a[1].costUsd)) {
  console.log(`  ${f.padEnd(18)} ${String(r.calls).padStart(5)} calls  ${usd(r.costUsd)}  (${tokens(r)})`);
}

console.log(`\nTotal: ${households.length} households, ${totalCalls} calls, ${usd(totalCost)}`);
console.log("(Calls include ones that failed upstream; tokens and cost only count answered calls.)");
