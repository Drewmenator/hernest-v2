import { adminDb, applyCors, verifyAuth } from "../_lib/secure.js";

export default async function handler(req, res) {
  if (applyCors(req, res, "GET, OPTIONS")) return;

  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

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
