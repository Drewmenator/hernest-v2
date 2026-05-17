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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { uid, email, password } = req.query;
  if (!uid || !email || !password) return res.status(400).json({ error: "Missing credentials" });

  try {
    // Test CalDAV connection
    const testRes = await fetch("https://caldav.icloud.com/", {
      method: "PROPFIND",
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString("base64")}`,
        "Content-Type": "application/xml",
        Depth: "0",
      },
      body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`,
    });

    if (!testRes.ok && testRes.status !== 207) {
      return res.status(401).json({ error: "Invalid credentials — check your app-specific password" });
    }

    await adminDb.doc(`users/${uid}/integrations/apple_calendar`).set({
      email,
      password: Buffer.from(password).toString("base64"),
      connectedAt: Date.now(),
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[Apple auth]", e);
    res.status(500).json({ error: "Connection failed" });
  }
}
