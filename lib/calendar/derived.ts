import { addDays, daysBetween, localToday } from "@/lib/workspace/dates"
import { isActive, isFocusTime } from "@/lib/workspace/schemas"
import type { Routine, Task, Workspace } from "@/lib/workspace/schemas"

/* ---------- Sessions ---------- */

/**
 * One shape for planned and actual time, derived from what's already stored, so
 * the calendar and its numbers can't disagree.
 */
export type CalendarSession = {
  id: string
  taskId: string | null
  title: string
  kind: "planned" | "actual"
  date: string
  start: Date
  end: Date
  minutes: number
  /** False for planned work with a day but no time. */
  timed: boolean
}

export function sessionsFrom(state: Workspace): CalendarSession[] {
  const titleOf = (id: string) =>
    state.tasks.find((task) => task.id === id)?.title
  const planned = state.planned.flatMap((item): CalendarSession[] => {
    const title = titleOf(item.taskId)
    if (!title) return []
    const start = new Date(`${item.date}T${item.time ?? "00:00"}:00`)
    return [
      {
        id: item.id,
        taskId: item.taskId,
        title,
        kind: "planned",
        date: item.date,
        start,
        end: new Date(start.getTime() + item.minutes * 60_000),
        minutes: item.minutes,
        timed: Boolean(item.time),
      },
    ]
  })
  // An interrupted attempt isn't focus time anywhere else, so it isn't here.
  const actual = state.focusSessions
    .filter(isFocusTime)
    .map((item): CalendarSession => ({
      id: item.id,
      taskId: item.taskId,
      title: item.taskId ? item.taskTitle : "No specific task",
      kind: "actual",
      date: localToday(new Date(item.startedAt)),
      start: new Date(item.startedAt),
      end: new Date(item.endedAt),
      minutes: item.actualSeconds / 60,
      timed: true,
    }))
  return [...planned, ...actual]
}

export type RangeStats = {
  focusMinutes: number
  plannedMinutes: number
  tasksCompleted: number
  actual: CalendarSession[]
}

/** Numbers for the dates from `from` up to, but not including, `until`. */
export function rangeStats(
  state: Workspace,
  from: string,
  until: string
): RangeStats {
  const within = (date: string) => date >= from && date < until
  const sessions = sessionsFrom(state).filter((item) => within(item.date))
  const actual = sessions
    .filter((item) => item.kind === "actual")
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  const sum = (items: CalendarSession[]) =>
    items.reduce((total, item) => total + item.minutes, 0)
  return {
    focusMinutes: sum(actual),
    plannedMinutes: sum(sessions.filter((item) => item.kind === "planned")),
    // Finishing a task is the one number that isn't recorded on a session.
    tasksCompleted: state.tasks.filter(
      (task) =>
        task.completedAt && within(localToday(new Date(task.completedAt)))
    ).length,
    actual,
  }
}

export function formatDuration(minutes: number) {
  const total = Math.round(minutes)
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

export function formatClockTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

/* ---------- Colors ---------- */

/** All dark enough to carry white text when a routine is filled in. */
export const PALETTE = [
  "#3f6b52",
  "#4a5a94",
  "#a0603a",
  "#7d4f7d",
  "#2f7480",
  "#6f7436",
]

export function taskColor(taskId: string | null) {
  if (!taskId) return "#6b7280"
  let hash = 0
  for (const char of taskId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

/* ---------- Year heatmap ---------- */

export function focusMinutesByDay(state: Workspace) {
  const days = new Map<string, number>()
  for (const item of sessionsFrom(state)) {
    if (item.kind !== "actual") continue
    days.set(item.date, (days.get(item.date) ?? 0) + item.minutes)
  }
  return days
}

export function heatLevel(minutes: number) {
  if (minutes <= 0) return 0
  if (minutes <= 25) return 1
  if (minutes <= 60) return 2
  if (minutes <= 120) return 3
  return 4
}

/* ---------- The "Not started yet" tray ---------- */

export type TrayItem = { task: Task; putOffDays: number }

/**
 * Unfinished tasks whose day has gone by and that have no time set aside now. A
 * task that gets scheduled leaves by itself, and a paused one was set aside on
 * purpose, so it isn't called put off.
 */
export function trayItems(state: Workspace, today: string): TrayItem[] {
  return state.tasks
    .filter((task) => isActive(task) && task.status !== "paused")
    .flatMap((task): TrayItem[] => {
      const planned = state.planned.filter((item) => item.taskId === task.id)
      if (planned.some((item) => !item.done && item.date >= today)) return []
      const past = [
        ...(task.deadline && task.deadline < today ? [task.deadline] : []),
        ...planned
          .filter((item) => !item.done && item.date < today)
          .map((item) => item.date),
      ].sort()
      const latest = past.at(-1)
      return latest ? [{ task, putOffDays: daysBetween(latest, today) }] : []
    })
    .sort((a, b) => a.putOffDays - b.putOffDays)
}

/* ---------- Routines ---------- */

export const WEEKDAYS = [
  { code: "SU", label: "Sun" },
  { code: "MO", label: "Mon" },
  { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" },
  { code: "SA", label: "Sat" },
] as const

/** Local time with no zone, so 7am stays 7am wherever the user is. */
export function buildRoutineRule(days: string[], time: string, start: string) {
  const ordered = WEEKDAYS.map((day) => day.code).filter((code) =>
    days.includes(code)
  )
  return `DTSTART:${start.replaceAll("-", "")}T${time.replace(":", "")}00\nRRULE:FREQ=WEEKLY;BYDAY=${ordered.join(",")}`
}

export function parseRoutineRule(rule: string) {
  const start = rule.match(/DTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/)
  const days = rule.match(/BYDAY=([A-Z,]+)/)?.[1].split(",") ?? []
  return {
    days,
    time: start ? `${start[4]}:${start[5]}` : "07:00",
    startDate: start ? `${start[1]}-${start[2]}-${start[3]}` : "",
  }
}

export function routineTime(routine: Routine) {
  return parseRoutineRule(routine.rrule).time
}

/** The Sunday that starts the calendar's week. */
export function weekStart(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return addDays(date, -new Date(year, month - 1, day).getDay())
}

/** How often it happened this week. Deliberately not a streak. */
export function timesThisWeek(
  state: Workspace,
  routine: Routine,
  today: string
) {
  const from = weekStart(today)
  const until = addDays(from, 7)
  const within = (date: string) => date >= from && date < until
  return (
    routine.doneDates.filter(within).length +
    state.routinePlacements.filter(
      (item) => item.routineId === routine.id && item.done && within(item.date)
    ).length
  )
}
