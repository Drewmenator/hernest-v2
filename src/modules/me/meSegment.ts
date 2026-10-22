// Remembers which Me view (Wellness or Style) she used last.
export type MeSegment = "wellness" | "style";
export const ME_SEGMENT_KEY = "hn_me_segment";

// Which view the plain "me" tab opens on: the one she used last.
export function lastMeSegment(): MeSegment {
  try { return localStorage.getItem(ME_SEGMENT_KEY) === "style" ? "style" : "wellness"; } catch { return "wellness"; }
}
