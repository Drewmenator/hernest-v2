// ─── Choose calendars ──────────────────────────────────────────────
// Which of a person's calendars HerNest reads. Saved per person (not shared
// with the household) in data/calendar_choice:
//   { google: { picked, seen }, device: { picked, seen } }
// A calendar they've seen in the picker is read only if ticked. One that
// appeared since, or any calendar before they ever chose, follows the
// default: their own calendars in, ones shared by other people out (so a
// colleague's calendar never fills the family's Today). The server applies
// the same rule to Google (api/_lib/calendarEvents.js).
import { loadData, saveData } from "./firebase";

export interface SourceChoice { picked: string[]; seen: string[] }
export interface CalendarChoice { google?: SourceChoice; device?: SourceChoice }
export type ChoiceKey = keyof CalendarChoice;

export function isPicked(id: string, own: boolean, choice?: SourceChoice | null): boolean {
  if (choice?.seen?.includes(id)) return !!choice.picked?.includes(id);
  return own;
}

export async function loadCalendarChoice(uid: string): Promise<CalendarChoice> {
  try { return ((await loadData(uid, "calendar_choice")) as CalendarChoice | null) || {}; }
  catch { return {}; }
}

// Saves the ticks for every calendar shown in the picker.
export async function saveCalendarChoice(uid: string, key: ChoiceKey, shown: { id: string; picked: boolean }[]): Promise<void> {
  const prev = (await loadCalendarChoice(uid))[key];
  const seen = new Set([...(prev?.seen || []), ...shown.map(c => c.id)]);
  const picked = new Set((prev?.picked || []).filter(id => !shown.some(c => c.id === id)));
  shown.forEach(c => { if (c.picked) picked.add(c.id); });
  await saveData(uid, "calendar_choice", { [key]: { picked: [...picked], seen: [...seen] } });
}
