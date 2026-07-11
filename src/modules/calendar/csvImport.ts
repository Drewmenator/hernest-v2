// ─── CSV/TSV → calendar events ───────────────────────────────────────
// Parses a pasted/exported spreadsheet of events into {title,date,endDate}.
// Tolerant of column order/names and common date formats. (.xlsx is binary —
// users are asked to export as CSV.)

export interface CsvEvent { title: string; date: string; endDate?: string }

// Split one delimited line, honouring "quoted, fields".
function splitRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Normalise a date cell to YYYY-MM-DD, or null. Handles ISO, D/M/Y & M/D/Y
// (ambiguous → day-first), D-M-Y, and textual "12 Jan 2026" / "Jan 12, 2026".
export function normalizeDate(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const slash = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (slash) {
    let a = +slash[1], b = +slash[2];
    let y = +slash[3]; if (y < 100) y += 2000;
    // Disambiguate: if one part must be the month, use it; else day-first.
    let day: number, month: number;
    if (a > 12) { day = a; month = b; }
    else if (b > 12) { month = a; day = b; }
    else { day = a; month = b; }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const text = s.match(/(\d{1,2})\s*([A-Za-z]{3,})\s*,?\s*(\d{4})/) || s.match(/([A-Za-z]{3,})\s+(\d{1,2})\s*,?\s*(\d{4})/);
  if (text) {
    let day: number, month: number | undefined, y: number;
    if (/^\d/.test(text[1])) { day = +text[1]; month = MONTHS[text[2].slice(0, 3).toLowerCase()]; y = +text[3]; }
    else { month = MONTHS[text[1].slice(0, 3).toLowerCase()]; day = +text[2]; y = +text[3]; }
    if (!month) return null;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

const TITLE_KEYS = ["title", "event", "subject", "name", "description", "summary", "activity"];
const DATE_KEYS = ["date", "start", "day", "when", "start date", "startdate"];
const END_KEYS = ["end", "enddate", "end date", "to", "finish"];

function findCol(header: string[], keys: string[]): number {
  const lower = header.map(h => h.toLowerCase().trim());
  for (const k of keys) { const i = lower.indexOf(k); if (i >= 0) return i; }
  // fuzzy contains
  for (let i = 0; i < lower.length; i++) if (keys.some(k => lower[i].includes(k))) return i;
  return -1;
}

// Parse CSV/TSV text into events. Requires a header row naming a title and a
// date column (order-independent). Rows with an unparseable date are skipped.
export function parseCsvEvents(text: string): CsvEvent[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/\t/) ? "\t" : lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",");
  const header = splitRow(lines[0], delim);
  const ti = findCol(header, TITLE_KEYS);
  const di = findCol(header, DATE_KEYS);
  if (ti < 0 || di < 0) return [];
  const ei = findCol(header, END_KEYS);

  const events: CsvEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i], delim);
    const title = (cells[ti] || "").trim();
    const date = normalizeDate(cells[di]);
    if (!title || !date) continue;
    const endDate = ei >= 0 ? normalizeDate(cells[ei]) || undefined : undefined;
    events.push({ title, date, endDate });
  }
  return events;
}
