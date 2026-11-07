import { addClock } from "@/lib/calendar/model"
import type { CalendarEvent } from "@/lib/workspace/schemas"

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

/** A complete event: by default, a daily routine at 7:00 for 30 minutes. */
export function eventOf(
  fields: Partial<CalendarEvent> & { minutes?: number } = {}
): CalendarEvent {
  const { minutes = 30, ...rest } = fields
  const start = rest.start ?? "07:00"
  return {
    id: "r",
    title: "Walk",
    taskId: null,
    kind: "event",
    date: "2020-01-01",
    start,
    end: addClock(start, minutes),
    flexible: false,
    color: "#bfe58a",
    repeat: { days: ALL_DAYS },
    overrides: {},
    outcomes: {},
    minimum: "",
    link: "",
    notes: "",
    emoji: "",
    label: "",
    window: null,
    seriesId: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    ...rest,
  }
}
