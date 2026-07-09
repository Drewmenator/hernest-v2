import { adminDb, applyCors, verifyAuth, encryptSecret } from "../_lib/secure.js";

export default async function handler(req, res) {
  if (applyCors(req, res, "POST, OPTIONS")) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const uid = await verifyAuth(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing credentials" });

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
      password: encryptSecret(password),
      connectedAt: Date.now(),
    });

    res.json({ success: true });
  } catch (e) {
    console.error("[Apple auth]", e?.message);
    res.status(500).json({ error: "Connection failed" });
  }
}
