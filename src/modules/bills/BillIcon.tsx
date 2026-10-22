// ─── Bill icons ────────────────────────────────────────────────────
// One line-icon set (Lucide, same rounded 24px style as the app's own
// icons) in a soft tile whose color says what kind of bill it is: home
// and utilities sage, subscriptions blue, family and health blush.
// Works from the setup preset id or, for saved bills, the bill's name.
import { billIconFor, KIND } from "./billIcons";

// The tile. `selected` turns it white-on-indigo for picked setup chips.
export function BillIcon({ name, presetId, size = 36, selected }: { name: string; presetId?: string; size?: number; selected?: boolean }) {
  const [Icon, kind] = billIconFor(name, presetId);
  const c = KIND[kind];
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: Math.round(size * 0.32), flexShrink: 0, display: "inline-grid", placeItems: "center",
      background: selected ? "rgba(255,255,255,.16)" : c.bg,
      boxShadow: selected ? "none" : "inset 0 1px 0 rgba(255,255,255,.7)",
    }}>
      <Icon size={Math.round(size * 0.53)} color={selected ? "#fff" : c.ink} strokeWidth={1.9} />
    </span>
  );
}
