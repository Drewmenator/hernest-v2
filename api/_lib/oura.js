// ─── Oura sleep selection (pure, tested) ───────────────────────────
// Oura's /v2/usercollection/sleep returns MANY periods per day: the main
// night ("long_sleep") plus naps and short in-bed fragments. Sorting by
// day alone and taking [0] can grab a 6-minute fragment → the "0.1h" bug.
// And the sleep SCORE isn't on /sleep at all — it's on /daily_sleep.

// The user's real night: prefer long_sleep periods; among the most recent
// day, take the LONGEST period. Falls back to any period if the ring didn't
// tag types.
export function pickMainSleep(periods) {
  const valid = (periods || []).filter(s => (s.total_sleep_duration || 0) > 0);
  if (!valid.length) return null;
  const longs = valid.filter(s => s.type === "long_sleep");
  const pool = longs.length ? longs : valid;
  const latestDay = pool.map(s => s.day || "").sort().reverse()[0];
  return pool
    .filter(s => (s.day || "") === latestDay)
    .sort((a, b) => (b.total_sleep_duration || 0) - (a.total_sleep_duration || 0))[0];
}

// Sleep score comes from /daily_sleep, matched to the night's day (fall back
// to the most recent daily_sleep if the exact day isn't present yet).
export function resolveSleepScore(dailySleepData, day) {
  const rows = dailySleepData || [];
  const exact = rows.find(d => d.day === day);
  if (exact?.score != null) return exact.score;
  const newest = [...rows].sort((a, b) => (b.day || "").localeCompare(a.day || ""))[0];
  return newest?.score ?? null;
}

export function sleepHours(period) {
  if (!period || period.total_sleep_duration == null) return null;
  return Math.round((period.total_sleep_duration / 3600) * 10) / 10;
}
