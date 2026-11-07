import { occurrencesBetween } from "@/lib/calendar/model"
import type { BlockSchedule } from "@/lib/calendar/activity"
import { addDays, localToday } from "@/lib/workspace/dates"
import type { ActivityEntry, CalendarEvent } from "@/lib/workspace/schemas"

/*
 * Every number here is worked out from the activity log, never from a stored
 * total, so a figure can always be traced back to what happened.
 */

export type Range = { from: string; until: string }

const dateOf = (iso: string) => localToday(new Date(iso))
const within = (date: string, range: Range) =>
  date >= range.from && date < range.until

type Get<T extends ActivityEntry["type"]> = Extract<ActivityEntry, { type: T }>

function ofType<T extends ActivityEntry["type"]>(
  log: ActivityEntry[],
  type: T
) {
  return log.filter((entry): entry is Get<T> => entry.type === type)
}

export function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Focus that really happened: not an interrupted attempt, nor one taken back. */
function focusSessions(log: ActivityEntry[]) {
  const undone = new Set(
    ofType(log, "focus_undone").map((entry) => entry.sessionId)
  )
  return ofType(log, "focus_ended").filter(
    (entry) => !entry.interrupted && !undone.has(entry.sessionId)
  )
}

export function focusByDay(log: ActivityEntry[]) {
  const days = new Map<string, number>()
  for (const entry of focusSessions(log)) {
    const date = dateOf(entry.startedAt)
    days.set(date, (days.get(date) ?? 0) + entry.seconds / 60)
  }
  return days
}

function asEvent(id: string, schedule: BlockSchedule): CalendarEvent {
  return {
    ...schedule,
    id,
    title: "",
    taskId: null,
    color: null,
    outcomes: {},
    minimum: "",
    link: "",
    notes: "",
    emoji: "",
    label: "",
    window: null,
    seriesId: null,
    createdAt: "",
  }
}

/**
 * Replays the log to the plan as it now stands. A block removed later still
 * counts for the days before it was removed, because it was the plan then.
 */
export function plannedByDay(log: ActivityEntry[], range: Range) {
  const plan = new Map<
    string,
    { schedule: BlockSchedule; removedOn: string | null }
  >()
  for (const entry of log) {
    if (entry.type === "block_planned") {
      plan.set(entry.eventId, { schedule: entry.schedule, removedOn: null })
    } else if (entry.type === "block_removed") {
      const block = plan.get(entry.eventId)
      if (block) block.removedOn = dateOf(entry.at)
    }
  }
  const days = new Map<string, number>()
  for (const [id, { schedule, removedOn }] of plan) {
    // Buffer time is kept free, so it's never planned work.
    if (schedule.kind === "buffer") continue
    const shown = occurrencesBetween(asEvent(id, schedule), range.from, range.until)
    for (const item of shown) {
      if (removedOn && item.date >= removedOn) continue
      days.set(item.date, (days.get(item.date) ?? 0) + item.minutes)
    }
  }
  return days
}

const total = (days: Map<string, number>, range: Range) => {
  let sum = 0
  for (const [date, minutes] of days) {
    if (within(date, range)) sum += minutes
  }
  return sum
}

export type RoutineCounts = {
  series: string
  title: string
  full: number
  minimum: number
  skipped: number
}

export type Overview = {
  /** Sessions behind the focus figure. */
  focusSessions: number
  focusMinutes: number
  plannedMinutes: number
  doneMinutes: number
  startDelay: { median: number; within10: number; count: number } | null
  firstStart: { median: number; count: number } | null
  comebacks: number
  recovery: { shown: number; acted: number } | null
  routines: RoutineCounts[]
  buffers: { used: number; created: number }
  tasks: { completed: number; reduced: number; released: number }
  stuck: { label: string; count: number }[]
  /** How many starts fell on each weekday (0 is Sunday) and hour. */
  startHours: number[][]
  starts: number
}

function latestOutcomes(log: ActivityEntry[]) {
  const latest = new Map<string, Get<"occurrence_outcome">>()
  for (const entry of ofType(log, "occurrence_outcome")) {
    latest.set(`${entry.eventId}:${entry.key}`, entry)
  }
  return [...latest.values()]
}

function firstStarts(log: ActivityEntry[]) {
  const first = new Map<string, Get<"focus_started">>()
  for (const entry of ofType(log, "focus_started")) {
    if (entry.taskId && !first.has(entry.taskId)) first.set(entry.taskId, entry)
  }
  return first
}

function recoveryRate(log: ActivityEntry[], range: Range) {
  // Each restart answers the latest time recovery was shown for that task.
  const open = new Map<string, Get<"recovery_shown">[]>()
  const acted = new Set<Get<"recovery_shown">>()
  for (const entry of log) {
    if (entry.type === "recovery_shown") {
      open.set(entry.taskId, [...(open.get(entry.taskId) ?? []), entry])
    } else if (entry.type === "restarted") {
      const shown = open.get(entry.taskId)?.pop()
      if (shown) acted.add(shown)
    }
  }
  const shown = ofType(log, "recovery_shown").filter((entry) =>
    within(dateOf(entry.at), range)
  )
  return shown.length
    ? { shown: shown.length, acted: shown.filter((s) => acted.has(s)).length }
    : null
}

