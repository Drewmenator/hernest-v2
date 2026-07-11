# HerNest — Device QA Checklist

Run this on a real device (via TestFlight or Xcode Run) before each tester round.
Check the box when it behaves as described.

## First run & auth
- [ ] Fresh install → lands on **login** (not a blank/brown screen)
- [ ] **Continue with Google** completes and lands in the app (native sign-in)
- [ ] New account → **guided onboarding** (Cleo chat), not straight to Home
- [ ] Onboarding **"add birthdays"** step appears after entering kids, and is skippable
- [ ] Existing account → straight to **Home**, no re-onboarding
- [ ] Sign out → returns to login; sign back in → data still there

## Core navigation
- [ ] All 5 primary tabs load: Home, Cleo, Plan, Budget, Briefing
- [ ] "More" drawer opens every screen (Family, Thrive, Style, Trips, Circle, Calendar, Connections, Memory, Profile, Settings)
- [ ] No screen shows a blank/broken card on first run (warm empty states instead)

## Cleo AI
- [ ] Cleo replies in the main Cleo tab (streaming text)
- [ ] Floating Cleo mini works from other screens
- [ ] Ask a money question → Cleo answers **in the selected currency**

## Currency (Settings → Account)
- [ ] Currency picker shows; selecting **₦ Naira** updates instantly
- [ ] Budget screen, Home cash card, Bills, Trips all show the new symbol
- [ ] Cleo now talks in the new currency too

## Budget & Bills
- [ ] Log an expense → appears, category updates
- [ ] Bills tab → add a monthly bill → shows "due in N days", correct next date
- [ ] Mark paid / edit / delete all work
- [ ] Typing in amount fields does **not** zoom the screen (16px inputs)

## Family & dates
- [ ] A child with a date of birth shows the **correct current age** (not a frozen number)
- [ ] Editing a member → date-of-birth picker present
- [ ] Add a birthday within a week → shows in the morning digest preview

## Notifications
- [ ] Login does **not** cold-prompt for notifications
- [ ] Settings → **🔔 Turn on notifications** → iOS permission prompt appears
- [ ] Settings → **Preview morning briefing** → push arrives with today's summary
- [ ] Tapping the push opens the Briefing tab

## Calendar
- [ ] Add an event manually → shows on the day
- [ ] Import a **.csv** of events (header row with title + date) → events appear in the review modal
- [ ] .ics import still works

## Connectors (Connections screen)
- [ ] Google Calendar connect → OAuth completes → events sync
- [ ] Oura connect (if you have a ring) → Thrive vitals populate
- [ ] Unconnected connectors show a Connect CTA, not a broken screen

## Resilience
- [ ] Turn on Airplane Mode mid-use → no crash; changes queue and sync on reconnect
- [ ] Background the app during Google sign-in → returns cleanly
- [ ] Rotate / different device sizes → layout holds (safe-area, no clipped content)

## Known-sandbox (don't flag as bugs yet)
- [ ] **Plaid bank connect returns sandbox/fake data** until `PLAID_ENV=production` is set
- [ ] **Stripe upgrade** falls back to a waitlist until Stripe keys are set
- [ ] Google Classroom / Outlook require their API credentials to be configured
