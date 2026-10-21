import { describe, it, expect } from "vitest";
import { toDeviceEvent } from "./deviceCalendar";

describe("toDeviceEvent", () => {
  it("maps a timed event to local date and time", () => {
    const start = new Date(2026, 9, 22, 8, 5).getTime();
    expect(toDeviceEvent({ id: "e1", title: "School run", startDate: start, isAllDay: false, color: "#ff0000", location: "School" }))
      .toEqual({ id: `device_e1_${start}`, title: "School run", date: "2026-10-22", time: "08:05", source: "apple", color: "#ff0000", allDay: false, location: "School" });
  });

  it("gives each occurrence of a repeating event its own id and no time when all-day", () => {
    const a = toDeviceEvent({ id: "r", title: "", startDate: new Date(2026, 9, 22).getTime(), isAllDay: true, color: null, location: null });
    const b = toDeviceEvent({ id: "r", title: "", startDate: new Date(2026, 9, 29).getTime(), isAllDay: true, color: null, location: null });
    expect(a.id).not.toBe(b.id);
    expect(a.time).toBeUndefined();
    expect(a.title).toBe("Event");
  });
});
