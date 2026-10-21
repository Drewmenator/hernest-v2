// ─── Account deletion (App Store guideline 5.1.1(v)) ────────────────
// Erases a user for real: cancels billing, disconnects third-party accounts,
// unlinks the household, deletes every Firestore record under the user, then
// deletes the Firebase Auth user. Dependencies are passed in so this is
// testable without Firebase, Stripe or the network.
import { openToken, decryptSecret } from "./cryptoUtil.js";

const GOOGLE_DOCS = ["google_calendar", "gmail"];

async function cancelStripe(db, stripe, uid) {
  const sub = (await db.doc(`users/${uid}/data/subscription`).get()).data();
  const subId = sub?.stripeSubscriptionId;
  if (!subId) return;
  if (!stripe) throw new Error("stripe_not_configured");
  try {
    await stripe.subscriptions.cancel(subId);
  } catch (e) {
    // Already cancelled or gone is fine; anything else must stop the deletion
    // so we never delete the account while the card keeps being charged.
    if (e?.code !== "resource_missing") throw e;
  }
}

// Best-effort: a failed revoke must not block deletion (the tokens are erased
// with the user's data either way).
async function revokeGoogle(db, fetchFn, uid) {
  for (const name of GOOGLE_DOCS) {
    try {
      const d = (await db.doc(`users/${uid}/integrations/${name}`).get()).data();
      const token = openToken(d?.refreshToken) || openToken(d?.accessToken);
      if (token) {
        await fetchFn("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
        });
      }
    } catch (e) { console.warn("[DeleteAccount] google revoke failed:", name, e?.message); }
  }
}

// Best-effort: remove each connected bank from Plaid so it stops syncing.
async function removePlaidItems(db, fetchFn, uid, plaid) {
  if (!plaid?.clientId || !plaid?.secret) return;
  try {
    const items = await db.collection(`users/${uid}/integrations/plaid/items`).get();
    for (const doc of items.docs) {
      try {
        await fetchFn(`${plaid.host}/item/remove`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: plaid.clientId, secret: plaid.secret, access_token: decryptSecret(doc.data().accessToken) }),
        });
      } catch (e) { console.warn("[DeleteAccount] plaid remove failed:", e?.message); }
    }
  } catch (e) { console.warn("[DeleteAccount] plaid list failed:", e?.message); }
}

async function unlinkHousehold(db, uid) {
  // As a partner in someone else's household: leave it.
  const link = (await db.doc(`users/${uid}/data/household_link`).get()).data();
  if (link?.primaryUid && link.primaryUid !== uid) {
    await db.doc(`households/${link.primaryUid}/members/${uid}`).delete();
    const inviteRef = db.doc(`users/${link.primaryUid}/data/partner_invite`);
    if ((await inviteRef.get()).data()?.partnerUid === uid) await inviteRef.delete();
  }

  // As an owner: unlink every partner, then remove the household itself.
  const partners = new Set();
  const members = await db.collection(`households/${uid}/members`).get();
  members.docs.forEach(m => { if (m.id !== uid) partners.add(m.id); });
  const myInvite = (await db.doc(`users/${uid}/data/partner_invite`).get()).data();
  if (myInvite?.partnerUid) partners.add(myInvite.partnerUid);
  for (const p of partners) {
    const ref = db.doc(`users/${p}/data/household_link`);
    if ((await ref.get()).data()?.primaryUid === uid) await ref.delete();
  }
  await db.recursiveDelete(db.doc(`households/${uid}`));

  // Pending invites this user sent.
  const invites = await db.collection("invites").where("fromUid", "==", uid).get();
  for (const inv of invites.docs) await inv.ref.delete();
}

export async function deleteAccount({ uid, db, auth, stripe, fetchFn = fetch, plaid }) {
  if (!uid) throw new Error("missing_uid");
  await cancelStripe(db, stripe, uid);
  await revokeGoogle(db, fetchFn, uid);
  await removePlaidItems(db, fetchFn, uid, plaid);
  await unlinkHousehold(db, uid);
  // Everything under users/{uid}: data, integrations (tokens, CalDAV
  // password), devices (push tokens), usage, subcollections.
  await db.recursiveDelete(db.doc(`users/${uid}`));
  await auth.deleteUser(uid);
}
