# Thrive Redesign — Cleo Check-in

**Date:** 2026-07-10 · **Status:** Approved (layout B chosen; data Tier 1+2 confirmed)

## Goal
Rebuild Thrive's Today view around auto-collected wearable data (Oura primary, Apple Health fallback). Manual entry only for what a ring can't know: mood, water, reflective habits. Anti-anxiety principle applies: warm language over dashboards, at most one nudge.

## Data (Tier 1 + 2)
Extend `syncOura` (api/connectors.js) — same integration doc `users/{uid}/integrations/oura`, no new function:
- **daily_stress** → `stressDay` ("restored"|"normal"|"stressful"), `stressHighMins`, `recoveryHighMins`
- **sleep endpoint extras** → `avgHrv` (average_hrv), `restingHr` (lowest_heart_rate)
- **daily_readiness contributors** → `readinessContributors` (hrv_balance, resting_heart_rate, sleep_balance, previous_day_activity …)
- **daily_activity extras** → `activeCalories`, `sedentaryMins`, `activityScore`
Existing fields stay (lastSleepHours, sleepScore, readinessScore, steps). `readWearable`/`WearableDay` pass the new fields through. Skipped (Tier 3): SpO2, respiratory rate, workouts, live HR.

## Today tab layout (replaces mood/sleep/water/habits card stack)
1. **Cleo's Check-in (hero, dark card).** One Haiku-generated paragraph (feature `wellness_score`… no—new allowed feature `cleo_checkin`) synthesizing readiness, sleep, HRV trend, yesterday's stress balance; ends by asking how she feels. Mood chips inline (existing 3 levels). After mood logged: short acknowledgment line replaces chips. Strict no-invented-data prompt; static template fallback when AI/wearable absent. Cached per day+window in the thrive doc (`checkinText`, `checkinDate`) so it doesn't regenerate every visit.
2. **Body Today (stat row).** 4 tiles: Readiness · Sleep · Stress · Steps, sage "auto" markers. Tap Readiness → bottom sheet listing contributors + HRV/resting HR. Tiles show "—" when no data.
3. **Tracked for you (receipt list).** Auto-done items rendered quietly (✓ Movement — 5,200 steps · ✓ Sleep 7.2h Oura). Human habits tappable inline (existing toggleHabit). Water keeps the 8-glass tap row (existing logWater), rendered compactly inside this card.
4. **One nudge max.** Priority: sedentary ≥ 360 min → walk nudge; else stressHighMins high & recovery low → keep-tonight-light; else none. Dismissible (session state).
5. **Manual sleep form** only when no wearable sleep for today/yesterday (reuse existing form + Adjust flow).
Score + Coach tabs unchanged this pass, except weekly score continues to read the same logs (already fed by auto-track). Briefing: BODY READINESS line gains stress balance.

## Error handling
- No Oura + no Apple Health → screen degrades to current manual experience (mood first, sleep form, water, habits).
- AI failure → static check-in template using real numbers only.
- All Firestore reads non-fatal (existing patterns).

## Testing
- Unit: nudge selection logic + check-in fallback template (pure functions, exported from a small `thriveCheckin.ts` helper).
- Existing 15 tests keep passing; build under strict TS.
