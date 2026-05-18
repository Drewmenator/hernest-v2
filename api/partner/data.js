import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({ credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  })});
}

const adminDb = getFirestore();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  try {
    const linkDoc = await adminDb.doc(`users/${uid}/data/household_link`).get();
    if (!linkDoc.exists) return res.status(404).json({ error: "Not linked to a household" });

    const { primaryUid, shareCategories } = linkDoc.data();
    const sharedData = {};
    await Promise.all(shareCategories.map(async (cat) => {
      try {
        const doc = await adminDb.doc(`users/${primaryUid}/data/${cat}`).get();
        if (doc.exists) sharedData[cat] = doc.data();
      } catch {}
    }));

    res.json({ primaryUid, shareCategories, data: sharedData });
  } catch (e) {
    console.error("[Partner data] Error:", e);
    res.status(500).json({ error: "Failed to fetch partner data" });
  }
}
