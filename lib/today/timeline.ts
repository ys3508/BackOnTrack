import { routineOccursOn } from "@/lib/calendar/derived"
import { buildCalendarItems } from "@/lib/calendar/events"
import type { Workspace } from "@/lib/workspace/schemas"

/** An hour of context, then the next four, kept inside the day. */
export function timelineWindow(now: Date) {
  const last = Math.min(24, Math.max(0, now.getHours() - 1) + 5)
  return { first: last - 5, last }
}

/** Buffers and deadlines aren't plans, so they don't count as scheduled. */
export function hasScheduleToday(state: Workspace, today: string, now: number) {
  const onToday = (start: string) =>
    start.length === 10
      ? start === today
      : new Date(start).toDateString() ===
        new Date(`${today}T12:00:00`).toDateString()
  return (
    buildCalendarItems(state, today, now).some(
      (item) => item.extendedProps.kind !== "deadline" && onToday(item.start)
    ) ||
    state.routines.some((routine) => routineOccursOn(routine, today)) ||
    state.routinePlacements.some((item) => item.date === today)
  )
}

/** Timed work today that falls outside the window, so it isn't lost from view. */
export function blocksOutsideWindow(
  state: Workspace,
  today: string,
  window: { first: number; last: number }
) {
  return state.planned.filter((item) => {
    if (item.date !== today || !item.time || item.done) return false
    const hour = Number(item.time.slice(0, 2))
    return hour < window.first || hour >= window.last
  }).length
}
