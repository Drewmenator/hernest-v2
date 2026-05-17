// ─── HerNest Connectivity Layer ───────────────────────────────────
// Subscribes to events from all modules and triggers cross-module actions.
// This is the "magic" — one change ripples everywhere.

import { bus } from "./events";
import { db } from "./db";
import { saveData, loadData } from "./firebase";
import { useStore } from "./store";

export function initConnectivity(userId: string) {

  // ── 1. MOOD LOGGED → Briefing tone changes ─────────────────────
  bus.subscribe("thrive.mood.logged", async (e: any) => {
    const { rating, label } = e.payload;
    console.log("[Connectivity] mood logged:", label, rating);

    // Invalidate today's briefing so it regenerates with new tone
    await bus.publish("briefing.invalidate", { reason: "mood_changed", mood: label }, { userId, source: "connectivity" });

    // Update store so Nora knows current mood
    const store = useStore.getState();
    if (store.profile) {
      store.updateProfile({ challenge: label === "overwhelmed" || label === "struggling" ? label : store.profile.challenge });
    }
  });

  // ── 2. NEWSLETTER PARSED → Calendar auto-updated ───────────────
  bus.subscribe("plan.school.newsletter.parsed", async (e: any) => {
    const { events } = e.payload;
    console.log("[Connectivity] newsletter parsed, adding to calendar:", events);

    if (!events || events === 0) return;

    // Load school events and add to calendar
    const [schoolData, calendarData] = await Promise.all([
      loadData(userId, "school"),
      loadData(userId, "calendar"),
    ]);

    const schoolEvents = (schoolData?.events as any[]) || [];
    const calEvents = (calendarData?.events as any[]) || [];

    // Convert school events to calendar events
    const newCalEvents = schoolEvents
      .filter((e: any) => e.date)
      .map((e: any) => ({
        id: `school_${e.id}`,
        title: e.title,
        date: e.date,
        time: "",
        source: "school",
        type: e.type,
        color: "#E07B9A",
      }));

    // Merge avoiding duplicates
    const existingIds = new Set(calEvents.map((e: any) => e.id));
    const toAdd = newCalEvents.filter((e: any) => !existingIds.has(e.id));

    if (toAdd.length > 0) {
      const updated = [...calEvents, ...toAdd];
      await saveData(userId, "calendar", { events: updated });
      await bus.publish("calendar.synced", { added: toAdd.length, source: "school" }, { userId, source: "connectivity" });
      console.log(`[Connectivity] Added ${toAdd.length} school events to calendar`);
    }
  });

  // ── 3. BUDGET THRESHOLD → Home alert + Nora context ───────────
  bus.subscribe("budget.threshold.hit", async (e: any) => {
    const { category, percentUsed, amount } = e.payload;
    console.log("[Connectivity] budget threshold hit:", category, percentUsed);

    // Store budget alert in a way Nora can read
    const existing = await loadData(userId, "alerts") || {};
    const alerts = (existing.alerts as any[]) || [];
    const newAlert = {
      id: crypto.randomUUID(),
      type: "budget",
      message: `${category} at ${percentUsed}% of budget`,
      severity: percentUsed >= 95 ? "critical" : "warning",
      createdAt: Date.now(),
      read: false,
    };
    await saveData(userId, "alerts", { alerts: [newAlert, ...alerts.slice(0, 9)] });
  });

  // ── 4. TRIP CREATED → Calendar blocked ────────────────────────
  bus.subscribe("trips.trip.created", async (e: any) => {
    const trip = e.payload;
    console.log("[Connectivity] trip created, blocking calendar:", trip.destination);

    if (!trip.departureDate || !trip.returnDate) return;

    const calendarData = await loadData(userId, "calendar");
    const calEvents = (calendarData?.events as any[]) || [];

    // Add trip to calendar as a multi-day event
    const tripEvent = {
      id: `trip_${trip.id}`,
      title: `✈ ${trip.destination}`,
      date: trip.departureDate,
      endDate: trip.returnDate,
      source: "trips",
      type: "trip",
      color: "#D4A574",
      allDay: true,
    };

    const existingIds = new Set(calEvents.map((e: any) => e.id));
    if (!existingIds.has(tripEvent.id)) {
      const updated = [...calEvents, tripEvent];
      await saveData(userId, "calendar", { events: updated });
      console.log(`[Connectivity] Trip ${trip.destination} added to calendar`);
    }
  });

  // ── 5. CIRCLE OVERDUE → Nora context updated ──────────────────
  bus.subscribe("circle.checkin.due", async (e: any) => {
    const { contact, daysSince } = e.payload;
    console.log("[Connectivity] circle checkin due:", contact, daysSince);

    // Store as alert for Home and Nora
    const existing = await loadData(userId, "alerts") || {};
    const alerts = (existing.alerts as any[]) || [];
    const newAlert = {
      id: `circle_${contact}`,
      type: "circle",
      message: `${contact} — ${daysSince} days since last contact`,
      severity: "low",
      createdAt: Date.now(),
      read: false,
    };
    // Replace existing circle alert for same contact
    const filtered = alerts.filter((a: any) => a.id !== `circle_${contact}`);
    await saveData(userId, "alerts", { alerts: [newAlert, ...filtered.slice(0, 9)] });
  });

  // ── 6. BRIEFING INVALIDATE → Clear cache ──────────────────────
  bus.subscribe("briefing.invalidate", async (e: any) => {
    console.log("[Connectivity] briefing invalidated:", e.payload);
    // Clear IndexedDB briefing cache so it regenerates
    try {
      await db.clearBriefing();
    } catch {}
  });

  // ── 7. TASK COMPLETED → Update Intelligence card ──────────────
  bus.subscribe("plan.task.completed", async (e: any) => {
    console.log("[Connectivity] task completed:", e.payload);
    // Trigger a subtle store update so Home re-renders
    window.dispatchEvent(new CustomEvent("hernest:data_updated", { detail: { module: "plan" } }));
  });

  // ── 8. EXPENSE LOGGED → Check thresholds ──────────────────────
  bus.subscribe("budget.expense.logged", async (e: any) => {
    const budgetData = await loadData(userId, "budget");
    const categories = (budgetData?.categories as any[]) || [];

    for (const cat of categories) {
      if (cat.budget > 0) {
        const pct = Math.round((cat.spent / cat.budget) * 100);
        if (pct >= 80) {
          await bus.publish("budget.threshold.hit",
            { category: cat.label, percentUsed: pct, amount: cat.spent },
            { userId, source: "connectivity" }
          );
        }
      }
    }
  });

  // ── 9. PROFILE UPDATED → Clear briefing cache ─────────────────
  bus.subscribe("profile.updated", async () => {
    console.log("[Connectivity] profile updated — clearing briefing cache");
    try {
      await db.clearBriefing();
    } catch {}
  });

  // ── 10. NORA CRISIS DETECTED → Save care flag ─────────────────
  bus.subscribe("nora.crisis.detected", async (e: any) => {
    console.log("[Connectivity] crisis detected — saving care flag");
    try {
      await saveData(userId, "alerts", {
        alerts: [{
          id: `crisis_${Date.now()}`,
          type: "crisis",
          message: "Nora detected you may be struggling. Be gentle with yourself today.",
          severity: "high",
          createdAt: Date.now(),
          read: false,
        }]
      });
    } catch {}
  });

  // ── 11. STYLE PREFERENCE UPDATED → Invalidate briefing ────────
  bus.subscribe("style.preference.updated", async () => {
    try { await db.clearBriefing(); } catch {}
  });

  // ── 12. THRIVE SLEEP LOGGED → Update briefing context ─────────
  bus.subscribe("thrive.sleep.logged", async (e: any) => {
    const { hours } = e.payload;
    if (hours < 6) {
      const existing = await loadData(userId, "alerts") || {};
      const alerts = (existing.alerts as any[]) || [];
      const alert = {
        id: "sleep_alert",
        type: "thrive",
        message: `Only ${hours}h sleep — Nora will adjust your day accordingly`,
        severity: "low",
        createdAt: Date.now(),
        read: false,
      };
      await saveData(userId, "alerts", { alerts: [alert, ...alerts.filter((a:any) => a.id !== "sleep_alert").slice(0, 9)] });
    }
  });

  // ── 14. FAMILY UPDATED → Sync school calendars to main calendar ──
  bus.subscribe("family.updated", async () => {
    try {
      const familyData = await loadData(userId, "family");
      const members = (familyData?.members as any[]) || [];
      const children = members.filter(m => m.role === "child" && m.schoolInfo);

      if (!children.length) return;

      const calendarData = await loadData(userId, "calendar");
      const existing = (calendarData?.events as any[]) || [];

      // Remove old school-term events
      const filtered = existing.filter((e: any) => e.source !== "school-term");

      // Add term dates from each child
      const newEvents: any[] = [];
      for (const child of children) {
        const si = child.schoolInfo;
        if (!si?.termDates?.length) continue;
        for (const td of si.termDates) {
          if (!td.start || !td.end) continue;
          newEvents.push({
            id: `term_${child.id}_${td.term}`,
            title: `${child.name} — ${td.term}`,
            date: td.start,
            endDate: td.end,
            source: "school-term",
            color: child.color || "#4CAF7D",
            child: child.name,
          });
          // Add term end as holiday
          newEvents.push({
            id: `holiday_${child.id}_${td.term}`,
            title: `${child.name} — ${td.term} ends`,
            date: td.end,
            source: "school-term",
            color: child.color || "#4CAF7D",
            child: child.name,
          });
        }
      }

      if (newEvents.length > 0) {
        await saveData(userId, "calendar", { events: [...filtered, ...newEvents] });
        console.log("[Connectivity] synced", newEvents.length, "school term events to calendar");
      }
    } catch(e) { console.error("[Connectivity] school calendar sync failed:", e); }
  });

  console.log("[Connectivity] Wired up for user:", userId);
}
