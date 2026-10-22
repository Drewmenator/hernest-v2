// ─── Upload a school calendar (Plan → School) ──────────────────────
// Pick the child, choose the school's calendar (an .ics file, a CSV, a
// PDF or a photo), check what was found, then add it. Dates are saved with
// the household's events tagged with the child's name, so they show in
// Week and Month, on Today and to Cleo. Uploading again for the same child
// replaces their earlier school calendar.
import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { T, F, TYPE, S, ATMOS_TEXT2 } from "../../config/theme";
import { useStore } from "../../core/store";
import { loadData, saveData } from "../../core/firebase";
import { bus } from "../../core/events";
import { aiWithFiles, type AIDocument, type AIImage } from "../../core/ai";
import { s } from "../../core/aiSchema";
import { Card, Button, Pill, TextButton, ListRow, Emoji } from "../../shared/components";
import { CalendarPlus, FileUp } from "lucide-react";
import { fileToImage } from "../bills/billReader";
import { parseCsvEvents } from "../calendar/csvImport";
import { parseIcs, toSchoolEvents, replaceChildSchool, SCHOOL_CALENDAR_SYSTEM, type SchoolDate } from "./schoolCalendar";
import type { CalEvent } from "./useCalendarEvents";
import type { Person } from "../../core/familyPeople";

const MAX_PDF_BYTES = 3_000_000;
const SCHEMA = s.object({
  events: s.array(s.object({ title: s.string(), date: s.string("YYYY-MM-DD"), endDate: s.nullable(s.string("YYYY-MM-DD")) })),
});

const fmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

async function readPdf(file: File): Promise<AIDocument> {
  const data = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  return { mediaType: "application/pdf", data };
}