function taskCounts(log: ActivityEntry[], range: Range) {
  const inRange = (entry: ActivityEntry) => within(dateOf(entry.at), range)
  // A task finished and then reopened didn't end up finished.
  const final = new Map<string, Get<"task_completed"> | null>()
  for (const entry of log) {
    if (entry.type === "task_completed") final.set(entry.taskId, entry)
    if (entry.type === "task_reopened") final.set(entry.taskId, null)
  }
  return {
    completed: [...final.values()].filter((entry) => entry && inRange(entry))
      .length,
    reduced: new Set(
      ofType(log, "task_reduced")
        .filter(inRange)
        .map((entry) => entry.taskId)
    ).size,
    released: ofType(log, "task_released").filter(inRange).length,
  }
}

export function overviewOf(log: ActivityEntry[], range: Range): Overview {
  const inRange = (entry: ActivityEntry) => within(dateOf(entry.at), range)
  const focus = focusSessions(log).filter((entry) =>
    within(dateOf(entry.startedAt), range)
  )
  const outcomes = latestOutcomes(log).filter(
    (entry) => entry.outcome && within(entry.key, range)
  )

  const focused = new Set(focus.map((entry) => entry.plannedId))
  const doneMinutes =
    focus.reduce(
      (sum, entry) => sum + (entry.plannedId ? entry.seconds / 60 : 0),
      0
    ) +
    outcomes.reduce(
      (sum, entry) =>
        entry.outcome === "full" && !focused.has(entry.eventId)
          ? sum + entry.minutes
          : sum,
      0
    )

  // Only the first start of a block is the delay. Coming back later isn't.
  const seenBlocks = new Set<string>()
  const delays: number[] = []
  for (const entry of ofType(log, "focus_started")) {
    if (!entry.plannedAt || !entry.plannedId) continue
    if (seenBlocks.has(entry.plannedId)) continue
    seenBlocks.add(entry.plannedId)
    if (!inRange(entry)) continue
    const minutes =
      (new Date(entry.at).getTime() - new Date(entry.plannedAt).getTime()) /
      60_000
    delays.push(Math.max(0, Math.round(minutes)))
  }

  const created = new Map(
    ofType(log, "task_created").map((entry) => [entry.taskId, entry.at])
  )
  const waits: number[] = []
  for (const [taskId, start] of firstStarts(log)) {
    const from = created.get(taskId)
    if (!from || !inRange(start)) continue
    waits.push(
      Math.max(
        0,
        (new Date(start.at).getTime() - new Date(from).getTime()) / 60_000
      )
    )
  }

  const routines = new Map<string, RoutineCounts>()
  for (const entry of outcomes) {
    if (!entry.routine) continue
    const row = routines.get(entry.series) ?? {
      series: entry.series,
      title: entry.title,
      full: 0,
      minimum: 0,
      skipped: 0,
    }
    if (entry.outcome === "full") row.full += 1
    if (entry.outcome === "minimum") row.minimum += 1
    if (entry.outcome === "skipped") row.skipped += 1
    routines.set(entry.series, row)
  }

  const stuck = new Map<string, number>()
  for (const entry of ofType(log, "stuck_reason").filter(inRange)) {
    stuck.set(entry.label, (stuck.get(entry.label) ?? 0) + 1)
  }

  const startHours = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  const starts = ofType(log, "focus_started").filter(inRange)
  for (const entry of starts) {
    const date = new Date(entry.at)
    startHours[date.getDay()][date.getHours()] += 1
  }

  const delayCount = delays.length
  return {
    focusSessions: focus.length,
    focusMinutes: focus.reduce((sum, entry) => sum + entry.seconds / 60, 0),
    plannedMinutes: total(plannedByDay(log, range), range),
    doneMinutes,
    startDelay: delayCount
      ? {
          median: median(delays)!,
          within10: delays.filter((value) => value <= 10).length / delayCount,
          count: delayCount,
        }
      : null,
    firstStart: waits.length
      ? { median: median(waits)!, count: waits.length }
      : null,
    comebacks: ofType(log, "restarted").filter(inRange).length,
    recovery: recoveryRate(log, range),
    routines: [...routines.values()],
    buffers: {
      used: new Set(
        ofType(log, "moved_to_buffer")
          .filter((entry) => within(entry.date, range))
          .map((entry) => `${entry.bufferId}:${entry.date}`)
      ).size,
      created: ofType(log, "block_planned").filter(
        (entry) =>
          entry.created && entry.schedule.kind === "buffer" && inRange(entry)
      ).length,
    },
    tasks: taskCounts(log, range),
    stuck: [...stuck.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    startHours,
    starts: starts.length,
  }
}

export type PeriodKind = "day" | "week" | "month" | "year"

/** The stretch just before this one: the same length, in the same units. */
export function previousPeriod(kind: PeriodKind, range: Range): Range {
  if (kind === "day") return { from: addDays(range.from, -1), until: range.from }
  if (kind === "week") return { from: addDays(range.from, -7), until: range.from }
  const [year, month] = range.from.split("-").map(Number)
  const from =
    kind === "year"
      ? `${year - 1}-01-01`
      : month === 1
        ? `${year - 1}-12-01`
        : `${year}-${String(month - 1).padStart(2, "0")}-01`
  return { from, until: range.from }
}

export function trackingSince(log: ActivityEntry[]) {
  const first = log.reduce<string | null>(
    (earliest, entry) =>
      !earliest || entry.at < earliest ? entry.at : earliest,
    null
  )
  return first ? dateOf(first) : null
}
