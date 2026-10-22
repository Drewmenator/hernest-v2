// ─── Undo toast ────────────────────────────────────────────────────
// Kept apart from the components file so fast refresh keeps working.
import toast from "react-hot-toast";
import { T, F } from "../../config/theme";

// After marking something paid or done: a short toast with Undo.
export function showUndoToast(message: string, onUndo: () => void, ms = 5000) {
  toast((t) => (
    <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span>{message}</span>
      <button onClick={() => { toast.dismiss(t.id); onUndo(); }}
        style={{ background: "none", border: "none", color: T.cleoBg, fontFamily: F.sans, fontSize: 15, fontWeight: 700, cursor: "pointer", minHeight: 36, padding: "0 4px" }}>
        Undo
      </button>
    </span>
  ), { duration: ms });
}

