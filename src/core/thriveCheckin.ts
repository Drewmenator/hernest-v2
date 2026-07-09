// ─── Thrive check-in brain ─────────────────────────────────────────
// Cleo's morning check-in paragraph + the single contextual nudge.
// Pure logic exported for tests; AI generation with a strict
// no-invented-data prompt and a static fallback built from real numbers.
import type { WearableDay } from "./wellnessAutoTrack";

// ── Nudge: at most ONE, priority-ordered, always skippable ─────────
export interface Nudge { id: string; text: string; }

export function pickNudge(w: WearableDay | null, waterGlasses: number, hour: number): Nudge | null {
  if (!w) return null;
  // 1. Long sedentary stretch (afternoon onwards, when it's actionable)
  if (w.sedentaryMins != null && w.sedentaryMins >= 360 && hour >= 12 && hour < 20) {
    return { id: "sedentary", text: "You've been still for most of the day — even a 10-minute walk resets more than you'd think." };
  }
  // 2. Stress-heavy day with little recovery → protect the evening
  if (w.stressHighMins != null && w.stressHighMins >= 120 && (w.recoveryHighMins ?? 0) < 30 && hour >= 15) {
    return { id: "stress_evening", text: "Today has carried more stress than recovery. Keep tonight light if you can — you've earned it." };
  }
  // 3. Behind on water late in the day
  if (waterGlasses < 4 && hour >= 15 && hour < 21) {
    return { id: "water", text: `Only ${waterGlasses} glass${waterGlasses === 1 ? "" : "es"} of water so far — a couple before dinner keeps the evening headache away.` };
  }
  return null;
}

// ── Static check-in (fallback + no-AI path). Real numbers only. ────
export function buildCheckinFallback(w: WearableDay | null, name: string): string {
  if (!w || (w.sleepHours == null && w.readiness == null)) {
    return `Good morning${name ? `, ${name}` : ""} ✦ I don't have your night's data yet — how are you feeling today?`;
  }
  const bits: string[] = [];
  if (w.sleepHours != null) bits.push(`you slept ${w.sleepHours}h${w.sleepScore != null ? ` (score ${w.sleepScore})` : ""}`);
  if (w.readiness != null) bits.push(`your body's at ${w.readiness} readiness`);
  if (w.stressDay === "restored") bits.push("and yesterday ended more restored than stressed");
  else if (w.stressDay === "stressful") bits.push("and yesterday ran stressful — today gets to be gentler");

  const tone =
    w.readiness == null ? "" :
    w.readiness >= 85 ? " A genuinely strong day — good one for the thing you've been putting off." :
    w.readiness >= 60 ? " A steady day — pace yourself and it'll all fit." :
    " Your body's asking for a lighter day. Protect what you can.";

  return `Good morning${name ? `, ${name}` : ""} ✦ ${bits.join(", ")}.${tone} The one thing I can't measure: how do you feel?`;
}

// ── AI check-in with cache + fallback ───────────────────────────────
export async function generateCheckin(uid: string, name: string, w: WearableDay | null): Promise<string> {
  const fallback = buildCheckinFallback(w, name);
  if (!w) return fallback;

  try {
    const [{ ai }, { loadData, saveData }] = await Promise.all([import("./ai"), import("./firebase")]);
    const today = new Date().toISOString().split("T")[0];

    // Cache: one generation per day
    const cached = await loadData(uid, "thrive_checkin");
    if (cached?.date === today && typeof cached.text === "string" && cached.text) return cached.text as string;

    const facts = [
      w.sleepHours != null ? `Sleep: ${w.sleepHours}h${w.sleepScore != null ? `, score ${w.sleepScore}/100` : ""}` : null,
      w.readiness != null ? `Readiness: ${w.readiness}/100` : null,
      w.avgHrv != null ? `Average HRV: ${w.avgHrv}ms` : null,
      w.restingHr != null ? `Resting HR: ${w.restingHr}bpm` : null,
      w.stressDay ? `Yesterday's stress balance: ${w.stressDay} (${w.stressHighMins ?? 0}min stress-high vs ${w.recoveryHighMins ?? 0}min recovery-high)` : null,
      w.steps != null ? `Steps so far today: ${w.steps}` : null,
    ].filter(Boolean).join("\n");

    const sys = `You are Cleo, a warm household chief of staff. Write ONE short check-in paragraph (2-3 sentences, max 55 words) for ${name || "her"} using ONLY the measured data below. Rules:
- Reference 2-3 of the strongest signals in plain language — no jargon, no listing every number
- Never invent data. Never mention data you weren't given.
- Tone follows readiness: low (<60) = protective and permission-giving; mid = steady; high (85+) = quietly energizing
- End by asking how she feels — that's the one thing you can't measure
- No greetings like "Good morning" (the UI adds context), no emoji except at most one ✦`;

    const result = await ai(sys, facts, "cleo_checkin");
    if (result.error || !result.text.trim()) return fallback;
    const text = result.text.trim();
    await saveData(uid, "thrive_checkin", { date: today, text }).catch(() => {});
    return text;
  } catch {
    return fallback;
  }
}
