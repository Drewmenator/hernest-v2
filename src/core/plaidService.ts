// ─── Plaid client service (Wave 3) ─────────────────────────────────
// Loads the Plaid Link SDK on demand, runs the connect handshake, and
// pulls categorized transactions. The budget screen turns these into
// expenses exactly like the CSV importer does.
import { auth } from "./firebase";

const PLAID_SDK = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

export interface PlaidTxn { id: string; merchant: string; amount: number; category: string; date: string; }

async function idToken(): Promise<string | null> {
  try { return (await auth.currentUser?.getIdToken()) || null; } catch { return null; }
}

function loadSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).Plaid) return resolve((window as any).Plaid);
    const existing = document.querySelector(`script[src="${PLAID_SDK}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).Plaid));
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = PLAID_SDK;
    s.onload = () => resolve((window as any).Plaid);
    s.onerror = () => reject(new Error("plaid_sdk_load_failed"));
    document.head.appendChild(s);
  });
}

// Returns: "not_configured" if Plaid keys aren't set, "cancelled" if the
// user closes Link, or "connected" on success.
export async function connectBank(): Promise<"connected" | "cancelled" | "not_configured" | "error"> {
  const token = await idToken();
  if (!token) return "error";

  // 1. Get a Link token from our server
  const ltRes = await fetch("/api/plaid?action=link_token", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  }).catch(() => null);
  if (!ltRes) return "error";
  if (ltRes.status === 503) return "not_configured";
  const { link_token } = await ltRes.json();
  if (!link_token) return "error";

  // 2. Load the SDK and open Link
  const Plaid = await loadSdk().catch(() => null);
  if (!Plaid) return "error";

  return new Promise((resolve) => {
    const handler = Plaid.create({
      token: link_token,
      onSuccess: async (public_token: string) => {
        const exRes = await fetch("/api/plaid?action=exchange", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ public_token }),
        }).catch(() => null);
        resolve(exRes && exRes.ok ? "connected" : "error");
      },
      onExit: (err: any) => resolve(err ? "error" : "cancelled"),
    });
    handler.open();
  });
}

// Pull categorized transactions since the last sync.
export async function syncBankTransactions(): Promise<{ transactions: PlaidTxn[]; error?: string }> {
  const token = await idToken();
  if (!token) return { transactions: [], error: "not_authenticated" };
  const res = await fetch("/api/plaid?action=sync", {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res) return { transactions: [], error: "network" };
  if (res.status === 404) return { transactions: [], error: "not_connected" };
  if (res.status === 401) return { transactions: [], error: "reauth_required" };
  if (!res.ok) return { transactions: [], error: "sync_failed" };
  const data = await res.json();
  return { transactions: data.transactions || [] };
}
