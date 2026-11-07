import { buildCalendarItems } from "@/lib/calendar/events"
import { localToday } from "@/lib/workspace/dates"
import type { BlockStatus } from "@/lib/calendar/model"
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
  return buildCalendarItems(state, today, now).some(
    (item) =>
      item.extendedProps.kind !== "deadline" &&
      item.extendedProps.kind !== "buffer" &&
      onToday(item.start)
  )
}

export type AgendaItem = {
  key: string
  kind: "deadline" | "planned" | "focused" | "routine" | "buffer"
  refId: string
  /** Which occurrence this is, by the date it's stored under. */
  occurrence?: string
  taskId: string | null
  title: string
  start: Date
  end: Date
  /** The look of the block, which says what happened to it. */
  state: BlockStatus | "focused"
  color?: string
  awaitingAnswer?: boolean
  adjusted?: boolean
  window?: string | null
}

/**
 * Everything that belongs on today, from the same facts the Calendar draws.
 * Timed work gets a place in the day; the rest has no hour of its own.
 */
export function todayAgenda(state: Workspace, today: string, now: number) {
  const midnight = new Date(`${today}T00:00:00`)
  const timed: AgendaItem[] = []
  const untimed: AgendaItem[] = []
  const buffers: AgendaItem[] = []

  for (const item of buildCalendarItems(state, today, now)) {
    const { kind, refId, taskId, awaitingAnswer, window } = item.extendedProps
    const { key, color, status, adjusted } = item.extendedProps
    if (kind === "pending") continue
    const start = item.allDay ? midnight : new Date(item.start)
    // Untimed items hold a bare date, which must not be read as a moment.
    if ((item.allDay ? item.start : localToday(start)) !== today) continue
    const entry: AgendaItem = {
      key: item.id,
      kind,
      refId,
      occurrence: key,
      taskId,
      title: item.title,
      start,
      end: item.end ? new Date(item.end) : start,
      state: kind === "focused" ? "focused" : (status ?? "planned"),
      color,
      awaitingAnswer,
      adjusted,
      window,
    }
    if (kind === "buffer") buffers.push(entry)
    else if (item.allDay) untimed.push(entry)
    else timed.push(entry)
  }

  timed.sort((a, b) => a.start.getTime() - b.start.getTime())
  return { timed, untimed, buffers }
}

/** The usual window, stretched so that nothing timed today falls outside it. */
export function agendaHours(items: AgendaItem[], clock: Date) {
  const base = timelineWindow(clock)
  const hourOf = (date: Date) => date.getHours() + date.getMinutes() / 60
  return items.reduce(
    (range, item) => ({
      first: Math.min(range.first, Math.floor(hourOf(item.start))),
      // A block that runs past midnight stops at the bottom of the day.
      last:
        localToday(item.end) !== localToday(item.start)
          ? 24
          : Math.max(range.last, Math.ceil(hourOf(item.end))),
    }),
    base
  )
}

/** Blocks that overlap share the width, side by side, without covering each other. */
export function agendaColumns(items: AgendaItem[]) {
  const placed = new Map<string, { column: number; columns: number }>()
  let cluster: AgendaItem[] = []
  let columnEnds: number[] = []
  let clusterEnd = -Infinity
  const close = () => {
    for (const item of cluster) {
      placed.get(item.key)!.columns = columnEnds.length
    }
    cluster = []
    columnEnds = []
  }
  for (const item of items) {
    const start = item.start.getTime()
    if (start >= clusterEnd) close()
    let column = columnEnds.findIndex((end) => end <= start)
    if (column < 0) column = columnEnds.length
    const end = Math.max(item.end.getTime(), start + 20 * 60_000)
    columnEnds[column] = end
    clusterEnd = cluster.length ? Math.max(clusterEnd, end) : end
    cluster.push(item)
    placed.set(item.key, { column, columns: 1 })
  }
  close()
  return placed
}
