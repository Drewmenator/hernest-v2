# HerNest: what to cut, merge or simplify (review for approval)

Date: 21 Oct 2026. Status: **all decisions made (21 Oct). Phase 0 built 21 Oct, uncommitted;** phases 1 to 4 not started.

**Revision 2 (21 Oct), after your feedback:** Thrive stays and is rethought around wellness and fitness. Style stays and is made practical. Cleo is a tab and the floating bubble goes. Pro is parked for now; the goal is a working app people come back to. Both Thrive and Style now live in a new **Me** tab (sections 3, 4a and 4b).

## The short version

HerNest has **16 places to go** (5 bottom tabs plus 11 in "More"), **6 separate chat boxes**, **5 things that write "insights"**, **4 different scores**, and a Home screen with **10 cards**. Several of those cards still run on the old Budget data, which nobody can update any more, so they show wrong or frozen numbers. A new user who only uses Bills sees a **red "F" finance grade** on Home.

The Bills redesign showed the way: one screen, one job, no setup burden. The same idea for the whole app:

> **HerNest helps a busy mom get through today and this week (what's on, what needs doing, what's due) and still look after herself.**

Everything that serves that sentence stays. Everything else is cut, merged or tucked away. Every screen that stays has to be useful in under a minute, so people come back because it helps, not because it nags.

**Proposed result:** 5 tabs (Today, Plan, Cleo, Bills, Me), with settings and family details behind your profile picture. Home goes from 10 cards to 4.

One honest caveat: **the app's usage tracking is switched off** (`src/core/analytics.ts` does nothing), so no one can actually prove which features people use. Phase 0 below turns it on, so the later "cut" decisions can be checked against real numbers.

---

## 1. What is wrong today (plain English)

### Things showing wrong information right now
These are the urgent ones, because they make the app look broken.

| What the user sees | Why it's wrong |
|---|---|
| **Home "Household Pulse" card**: a Finance grade, a "Budget this month" bar, "Goals at risk", money tips from "HerNest CFO" | All read the old Budget record, which nothing writes any more. A Bills-only user gets a red **F** and "0% · $0 left". Old users see numbers frozen on the day Budget was removed. Its empty message says "Add your income and budget", which you can no longer do. |
| **Home score dials** (Resilience, Productivity) | Resilience is 35% based on savings rate and debt from the dead Budget data. Overdue **bills don't count at all**. Productivity thinks every finished task is still pending (a small coding mismatch: Plan marks tasks "completed", the score looks for "done"), so it reads near zero. |
| **Home "Command Center"** | Can say "Nothing pressing across your finances" while a bill is overdue, because it never looks at bills. Old "Dining at 92% of budget" alerts never expire. |
| **Briefing tab "BUDGET PULSE" card** | Always appears, but the AI is no longer given any budget numbers, so the text is empty or made up. |
| **Cleo's background knowledge** | Cleo is still told the old income, spending and debt figures and things like "Spending at critical level", which shapes its tone. It is not told about bills in the same way. |
| **Connections screen**: "Bank accounts", "Bank CSV import", "Receipt scanner" | They send you to Budget, which now opens Bills, which has none of those features. Dead ends. |
| **Settings → Notifications** | The five switches are drawings, not switches. Tapping them does nothing. One is "Budget alerts". |
| **Trips "Ask CFO"** and **Calendar overspend banner** | Both use the dead Budget data. |

### Too many ways to do the same thing
- **People are stored three times:** Family (members), Circle (contacts and birthdays), and Profile (partner, kids, parents). They don't stay in sync.
- **School events can be added in four places:** Plan → School, Calendar upload, Calendar per-child box, Family .ics upload.
- **Two meal planners:** Plan → Meals and Family → Dinners, each with its own data.
- **Six chats with no shared memory:** Cleo tab, the floating mini-Cleo on every screen, Family "Ask Cleo", Briefing "Ask Cleo", Thrive Coach, Circle "AI Companions".
- **Memories are managed on three screens:** Memory, Settings → Privacy, Profile → Memory.
- **Calendar connections appear twice:** Calendar and Connections.
- **The Briefing appears twice:** its own tab, and the BriefingHero card on Home (with a second mood check-in that saves mood in a different format to Thrive).
- **Tasks are counted in six places on Home alone.**

