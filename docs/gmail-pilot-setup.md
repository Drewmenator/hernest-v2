# Gmail for the pilot: what to set up and what to expect

Cleo reads each family's email every night. She looks for mail from school
(Skyward, ParentSquare, district addresses like katyisd.org), kids'
activities, doctor and dentist offices, travel and due dates. From those
emails:

- dates go straight onto the family calendar (games, picture day, flights,
  appointments);
- to-dos show up on Today under **From your email** (sign a form, RSVP, pay
  by a date, check in for a flight), with **Add** and **Not now** buttons;
- receipts go to the same review list as before.

She can only read mail. She can't send, delete or change anything. Each email
is read once, and email text is never stored, only what Cleo pulls out of it.

## Google's rules

Reading Gmail is what Google calls a "restricted" permission.

**For the pilot (about 10 families): no Google review needed.**
1. In Google Cloud Console, open **APIs & Services → OAuth consent screen**.
2. Leave the app's publishing status on **Testing**.
3. Under **Test users**, add the Gmail address of every pilot mom (up to 100).
   Someone who isn't on that list can't connect Gmail.

**The catch:** while the app is in Testing, Google signs Cleo out of each
Gmail about once a week (Testing sign-ins last 7 days). When that happens,
the nightly scan notices, and Today shows "Google signed Cleo out of your
Gmail" with a **Reconnect** button. Tell pilot families to expect this.

**Before launching to the public:** Google must verify the app, and
restricted permissions also need a yearly independent security assessment.
That takes weeks and costs money, so plan it before launch. Moving to
Published without it isn't an option for Gmail.

## Costs

The scan uses one AI call per family per night at most, and none when no new
family email came in. It uses the cheaper Haiku model and counts toward the
family's daily AI limit. Its cost shows as `gmail_extract` in
`npm run ai:cost`.