export function SchoolCalendarUpload({ people, onAdded }: { people: Person[]; onAdded?: () => void }) {
  const uid = useStore(st => st.user?.uid);
  const setActiveTab = useStore(st => st.setActiveTab);
  const kids = people.filter(p => p.role === "child");
  const [childId, setChildId] = useState<string>(kids.length === 1 ? kids[0].id : "");
  const [busy, setBusy] = useState<"" | "reading" | "saving">("");
  const [found, setFound] = useState<{ dates: SchoolDate[]; file: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const child = kids.find(k => k.id === childId) || null;

  const choose = () => {
    if (!child) { toast("Pick whose calendar this is first."); return; }
    fileRef.current?.click();
  };

  const read = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    setBusy("reading");
    try {
      let dates: SchoolDate[] = [];
      if (ext === "ics" || ext === "ical") {
        const text = await file.text();
        if (!text.includes("BEGIN:VCALENDAR")) { toast.error("That doesn't look like a calendar (.ics) file."); return; }
        dates = parseIcs(text);
      } else if (ext === "csv" || ext === "tsv") {
        dates = parseCsvEvents(await file.text());
        if (!dates.length) { toast.error("Couldn't read that CSV. It needs a header row with a title and a date column."); return; }
      } else if (ext === "xlsx" || ext === "xls") {
        toast("In your spreadsheet choose File, then Save As, then CSV, and upload that.", { duration: 6000 });
        return;
      } else if (ext === "pdf" || file.type.startsWith("image/") || ["png", "jpg", "jpeg", "heic", "webp"].includes(ext)) {
        if (ext === "pdf" && file.size > MAX_PDF_BYTES) { toast.error("That PDF is too large. Try a photo of the calendar page instead."); return; }
        const doc: AIImage | AIDocument = ext === "pdf" ? await readPdf(file) : await fileToImage(file);
        const res = await aiWithFiles(SCHOOL_CALENDAR_SYSTEM, [doc], "List every dated item on this school calendar.", "school_calendar", SCHEMA);
        if (res.error) {
          toast.error(res.code === "unauthenticated" ? "Please sign in again." : "Cleo couldn't read that just now. Try again, or use the school's .ics file.");
          return;
        }
        try { dates = (JSON.parse(res.text.replace(/```json|```/g, "").trim()).events || []) as SchoolDate[]; }
        catch { dates = []; }
      } else {
        toast.error("Use an .ics file, a CSV, a PDF or a photo of the calendar.");
        return;
      }
      if (!dates.length) { toast.error("No dates found. Try a clearer photo, or the school's .ics file."); return; }
      setFound({ dates, file: file.name });
    } catch {
      toast.error("Couldn't open that file. Try again.");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const add = async () => {
    if (!uid || !child || !found) return;
    setBusy("saving");
    try {
      const incoming = toSchoolEvents(found.dates, { name: child.name, color: child.color });
      const saved = ((await loadData(uid, "calendar"))?.events as CalEvent[]) || [];
      await saveData(uid, "calendar", { events: JSON.parse(JSON.stringify(replaceChildSchool(saved, child.name, incoming))) });
      bus.publish("calendar.synced", { source: "school_upload", count: incoming.length }, { userId: uid, source: "plan" }).catch(() => {});
      toast.success(`${incoming.length} school date${incoming.length === 1 ? "" : "s"} added for ${child.name}`);
      setFound(null);
      onAdded?.();
    } catch {
      toast.error("Couldn't save. Try again.");
    } finally {
      setBusy("");
    }
  };

  const label: React.CSSProperties = { fontFamily: F.sans, fontSize: TYPE.support, fontWeight: 600, color: T.text, margin: "0 0 8px" };

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: S.md, marginBottom: S.md }}>
        <Emoji e="📅" tile size={18} />
        <div style={{ minWidth: 0 }}>
          <p style={{ fontFamily: F.display, fontSize: 20, fontWeight: 500, color: T.text, margin: 0 }}>Upload a school calendar</p>
          <p style={{ fontFamily: F.sans, fontSize: TYPE.support, color: ATMOS_TEXT2, margin: "2px 0 0", lineHeight: 1.4 }}>
            An .ics file, a CSV, a PDF or a photo of the school year calendar.
          </p>
        </div>
      </div>

      {kids.length === 0 ? (
        <ListRow divider={false} title="Add your kids first" detail="School calendars are saved per child. Add them in Your family."
          trailing={<TextButton onClick={() => setActiveTab("family")}>Open ›</TextButton>} />
      ) : !found ? (
        <>
          <p style={label}>Whose calendar is this?</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: S.md }}>
            {kids.map(k => <Pill key={k.id} label={k.name} active={k.id === childId} onClick={() => setChildId(k.id)} />)}
          </div>
          <input ref={fileRef} type="file" hidden accept=".ics,.ical,.csv,.tsv,.pdf,image/*,.xlsx,.xls"
            onChange={e => { const f = e.target.files?.[0]; if (f) read(f); }} />
          <Button onClick={choose} disabled={!!busy} variant={child ? "primary" : "secondary"}>
            <FileUp size={18} strokeWidth={1.9} aria-hidden="true" />
            {busy === "reading" ? "Cleo is reading..." : child ? `Choose ${child.name}'s calendar` : "Choose a file"}
          </Button>
        </>
      ) : (
        <>
          <p style={{ fontFamily: F.sans, fontSize: TYPE.body, fontWeight: 700, color: T.text, margin: "0 0 2px" }}>
            Found {found.dates.length} date{found.dates.length === 1 ? "" : "s"} for {child?.name}
          </p>
          <p style={{ fontFamily: F.sans, fontSize: 13, color: T.text2, margin: "0 0 8px" }}>From {found.file}. Check them, then add.</p>
          <div style={{ maxHeight: 220, overflowY: "auto", borderTop: `1px solid ${T.divider}`, marginBottom: S.md }}>
            {[...found.dates].sort((a, b) => a.date.localeCompare(b.date)).map((d, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "9px 2px", borderBottom: `1px solid ${T.divider}` }}>
                <span style={{ width: 96, flexShrink: 0, fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: T.planInk, fontVariantNumeric: "tabular-nums" }}>
                  {/^\d{4}-\d{2}-\d{2}$/.test(d.date) ? fmt(d.date) : d.date}
                </span>
                <span style={{ fontFamily: F.sans, fontSize: 14, color: T.text, lineHeight: 1.35 }}>
                  {d.title}{d.endDate && d.endDate > d.date ? <span style={{ color: T.text2 }}> · until {fmt(d.endDate)}</span> : null}
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontFamily: F.sans, fontSize: 13, color: T.text2, margin: "0 0 12px" }}>This replaces {child?.name}'s earlier school calendar, if there was one.</p>
          <Button onClick={add} disabled={busy === "saving"}>
            <CalendarPlus size={18} strokeWidth={1.9} aria-hidden="true" />
            {busy === "saving" ? "Adding..." : `Add to ${child?.name}'s calendar`}
          </Button>
          <div style={{ textAlign: "center", marginTop: 4 }}>
            <TextButton onClick={() => setFound(null)} color={T.text2}>Cancel</TextButton>
          </div>
        </>
      )}
    </Card>
  );
}