### Built for the UK, sold in the US
£ signs and "UK 12" sizes in Style, £ goals in Profile, UK date format in Plan and Style, voice input set to British English in Cleo, "INSET day" in Calendar, GDPR wording in the data export, "Mum" in Trips packing lists.

### Hidden machinery nobody sees
A large "intelligence" layer (thousands of lines) mostly feeds the cards above or nothing at all: an unused insight engine, a "context graph" switched off by a setting, two versions of a decision engine, an "adaptive layout" system of which only one small piece is used, and a recommendations system nothing saves. It costs effort every time anyone changes the app, and two pieces have real bugs (one can crash the Pulse card; one can loop forever).

---

## 2. Feature by feature

**Keep** = stays as is (maybe small fixes). **Merge** = folded into another screen. **Hide** = kept in the code but off by default; can be switched on under Settings → Extras. **Cut** = removed from the app (your saved data is kept in the database; only the screen goes).

### Tabs and screens

| Feature | Verdict | Why |
|---|---|---|
| **Home** | **Keep, rebuild as "Today"** | The most-seen screen. Becomes 4 cards (see section 4). |
| **Briefing tab** | **Merge into Today** | It's the same "what's my day" job as Home, and Home already shows it. The morning note becomes the top card of Today. Drop its Budget Pulse card and its broken time-of-day tabs. |
| **Bills** | **Keep** | Just redesigned; the model for the rest. |
| **Plan → Tasks** | **Keep** | Core job. |
| **Plan → School** (paste a newsletter, AI pulls out dates) | **Keep, make it the only school input** | Genuinely useful for US parents. The other three school inputs go. |
| **Plan → Meals** | **Keep (one meal planner)** | Merge Family → Dinners into it. Fix the "wrong Monday on Sundays" bug. |
| **Calendar** | **Merge into Plan** as a "Week" view | Parents think "what's on this week", not "calendar vs tasks". Connecting calendars moves to Settings → Connections only. Remove the iCloud password option later (it's risky; Apple's own calendar access is the better route). |
| **Family → Members** | **Keep, becomes the one people list ("Your family" in the You menu)** | Partner, kids, grandparents, close friends, all in one place, with birthdays. |
| **Family → Chores** | **Keep, but show chores in Plan** | Chores today are invisible everywhere else. They should appear as tasks with a "who" name. |
| **Family → Dinners** | **Merge into Plan → Meals** | Duplicate planner. |
| **Family → Ask Cleo** | **Cut** | Use the one Cleo. |
| **Circle → My Circle** (contacts, birthdays, "check in" reminders, gift ideas) | **Merge into "Your family"** | Same people, stored twice. Birthdays and gift ideas are well liked parent features; they move, they don't vanish. The "check in with friends" frequency feature: keep as an optional setting per person. |
| **Circle → AI Companions** (Priya, Sophie, Amara, Mei) | **Cut** | A fourth and fifth chat. The personas are described by ethnicity ("South Asian mum of two"), which is a reputational risk and off-mission. |
| **Thrive** (mood, sleep, water, habits, Oura/Apple Health, weekly score, coach) | **Keep, rethink as "Wellness" in the Me tab** | Wellness and fitness matter to the women using HerNest. Today's version has three sub-tabs, a weekly AI score and its own coach chat; the rethink keeps it to one screen you can use in 30 seconds. See section 4a. |
| **Trips** | **Hide (Extra)** | Used a few times a year. Packing lists and readiness are nice, but they don't earn a permanent place. Remove its "Ask CFO". Switch on from Extras, and Today can show "Trip in 12 days" when one exists. |
| **Style** (AI outfits, body shape, wishlist) | **Keep, make practical, in the Me tab** | People like it. The problem is that it's a "plan an outfit for an occasion" toy that ignores the things the app already knows: the weather and what's on your calendar today. It's also UK-flavoured (£, UK sizes). The rethink makes it answer "what do I wear today?" in one tap. See section 4b. |
| **Cleo tab** | **Keep, the one and only chat** | All other chat boxes send people here. |
| **Mini-Cleo** (floating bubble on every screen) | **Cut** | Decided: Cleo is a tab. The bubble duplicates it and doesn't even know which screen you're on. Screens that need Cleo get an "Ask Cleo" button that opens the tab with the right context. |
| **Briefing "Ask Cleo" box** | **Cut** | Goes through no safety checks today; use the one Cleo. |
| **Thrive Coach chat** | **Cut** (its button opens the Cleo tab, already focused on wellness) | Duplicate chat. Cleo already sees your sleep and mood. |
| **Thrive weekly AI score** | **Cut** | A grade for your week adds pressure. Replaced by a simple "this week" summary (section 4a). |
| **Memory screen** | **Merge into Settings → "What Cleo knows"** | One place to see and forget memories. Remove the copies in Profile and Settings → Privacy. The "Timeline" view: cut (diagnostic, not useful to parents). |
| **Profile** | **Merge into Settings → "About you"** | Keep name, city, "what's weighing on you". Family people move to "Your family". Remove health/goals sections and £ goal chips. Remove the duplicate "challenge" question. |
| **Connections** | **Merge into Settings → Connections** | Keep Google/Outlook calendar, Gmail (if you have Google's approval), Oura and Apple Health (used by Wellness). Remove the three dead Budget links. |
| **Settings** | **Keep, becomes the "You" menu** | Opened from your picture on Today. Holds: About you, Your family, Connections, Notifications (make the switches real, drop "Budget alerts"), What Cleo knows, Extras, Account. |
| **Go Pro / Upgrade** | **Park** | Decided: Pro comes later. Take the "Go Pro ✦" button out of the menu for now so the app feels complete and free to use. The screen stays in the code for when you're ready. |
| **Onboarding** | **Keep, trim** | Keep: name, kids (with ages), "what's weighing on you", then the tap-only bill tiles from the Bills spec. Remove the leftover savings-goal and "morning person" placeholders. |
| **Old Budget screens** | **Cut** (code), **keep data** | Already hidden. Delete the code in phase 3; the saved record stays untouched, as the Bills spec promised. |

### Home cards

| Card | Verdict | Why |
|---|---|---|
| Header greeting | **Keep** | Add your profile picture (opens Settings). |
| Get Started checklist | **Keep** | Disappears once done. Good. |
| Command Center ("needs attention") | **Keep, rebuild as "Needs you"** | Becomes the heart of Today, fed by **bills, tasks, events, birthdays and school**, not money scores. |
| BriefingHero (morning note) | **Keep, simplified** | Focus line plus top 3 priorities. Remove the repeated greeting and the second mood logger. |
| Household Pulse (finance grade, budget bar, CFO tips) | **Cut** | Built entirely on dead Budget data. |
| Score dials (Resilience, Productivity) | **Cut** | Wrong inputs, and a score for "how resilient your family is" adds worry rather than help. |
| Intelligence tiles (tasks / events / bills due) | **Merge into "Needs you" and "This week"** | Same numbers shown elsewhere on the page. |
| Family HQ card | **Cut from Home** | Family details live in "Your family"; birthdays show in "Needs you". |
| Quick actions (Brief / Chat / Add Task) | **Keep, change** | Add task, Add bill, Ask Cleo. |
| Module grid (10 tiles) | **Cut** | It's a second menu. The tab bar does this job. |

### Behind the scenes (the "intelligence" layer)

| Part | Verdict | Why |
|---|---|---|
| Cleo's core (the chat pipeline, safety checks, crisis detection, tool use for adding tasks/events) | **Keep** | It works and users see it. Add the planned `add_bill` tool. |
| Memory (version 2) | **Keep** | Already the one in use. Remove the leftover version-1 wrapper later. |
| Morning briefing generator | **Keep** | Remove the budget section from what it asks the AI for. |
| Household scores (`householdScores.ts`) | **Cut** | Feeds the dials and part of Cleo's background info with dead money data. Replace with a simple "needs you" list built from bills, tasks and events. |
| Household Pulse / "CFO" insights (`HouseholdIntelligence.ts`) | **Cut** | Money advice built on dead data. |
| Household "state" and tone engine | **Simplify** | Keep only the calendar, task and mood signals for Cleo's tone; drop money signals. |
| Adaptive layout system (`adaptiveUX.ts`, 839 lines) | **Cut** | Only one small piece is used, its banner never shows, and it has a crash bug. A simple, fixed Today screen is better. |
| Unused insight engine (`insightEngine.ts`, 721 lines) | **Cut** | Nothing uses it. |
| Context "graph" | **Cut**, keep only the small pattern check that reaches Cleo (or cut that too) | Switched off by a setting; rebuilt from scratch on every message. |
| Decision engine (two versions) | **Cut** | Only used by Budget "Ask CFO" and Trips "Ask CFO", both on dead data. Money "can we afford it?" questions go to Cleo, as the Bills spec says. |
| Recommendations (`recommendationActions.ts`) | **Cut** | Only Budget used it; nothing saves its output. |
| Old calendar sync (`calendarSync.ts`) | **Cut** | Replaced long ago; nothing uses it. |
| Budget alerts (`connectivity.ts` money parts) | **Cut** | Can't trigger any more; old alerts linger forever. |
| Bank connection (Plaid) | **Hide** | Keep the code for the planned Bills "find my bills automatically" upgrade once Plaid approves you. |
| Gmail scan | **Keep, but only if** Google has approved the restricted permission | Otherwise hide. |
| Usage tracking (analytics) | **Turn on** | Currently does nothing. Needed to know what people use. |

---

## 3. Proposed tab layout

**Today (5 tabs, nothing hidden in "More"):**

```
 Today     Plan      Cleo      Bills     Me
```

| Tab | What's in it |
|---|---|
| **Today** | Home and Briefing combined (section 4). Your picture in the corner opens the **You** menu. |
| **Plan** | Three views: **Tasks** (including chores, with who does them), **Week** (calendar plus school events, one list), **Meals** (one planner and shopping list). School newsletters are added here only. |
| **Cleo** | The one chat. Centre position. |
| **Bills** | Unchanged from the Bills redesign. |
| **Me** | Two views: **Wellness** (Thrive, rethought, section 4a) and **Style** (made practical, section 4b). The part of the app that is just for her. |

**The "You" menu** (tap your picture on Today): About you · **Your family** · Connections · Notifications · What Cleo knows · Extras (switch on Trips) · Account and privacy.

**Your family** is the one people list: partner (and the partner invite), kids, grandparents, close friends, with birthdays, gift ideas, school per child, check-in reminders and "who pays" for bills. It used to be the Family tab. It moves here because people set it up once and rarely browse it; what they need from it day to day already shows up elsewhere: birthdays in Today, chores and school in Plan.

*Decided (21 Oct):* the Me tab, rather than keeping Family as the 5th tab.

**Trips, when switched on** in Extras, appears as a small row on Today ("Trip to Orlando in 12 days") and opens its own screen from there. It never gets a tab.

From 16 destinations to 5 tabs plus one menu.

---

## 4. Proposed Today screen (replaces Home and Briefing)

Four cards, in this order:

1. **Morning note.** "Good morning, Jess. Today's focus: *the school run is tight, leave by 7:50.*" Up to three priorities. Weather in one line. Made once a day by the existing briefing generator, with no money section.
2. **Needs you.** One short list, most urgent first, never more than 5 items:
   - overdue or due-today bills (with a **Paid** button, same as Bills),
   - overdue tasks,
   - school deadlines in the next 3 days,
   - birthdays in the next 7 days,
   - trip prep, if Trips is switched on.
   If empty: "You're all caught up." (No mention of finances.)
3. **This week.** Today's and tomorrow's events, then a one-line "3 bills this week · $380".
4. **Quick add.** Add task · Add bill · Ask Cleo.

Plus, until finished: the **Get Started** checklist at the top. At the bottom, one small **"You today"** line that links to the Me tab, for example "Slept 6.5h · 3,200 steps · Rainy, 54°F: see today's outfit". Mood is logged in one place only (Wellness), so Today no longer has its own mood logger.

What's gone from Home: the finance grade, budget bar, CFO tips, score dials, the 10-tile grid, the Family HQ card, the second mood logger, and the duplicate task and event counts.

---

## 4a. Wellness (Thrive, rethought)

**The one job:** *help her feel a bit better each day, in 30 seconds, without another thing to keep up with.*

What's wrong with Thrive today: three sub-tabs (Today, Weekly Score, Coach), lots of manual logging (sleep, water, habits), a weekly AI grade, its own chat, and mood saved in two different formats (Thrive and Home). Fitness is only "steps".

**One screen, top to bottom:**

1. **Check-in (10 seconds).** Cleo's short note on how your body is doing, from Apple Health or Oura if connected (sleep, steps, readiness). Then two taps: *How are you feeling?* (3 faces) and *Energy?* (low / ok / good). This is the only mood logger in the app.
2. **Move this week.** One simple goal she picks once, for example "move 30 minutes, 3 days a week" or "7,000 steps a day". A row of 7 dots fills in automatically from Apple Health or Oura, or she taps "I moved today" if nothing is connected. Workouts from the Apple Watch or Fitness app count without any typing.
3. **One suggestion, at most.** Picked from her data and her calendar, never a lecture: "Busy day and short sleep: a 10-minute walk after school pickup?" or "You've moved 3 days in a row, nice."
4. **Small habits (optional).** Up to 3 she chooses (water, stretch, read). Tap to tick. Off by default.
5. **This week.** A plain summary: "Slept 6.8h on average · moved 4 of 7 days · mostly good days." No grade.

**What goes:** the Weekly Score tab and its AI grade, the separate Coach chat (an "Ask Cleo about this" button opens the Cleo tab instead), manual sleep-hours typing when a device already knows, the second mood logger on Home.

**What it needs underneath:** reading Apple Health directly on the iPhone (HealthKit) instead of today's hand-built iOS Shortcut, which only sends sleep and steps. This is the biggest single upgrade for Wellness, and it unlocks workouts and better sleep data. Cycle tracking could come later, but only with very careful privacy handling.

**Why people come back:** the check-in is quick and Cleo notices things ("third short night this week"), the movement dots fill themselves in, and the suggestion is linked to her actual day.

---

## 4b. Style (made practical)

**The one job:** *"What do I wear today?" answered in one tap, using the weather and what's on her calendar.*

What's wrong with Style today: she has to type an occasion and pick a mood every time, and type the weather by hand, even though the app already knows the weather and her schedule. Prices are in £ with UK sizes. There are four sub-tabs (Style Me, My Profile, Saved, Wishlist). Nothing else in the app uses it.

**One screen, top to bottom:**

1. **Today's outfit.** Opens straight to a suggestion, already filled in: "54°F and rain, school run then a 2pm work call: dark jeans, the cream knit, ankle boots, rain jacket." Short reasons, no essay. Buttons: *Another idea* · *Save*. She can also tap "Something else" and choose: work, date night, kids' party, workout, errands, special event.
2. **Coming up.** Events in the next 7 days that need thinking about: "Emma's recital Saturday", "Wedding in 3 weeks". Tap one to get an outfit idea for it ahead of time.
3. **Saved looks.** Outfits she liked, to reuse. The Wishlist merges in here as "Want to buy".
4. **Your style (set once).** A short version of today's profile: US size, a few style words she likes, a typical budget in dollars. Body-shape questions become optional.

**Later, if she wants it (bigger build):** "My closet". She photographs a handful of favourite pieces and suggestions use her own clothes. This is what turns Style from fun into really practical, so it's the natural next step if Style gets used.

**What goes:** typing the weather, the forced occasion and mood pick before anything happens, £ and UK sizes, the separate Wishlist tab.

**Why people come back:** it answers a real question every morning in a few seconds, and it reminds her about events she needs to plan an outfit for.

---

## 5. Phased plan

Each phase ships on its own and can be tested on your phone before the next starts. Effort: **S** = an afternoon, **M** = 1 to 3 days, **L** = a week or more.

### Phase 0: Stop showing wrong things (S to M, do first)
*Built 21 Oct (uncommitted).* Notes: the notification switches were replaced by an honest list of what HerNest sends (real on/off per type needs a server change). Usage tracking is connected but stays off until a PostHog key is added as `VITE_POSTHOG_KEY`. The privacy policy's GDPR sections were left as they are, because legal wording is for you to decide.

No layout change yet; just removes the embarrassing parts.
1. Remove the Household Pulse card and the score dials from Home.
2. Make "Needs attention" look at bills; fix the task "done/completed" mismatch; clear and stop the old budget alerts.
3. Remove the Briefing's Budget Pulse card and stop sending old money figures to Cleo; send "bills this week" instead.
4. Remove the three dead Budget links on Connections and the "Ask CFO" in Trips and Calendar.
5. Make the notification switches real (or remove them until they are).
6. Fix US wording: dollar signs, US date format, US English voice input, "Mom" not "Mum", remove GDPR/INSET wording.
7. Turn on usage tracking (privacy-friendly, e.g. PostHog), so phases 2 to 4 can be checked against real use.

### Phase 1: New tabs and the Today screen (M, 2 to 4 days)
*Built 21 Oct (branch `claude/simplify-phase1-tabs-b88d28`, not merged yet).* Notes: the old tab names still work behind the scenes, so notifications and links land in the right place (Briefing and Thrive notifications open Today's full briefing and Me → Wellness). Screens opened from the You menu have a "‹ Today" link back. Two things are left for phase 2, because those screens belong to it: Circle's AI Companions are still inside the Circle screen (Circle is no longer in the menus, only reachable from a birthday or check-in link), and "Ask Cleo" buttons open the Cleo tab but don't yet carry the question into the chat. The partner invite still lives in Settings → Partner until "Your family" takes it over.

1. Build Today (section 4) from the existing BriefingHero and Command Center pieces.
2. New tab bar: Today, Plan, Cleo, Bills, Me. Remove "More".
3. Build the "You" menu from Settings, and move Profile, Memory, Connections and the Family people list into it.
4. Add the **Me** tab holding today's Thrive and Style screens as they are (the rethink comes in phase 2).
5. Add Settings → Extras; Trips starts switched **off** for new users and **on** for anyone who has already used it (so nobody loses something they rely on).
6. Remove the Go Pro button, Circle Companions and the floating mini-Cleo from view.

### Phase 2: Merge the duplicates (M to L, about a week)
*Built 21 Oct on branch `claude/simplify-phase2-merge-300d7e` (not yet merged).* "Your family" is the one people list (Circle and Profile people copied in once, duplicates skipped by name, old data kept). Circle's AI Companions are gone and Circle opens Your family. Plan has Tasks (with chores and who does them), Week (calendar, school, tasks and chores in one list), School (the only school input) and Meals (Family's dinners folded in; the Sunday "wrong Monday" bug fixed). Family, Circle and Plan "Ask Cleo" buttons open the Cleo tab with a message ready. The Calendar screen now only holds the Apple Calendar connect step (Connections links to it) and a link to Plan → Week.
1. **One people list:** merge Family members, Circle contacts and Profile family into "Your family" (a one-time copy, removing duplicates by name). Birthdays, gift ideas and check-in reminders move with them.
2. **One meal planner:** move Family Dinners into Plan → Meals.
3. **One calendar view:** fold Calendar into Plan → Week; one place to add school info.
4. **One chat:** every "Ask Cleo" button opens the Cleo tab with the right context ("You're asking about this trip...").
5. **Chores show up in Plan** as tasks with a name.

### Phase 2b: Rethink Wellness and Style (M to L, about a week each)
**Status (21 Oct): built** on branch `claude/simplify-phase2b-wellness-style-872350` (items 1 and 3, plus workouts from Apple Health for item 2); not yet merged into dev or checked on a real iPhone.
1. **Wellness** (section 4a): one screen; check-in with the only mood logger; "move this week" goal with dots; one suggestion; optional habits; plain weekly summary. Remove the weekly AI score and Coach chat.
2. **Apple Health on the iPhone (HealthKit)** instead of the iOS Shortcut, so sleep, steps and workouts arrive by themselves. Needs Apple's permission wording and a note for App Review.
3. **Style** (section 4b): opens on "Today's outfit" using the weather and calendar the app already has; "Coming up" events; Saved looks with the wishlist merged in; short set-once profile in US sizes and dollars.
4. Later, only if Style gets used: "My closet" (photos of her own clothes).

Phases 2 and 2b don't touch the same screens, so they can be built side by side.

### Phase 3: Clear out the old machinery (M, 1 to 3 days)
Only after phases 1 and 2 have been live for a couple of weeks with no problems.
- Delete the code for: old Budget screens, Household Pulse and scores, adaptive layout, unused insight engine, context graph, both decision engines, recommendations, old calendar sync, Circle Companions, mini-Cleo, the Thrive weekly score and coach, the old Style tabs, the old memory wrapper.
- **No saved data is deleted.** Only screens and code.
- Roughly 8,000 to 10,000 fewer lines of code, which makes every future change faster and safer.

### Phase 4: Decide on the Extras with real numbers (after 4 to 6 weeks)
Using the usage tracking from phase 0:
- If almost nobody switches on Trips, cut it too. If many do, give it a better place.
- Check whether Wellness and Style are opened most days. If one isn't, look at why before adding anything new to it.
- Re-check that nobody is looking for anything that was removed (Cleo questions are a good signal).

---

## 6. Decisions

**Settled (21 Oct):**
- **Thrive:** keep, rethink around wellness and fitness (section 4a).
- **Style:** keep, make practical (section 4b).
- **Cleo:** a tab; the floating bubble goes.
- **Pro:** parked. Focus on a working app people come back to; the Go Pro button is hidden for now.
- **Trips:** hidden for now as an Extra (switched on for anyone who already used it).
- **Tabs:** Today, Plan, Cleo, Bills, Me. Wellness and Style live in Me; family details move to "Your family" in the You menu.

**Nothing left open.** The plan is ready to approve phase by phase, starting with phase 0.

## Small bugs found along the way (fix during phase 0 or 1)
- Household Pulse card can crash when its setup screen is toggled (React "hooks order" problem, `HouseholdPulseCard.tsx:59-62`). Goes away when the card is cut.
- A budget "over limit" event re-sends itself forever (`intelligenceEvents.ts:55-57`). Dormant now; goes away with the budget alerts.
- Home's evening mood saves in a different format and with tomorrow's date for US evenings (`BriefingHero.tsx:132-137`).
- Family "Ask Cleo" prints "undefined:" for each dinner (`FamilyScreen.tsx:273`).
- Plan meal plan starts on the wrong Monday when generated on a Sunday (`PlanScreen.tsx:221`).
- Calendar's "school" view has no button to reach it; the file picker offers Excel files and then rejects them.
- The data export leaves out bills, family, calendar, meals and Cleo's memories (`SettingsScreen.tsx:267`).
- After each Cleo message an extra AI call extracts memories; worth checking it's worth the cost.

Related: the security and App Store items in the separate modernisation review (21 Oct) still come first; nothing here replaces them.
