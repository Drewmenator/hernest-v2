// ─── Gmail receipts inbox ──────────────────────────────────────────
// gmailIntelligence extracts receipts into the gmail_receipts doc — until
// now nothing ever showed them to the user (dead-end data from the audit).
// Pending receipts surface here; approving one becomes a real expense.
import React, { useEffect, useState } from "react";
import { T, F } from "../../config/theme";
import { useStore } from "../../core/store";
import { loadData, saveData } from "../../core/firebase";
import { formatMoney } from "../../shared/utils/money";

export interface GmailReceipt {
  merchant: string;
  amount: number;
  date: string;
  category: string;
  status: "pending" | "applied" | "dismissed";
  foundAt: number;
}

export function ReceiptsInbox({ onApprove }: {
  // Parent (BudgetScreen) owns expenses/categories — it turns an approved
  // receipt into an expense and updates category spend.
  onApprove: (r: GmailReceipt) => Promise<void>;
}) {
  const { user } = useStore();
  const [receipts, setReceipts] = useState<GmailReceipt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    loadData(user.uid, "gmail_receipts").then(d => {
      const all = (d?.receipts as GmailReceipt[]) || [];
      setReceipts(all.filter(r => r.status === "pending"));
    }).catch(() => {});
  }, [user?.uid]);

  const settle = async (r: GmailReceipt, status: "applied" | "dismissed") => {
    if (!user?.uid) return;
    const key = `${r.merchant}_${r.date}_${r.amount}`;
    setBusy(key);
    try {
      if (status === "applied") await onApprove(r);
      const d = await loadData(user.uid, "gmail_receipts");
      const all = (d?.receipts as GmailReceipt[]) || [];
      await saveData(user.uid, "gmail_receipts", {
        receipts: all.map(x => `${x.merchant}_${x.date}_${x.amount}` === key ? { ...x, status } : x),
      });
      setReceipts(p => p.filter(x => `${x.merchant}_${x.date}_${x.amount}` !== key));
    } finally {
      setBusy(null);
    }
  };

  if (!receipts.length) return null;

  return (
    <div style={{ background: T.ivory, border: `1.5px solid ${T.gold}40`, borderRadius: 16, padding: "14px 16px", marginBottom: 12 }}>
      <p style={{ fontFamily: F.sans, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.goldText, margin: "0 0 10px" }}>
        ✉ FROM YOUR INBOX · {receipts.length} receipt{receipts.length === 1 ? "" : "s"} to review
      </p>
      {receipts.slice(0, 5).map(r => {
        const key = `${r.merchant}_${r.date}_${r.amount}`;
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.linen}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.esp, margin: 0 }}>{r.merchant} · {formatMoney(r.amount)}</p>
              <p style={{ fontFamily: F.sans, fontSize: 10.5, color: T.taupe, margin: "1px 0 0" }}>{r.date} · {r.category}</p>
            </div>
            <button onClick={() => settle(r, "applied")} disabled={busy === key} aria-label={`Add ${r.merchant} expense`}
              style={{ background: T.esp, color: "#fff", border: "none", borderRadius: 10, padding: "7px 14px", fontFamily: F.sans, fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0, minHeight: 34 }}>
              {busy === key ? "..." : "Add"}
            </button>
            <button onClick={() => settle(r, "dismissed")} disabled={busy === key} aria-label={`Dismiss ${r.merchant} receipt`}
              style={{ background: "none", border: `1px solid ${T.linen}`, borderRadius: 10, padding: "7px 12px", fontFamily: F.sans, fontSize: 12, color: T.taupe, cursor: "pointer", flexShrink: 0, minHeight: 34 }}>
              Skip
            </button>
          </div>
        );
      })}
    </div>
  );
}
