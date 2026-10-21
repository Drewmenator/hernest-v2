// ─── Bills from a screenshot or one typed line (logic) ─────────────
// The AI only proposes bills; the user ticks which ones to keep. Everything it
// returns is checked here (names, amounts, days, cadences) and anything it was
// not sure about is flagged, never guessed silently.
import { ai, aiWithImages, type AIImage } from "../../core/ai";
import { billKey, iso, type Bill, type Cadence } from "../../core/bills";

export interface BillSuggestion {
  key: string;              // stable id for the review list
  name: string;
  amount?: number;
  cadence: Cadence;
  dueDay?: number;
  dueDate?: string;
  autopay?: boolean;
  unsure: boolean;          // the AI was not confident (e.g. guessed the day from a past charge)
  duplicateOf?: string;     // name of an existing bill this matches
}

const CADENCE_IDS: Cadence[] = ["weekly", "biweekly", "monthly", "quarterly", "semiannual", "yearly", "once"];

const SHARED_RULES = `Return ONLY JSON, no prose, in exactly this shape:
{"bills":[{"name":"string","amount":number|null,"cadence":"weekly|biweekly|monthly|quarterly|semiannual|yearly|once","dueDay":1-31|null,"dueDate":"YYYY-MM-DD"|null,"autopay":true|false|null,"confidence":"high|low"}]}
Rules:
- Only regular bills and subscriptions: rent, mortgage, utilities, phone, internet, insurance, loan and credit card payments, childcare, streaming, apps, gym, memberships.
- Never include one-off shopping (groceries, restaurants, gas station, Amazon orders, transfers between own accounts, income).
- Never invent a name, amount or date. Use null when it is not shown.
- Use the merchant's plain name ("Netflix", not "NETFLIX.COM 866-579").
- For monthly bills give dueDay. For other cadences give dueDate (the next or most recent date shown).
- If you inferred the due day from a past charge date rather than a stated due date, set confidence "low".
- Credit card: use the payment due date and the minimum payment if shown, else the statement balance.
- If nothing qualifies, return {"bills":[]}.`;

function scanSystem(today: string): string {
  return `You read screenshots a user took to set up bill reminders in a family organiser app. Today is ${today}.
The screenshots may show a bank or card app, a list of transactions, the iPhone Settings > Subscriptions page, an e-bill, or a utility account page.
${SHARED_RULES}`;
}

function parseSystem(today: string): string {
  return `You turn a short note a user typed about their household bills into structured bills. Today is ${today}.
Examples: "daycare 450 every other friday", "car insurance march and september 620", "netflix 15.49 on the 12th".
"Every other week" means biweekly. "Twice a year" or two months six apart means semiannual (dueDate = the next of those dates).
${SHARED_RULES}`;
}

// Pull the first JSON object out of the reply (tolerates code fences).
export function extractJSON(text: string): unknown {
  const clean = text.replace(/```json|```/g, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
}

// Check and tidy whatever the model returned. Exported for tests.
export function sanitizeSuggestions(raw: unknown, existing: Bill[]): BillSuggestion[] {
  const list = (raw as { bills?: unknown })?.bills;
  if (!Array.isArray(list)) return [];
  const existingByKey = new Map(existing.map(b => [billKey(b.name), b.name]));
  const seen = new Set<string>();
  const out: BillSuggestion[] = [];

  for (const item of list.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (!name) continue;
    const key = billKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const cadence = CADENCE_IDS.includes(r.cadence as Cadence) ? (r.cadence as Cadence) : "monthly";
    const amountNum = typeof r.amount === "number" ? r.amount : Number(r.amount);
    const amount = Number.isFinite(amountNum) && amountNum > 0 && amountNum < 100000 ? Math.round(amountNum * 100) / 100 : undefined;
    const dayNum = Math.round(Number(r.dueDay));
    const dateStr = typeof r.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) ? r.dueDate : undefined;

    let dueDay: number | undefined;
    let dueDate: string | undefined;
    if (cadence === "monthly") {
      dueDay = dayNum >= 1 && dayNum <= 31 ? dayNum : dateStr ? Number(dateStr.slice(8, 10)) : undefined;
    } else {
      dueDate = dateStr;
    }

    out.push({
      key,
      name,
      amount,
      cadence,
      dueDay,
      dueDate,
      autopay: r.autopay === true ? true : undefined,
      unsure: r.confidence !== "high" || (cadence === "monthly" ? !dueDay : !dueDate),
      duplicateOf: existingByKey.get(key),
    });
  }
  return out;
}

export function suggestionToBill(s: BillSuggestion, source: Bill["source"], now = new Date()): Bill {
  const hasDate = s.cadence === "monthly" ? !!s.dueDay : !!s.dueDate;
  return {
    id: crypto.randomUUID(),
    name: s.name,
    ...(s.amount ? { amount: s.amount } : {}),
    cadence: s.cadence,
    ...(s.dueDay ? { dueDay: s.dueDay } : {}),
    ...(s.dueDate ? { dueDate: s.dueDate } : {}),
    ...(hasDate ? {} : { dueUnknown: true }),
    ...(s.autopay ? { autopay: true } : {}),
    addedOn: iso(now),
    source,
  };
}

export async function billsFromScreenshots(images: AIImage[], existing: Bill[]): Promise<{ suggestions: BillSuggestion[]; error?: string }> {
  const res = await aiWithImages(
    scanSystem(iso(new Date())),
    images,
    `Find every regular bill or subscription in ${images.length === 1 ? "this screenshot" : "these screenshots"}.`,
    "bill_scan",
  );
  if (res.error) return { suggestions: [], error: res.code };
  return { suggestions: sanitizeSuggestions(extractJSON(res.text), existing) };
}

export async function billsFromText(note: string, existing: Bill[]): Promise<{ suggestions: BillSuggestion[]; error?: string }> {
  const res = await ai(parseSystem(iso(new Date())), note.slice(0, 1000), "bill_parse");
  if (res.error) return { suggestions: [], error: res.code };
  return { suggestions: sanitizeSuggestions(extractJSON(res.text), existing) };
}

// Shrink a photo before upload: screenshots are large and the server caps
// request size. Longest side 1600px, JPEG. Returns base64 without the prefix.
export async function fileToImage(file: File, maxSide = 1600): Promise<AIImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image_load_failed"));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no_canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.82).split(",")[1] };
  } finally {
    URL.revokeObjectURL(url);
  }
}
