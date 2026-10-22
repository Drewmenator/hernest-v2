// ─── <Emoji>: draw an emoji as a line icon ─────────────────────────
// <Emoji e="🎂" /> inline (takes the text color), or <Emoji e="🎂" tile />
// in a soft tinted square. Anything not in the map falls back to the
// character itself, so nothing ever disappears.
import { T } from "../../config/theme";
import { iconForEmoji, type IconTone } from "../emojiIcons";

const TONE: Record<IconTone, { bg: string; ink: string }> = {
  cleo:      { bg: T.cleoBg,      ink: T.action },
  household: { bg: T.householdBg, ink: T.householdInk },
  personal:  { bg: T.personalBg,  ink: T.personalInk },
  plan:      { bg: T.planBg,      ink: T.planInk },
  neutral:   { bg: T.sand,        ink: T.text2 },
};

export function Emoji({ e, size = 18, tile, color, strokeWidth = 1.9 }: {
  e: string | undefined | null;
  size?: number;        // icon size; a tile is about 1.9x this
  tile?: boolean;
  color?: string;       // inline color (default: text color, or the tone ink in a tile)
  strokeWidth?: number;
}) {
  const hit = iconForEmoji(e);
  if (!hit) return e ? <span aria-hidden="true" style={{ fontSize: size }}>{e}</span> : null;
  const [Icon, tone] = hit;
  const c = TONE[tone];
  const icon = <Icon size={size} color={color ?? (tile ? c.ink : "currentColor")} strokeWidth={strokeWidth} aria-hidden="true" />;
  if (!tile) return <span aria-hidden="true" style={{ display: "inline-flex", verticalAlign: "-0.15em" }}>{icon}</span>;
  const box = Math.round(size * 1.9);
  return (
    <span aria-hidden="true" style={{ width: box, height: box, borderRadius: Math.round(box * 0.32), background: c.bg, display: "inline-grid", placeItems: "center", flexShrink: 0, boxShadow: `inset 0 1px 0 ${T.glassStrong}` }}>
      {icon}
    </span>
  );
}
