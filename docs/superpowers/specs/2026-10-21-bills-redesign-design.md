# Budget → Bills: redesign (draft for review)

Date: 21 Oct 2026. Status: phases 1 and 2 plus screenshot import built (21 Oct, uncommitted); reminders, calendar suggestions, Cleo add_bill and Plaid still to do.

## Why
Nobody uses Budget. It asks for income, 13 category budgets, every purchase, debts and goals before it gives anything back, and its "this month" totals never reset, so the numbers go wrong after month one. The one part that needs no daily effort and saves people real stress is the Bills tab.

## The one job
**Never miss a bill.** HerNest knows every regular bill the household has, tells you before each one is due, and lets you tick it off. Users are mainly in the US.

## What the user sees
The bottom tab is renamed **Bills**, and it is a single screen with no sub-tabs.

1. **Top card:** "3 bills in the next 7 days · $1,240". If any bill is overdue, the card says so in soft red and shows that bill first.
2. **The list**, grouped as *Overdue*, *This week*, *Later this month* and *Next month*. Each row shows the name, the amount, a due label such as "Due Fri" or "Due in 12 days", and either a large **Paid** button or an **Autopay** badge.
3. **Paid this month:** a collapsed list, so you can see what is done.
4. **Footer:** "Bills each month: about $3,450." This is the only total on the screen.

Tapping a row opens its details: edit it, see the payment history, change the reminder, or delete it.

## Where the bills come from
The app must be easy **with no bank connection at all**, because Plaid is not approved yet and many people won't link a bank anyway. The bank connection is a later bonus, never a requirement.

### The no-bank setup (about one minute)
1. **"Which of these do you have?"** A grid of tiles: Rent/Mortgage, Electric, Gas, Water, Internet, Phone, Car payment, Car insurance, Credit card, Childcare, Netflix, Spotify, Disney+, Amazon Prime, Gym, and others. Tap the ones you have. Tapping only, no typing.
2. **"Roughly what day is each one due?"** Each picked bill shows a row of day numbers (1 to 31) to tap, plus "Not sure". That is all that is required.
3. **The amount is optional.** You don't need an amount to be reminded "Electric is due Thursday". It is filled in later (see below).
4. **"Anything else?"** One text box (the iOS keyboard microphone works here) for something like "daycare every other Friday, car insurance March and September". Cleo turns it into bills, you see them listed and tap to confirm.

The key choice is to ask for **name and due day only**, which halves the effort compared with a normal bill form.

### The app fills in the rest over time, with no extra work
- **When a reminder fires**, the Paid button asks "How much was it?" with a number pad, and "Skip" is fine. The amount is learned the first time the bill is paid and shown as "about $142" afterwards.
- **"Not sure" due dates:** on the 1st of the month, HerNest asks "Did your Electric bill come yet? Tap the day it's due." It asks once per bill, not every month.
- **Telling Cleo:** saying "my car insurance is due on the 3rd" in the normal Cleo chat adds or updates the bill. This is a new Cleo tool, `add_bill`, next to the existing add-task tool.
- **Your partner can add and pay bills too,** because bills are already shared with the household.

### Optional extras (never required)
| Extra | What it adds | Notes |
|---|---|---|
| **Screenshot** | Take a screenshot of your card app, the phone's Settings → Subscriptions page, or an e-bill. HerNest reads all the bills on it at once. | No account linking, so no trust barrier. Uses Claude's image reading. Small to medium build. |
| **Calendar** | If you already connected Google or Apple Calendar, HerNest spots events like "Pay rent" and offers them as bills. | Uses data the app already has. Small build. |
| **Gmail** | Finds e-bills and renewal emails ("payment due Nov 12"). | Already built for receipts. **Caution:** Google treats Gmail reading as a "restricted" permission. A public app needs Google's security review, which costs money and takes weeks, so check whether HerNest has it before relying on it. |
| **Bank connection (Plaid), once approved** | Finds every repeat payment and card due date automatically, and ticks bills off when they're paid. | Shown later as an upgrade ("Want HerNest to find the rest automatically?"), not during first setup. Costs per connected bank. |

## Reminders
- **Default for bills you pay yourself:** a push notification 3 days before ("Electric $142 due Thursday") and one on the due day if it is still unpaid.
- **Default for autopay bills:** one quiet notice the day before ("Rent goes out tomorrow, make sure $1,800 is in the account"). It can be turned off.
- **Overdue:** one nudge the next morning, then the bill stays at the top of the screen until you mark it paid. Nothing rolls forward silently. That is a fix: today a missed monthly bill quietly jumps to next month as if it had been paid.
- **The morning briefing** keeps mentioning the next bill, which it already does.
- **Notification actions:** you can tap **Paid** directly on the notification. This uses iOS notification actions, so you don't need to open the app.

## Partner
Bills are already shared with the household. The design adds:
- an optional **"Who pays"** setting on each bill (Me, Partner or Either);
- reminders go only to the person who pays the bill;
- "Paid by Sam" is shown on the bill once it is ticked off.

## What goes away
These are removed from the screens: category budgets and spending, expense logging, CSV import, Gmail receipts, income, debts, savings goals, the health score, AI insights, the CFO tab and scenarios.

- Money questions such as "can we afford a holiday?" go to the main Cleo chat.
- Onboarding stops asking for income and debt, and shows the tap-only bill tiles instead (the setup above).

**Old data is kept, not deleted.** The `budget_v2` record stays in the database untouched, so nothing is lost if any of this comes back later.

## Knock-on changes elsewhere
- **Home, the Briefing and Cleo** currently read the old budget numbers. Those numbers are wrong because they never reset. They switch to bills: "2 bills this week, $380".
- **Cleo's household context** stops including spending totals and the health score.
- The budget events (`budget.expense.logged` and similar) stop firing. The graph and insights code that listens for them gets no new input; that code is partly unused already.

## Not in this version
Spending tracking, savings pots and debt payoff. If users ask for one of these later, savings pots is the best fit with "family things", and it can be a separate small screen.

## Build plan

| Phase | What | Effort |
|---|---|---|
| 1 | New Bills screen (built from the current Bills tab); fix the paid and overdue logic; new repeat options; amount optional; rename the tab; hide the old Budget screens; point Home, Briefing and Cleo at bills | 2 to 3 days |
| 2 | Tap-only setup (tiles plus day picker) and the "anything else?" line, also used as the new onboarding step | 1 to 2 days |
| 3 | Reminders (3 days before, day of, overdue), Paid button that learns the amount, "Not sure" date follow-up, Cleo `add_bill` | 2 days |
| 4 | Screenshot import and calendar suggestions | 2 days |
| 5 (when Plaid is approved) | Find bills automatically from the bank, card due dates, auto-tick when paid | 3 to 5 days |

Phases 1 to 3 give a complete, easy app with no bank connection. Apply for Plaid in the background; if it never happens, nothing breaks.

## Questions for you
1. Is renaming the tab from "Budget" to **Bills** right, or would you prefer something warmer, such as "Bills & Payments" or "Money"?
2. Are the reminder defaults right (3 days before plus the due day, and the day before for autopay)?
3. Do you want "who pays" in phase 2, or is it not needed?
4. Is "name and due day only, amount optional" OK for you?
5. Plaid is a later bonus (phase 5). Do you want to apply for it now anyway, or leave it out entirely for now?
