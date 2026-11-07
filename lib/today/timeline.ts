import {
  blockOutcome,
  occurrenceOutcome,
  routineOccursOn,
  routineTime,
} from "@/lib/calendar/derived"
import { buildCalendarItems } from "@/lib/calendar/events"
import { localToday } from "@/lib/workspace/dates"
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

export type AgendaItem = {
  key: string
  kind: "deadline" | "planned" | "focused" | "routine" | "routine-placement"
  refId: string
  taskId: string | null
  title: string
  start: Date
  end: Date
  /** The look of the block, which says what happened to it. */
  state:
    | "planned"
    | "focused"
    | "missed"
    | "done"
    | "routine"
    | "routine-full"
    | "routine-minimum"
    | "skipped"
  color?: string
  awaitingAnswer?: boolean
  adjusted?: boolean
  window?: string | null
}

function routineState(
  outcome: ReturnType<typeof blockOutcome>,
  end: Date,
  timed: boolean,
  now: number
): AgendaItem["state"] {
  if (outcome === "full") return "routine-full"
  if (outcome === "minimum") return "routine-minimum"
  if (outcome === "skipped") return "skipped"
  return timed && end.getTime() < now ? "missed" : "routine"
}

/**
 * Everything that belongs on today, from the same facts the Calendar draws.
 * Timed work gets a place in the day; the rest has no hour of its own.
 */
export function todayAgenda(state: Workspace, today: string, now: number) {
  const midnight = new Date(`${today}T00:00:00`)
  const timed: AgendaItem[] = []
  const untimed: AgendaItem[] = []

  for (const item of buildCalendarItems(state, today, now)) {
    const { kind, refId, taskId, awaitingAnswer, window } = item.extendedProps
    if (kind !== "deadline" && kind !== "planned" && kind !== "focused") {
      continue
    }
    const start = item.allDay ? midnight : new Date(item.start)
    // Untimed items hold a bare date, which must not be read as a moment.
    if ((item.allDay ? item.start : localToday(start)) !== today) continue
    const entry: AgendaItem = {
      key: item.id,
      kind,
      refId,
      taskId,
      title: item.title,
      start,
      end: item.end ? new Date(item.end) : start,
      state:
        kind === "focused"
          ? "focused"
          : item.classNames.includes("bot-planned-done")
            ? "done"
            : item.classNames.includes("bot-missed")
              ? "missed"
              : "planned",
      awaitingAnswer,
      window,
    }
    if (item.allDay) untimed.push(entry)
    else timed.push(entry)
  }

  for (const routine of state.routines) {
    if (!routineOccursOn(routine, today)) continue
    const flexible = routine.kind === "flexible"
    const start = flexible
      ? midnight
      : new Date(`${today}T${routineTime(routine)}:00`)
    const end = new Date(start.getTime() + routine.duration * 60_000)
    const entry: AgendaItem = {
      key: `routine:${routine.id}`,
      kind: "routine",
      refId: routine.id,
      taskId: null,
      title: `${routine.emoji} ${routine.name}`.trim(),
      start,
      end: flexible ? start : end,
      color: routine.color,
      state: routineState(
        occurrenceOutcome(routine, today),
        end,
        !flexible,
        now
      ),
    }
    if (flexible) untimed.push(entry)
    else timed.push(entry)
  }

  for (const placement of state.routinePlacements) {
    const routine = state.routines.find((r) => r.id === placement.routineId)
    if (!routine || placement.date !== today) continue
    const start = placement.time
      ? new Date(`${today}T${placement.time}:00`)
      : midnight
    const end = new Date(
      start.getTime() + (placement.minutes ?? routine.duration) * 60_000
    )
    const entry: AgendaItem = {
      key: `placement:${placement.id}`,
      kind: "routine-placement",
      refId: placement.id,
      taskId: null,
      title: `${routine.emoji} ${routine.name}`.trim(),
      start,
      end: placement.time ? end : start,
      color: routine.color,
      adjusted: placement.adjusted,
      state: routineState(
        blockOutcome(state, "routine-placement", placement.id, today),
        end,
        Boolean(placement.time),
        now
      ),
    }
    if (placement.time) timed.push(entry)
    else untimed.push(entry)
  }

  timed.sort((a, b) => a.start.getTime() - b.start.getTime())
  return { timed, untimed }
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
