import {
  allOccurrences,
  isPlannedEvent,
  occurrenceAt,
  plannedSessions,
  seriesParts,
} from "@/lib/calendar/model"
import { addDays, daysBetween, localToday } from "@/lib/workspace/dates"
import { isActive, isFocusTime } from "@/lib/workspace/schemas"
import type {
  CalendarEvent,
  EventOutcome,
  Settings,
  Task,
  Workspace,
} from "@/lib/workspace/schemas"

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
  outcome: "did" | "didnt" | null
}

export function sessionsFrom(state: Workspace): CalendarSession[] {
  const titleOf = (id: string) =>
    state.tasks.find((task) => task.id === id)?.title
  const planned = plannedSessions(state).flatMap((item): CalendarSession[] => {
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
        outcome: item.outcome,
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
      outcome: null,
    }))
  return [...planned, ...actual]
}

export function formatDuration(minutes: number) {
  const total = Math.round(minutes)
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** The one time format, used by blocks, popovers, and the dashboard alike. */
export function formatClockTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export function formatTimeRange(start: Date, end: Date) {
  const from = formatClockTime(start)
  const to = formatClockTime(end)
  // "3:15 – 3:40 PM", repeating AM or PM only when it changes.
  return from.slice(-2) === to.slice(-2)
    ? `${from.slice(0, -2).trim()} – ${to}`
    : `${from} – ${to}`
}

/** When something starting at this date and time ends. */
export function endOf(date: string, time: string, minutes: number) {
  return new Date(new Date(`${date}T${time}:00`).getTime() + minutes * 60_000)
}

/** The length to start from, when nothing more specific was chosen. */
export function defaultSessionMinutes(settings: Settings, task?: Task | null) {
  return settings.lastSessionMinutes ?? task?.estimateMinutes ?? 30
}

/* ---------- Hours on screen ---------- */

/**
 * One range for the calendar and the dashboard, so they line up. It's a waking
 * day, stretched for anything outside it so that nothing is ever hidden.
 */
export function hourRange(
  state: Workspace,
  from: string,
  until: string,
  now = new Date()
) {
  const hour = (date: Date) => date.getHours() + date.getMinutes() / 60
  const starts: number[] = [6]
  const ends: number[] = [23]
  const add = (start: Date, end: Date) => {
    starts.push(hour(start))
    // A session that crosses midnight runs to the end of the day.
    ends.push(localToday(end) === localToday(start) ? hour(end) : 24)
  }
  for (const item of sessionsFrom(state)) {
    if (item.timed && item.date >= from && item.date < until) {
      add(item.start, item.end)
    }
  }
  for (const item of allOccurrences(state, from, until)) {
    // A flexible one has no hour to make room for, and a block is counted above.
    if (item.event.flexible || isPlannedEvent(item.event)) continue
    const start = new Date(`${item.date}T${item.start}:00`)
    add(start, new Date(start.getTime() + item.minutes * 60_000))
  }
  const today = localToday(now)
  if (today >= from && today < until) add(now, now)
  return {
    first: Math.floor(Math.min(...starts)),
    last: Math.ceil(Math.max(...ends)),
  }
}

/* ---------- Placing a popover ---------- */

export type Box = { left: number; right: number; top: number; bottom: number }

/**
 * Beside the anchor if there's room, so its title stays readable. In Day view a
 * block spans the whole column, so it goes at that block's right end instead,
 * since titles start from the left.
 */
export function placePopover(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
) {
  const gap = 8
  const fitsRight = anchor.right + gap + size.width <= viewport.width - gap
  const fitsLeft = anchor.left - gap - size.width >= gap
  const left = fitsRight
    ? anchor.right + gap
    : fitsLeft
      ? anchor.left - gap - size.width
      : anchor.right - size.width - gap
  return {
    left: Math.max(gap, Math.min(left, viewport.width - size.width - gap)),
    top: Math.max(
      gap,
      Math.min(anchor.top, viewport.height - size.height - gap)
    ),
  }
}

/* ---------- Heatmaps ---------- */

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
      const planned = plannedSessions(state).filter(
        (item) => item.taskId === task.id
      )
      // "Didn't" sends it here straight away, even if it was planned for today.
      const passed = (item: (typeof planned)[number]) =>
        !item.done && (item.date < today || item.outcome === "didnt")
      if (planned.some((item) => !item.done && !passed(item))) return []
      const past = [
        ...(task.deadline && task.deadline < today ? [task.deadline] : []),
        ...planned.filter(passed).map((item) => item.date),
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

/** The Sunday that starts the calendar's week. */
export function weekStart(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return addDays(date, -new Date(year, month - 1, day).getDay())
}

export type RoutineOutcome = "full" | "minimum" | "skipped" | null

/** What came of an occurrence, in the words routines use. */
export function occurrenceOutcome(
  event: CalendarEvent,
  key: string
): RoutineOutcome {
  const outcome: EventOutcome | undefined = event.outcomes[key]
  if (outcome === "full" || outcome === "did") return "full"
  if (outcome === "minimum") return "minimum"
  if (outcome === "skipped") return "skipped"
  return null
}

/** Full and minimum this week, counted apart. Deliberately not a streak. */
export function routineWeek(
  state: Workspace,
  event: CalendarEvent,
  today: string
) {
  const from = weekStart(today)
  const until = addDays(from, 7)
  const results = seriesParts(state, event).flatMap((part) =>
    Object.keys(part.outcomes).flatMap((key) => {
      const date = occurrenceAt(part, key)?.date ?? key
      return date >= from && date < until
        ? [occurrenceOutcome(part, key)]
        : []
    })
  )
  return {
    full: results.filter((result) => result === "full").length,
    minimum: results.filter((result) => result === "minimum").length,
  }
}

/** Plain words for how an event repeats. */
export function repeatLabel(days: number[]) {
  const sorted = [...days].sort().join()
  if (sorted === "0,1,2,3,4,5,6") return "Every day"
  if (sorted === "1,2,3,4,5") return "Weekdays"
  if (sorted === "0,6") return "Weekends"
  return [...days]
    .sort()
    .map((day) => WEEKDAYS[day].label)
    .join(", ")
}

const EMOJI_RULES: [RegExp, string][] = [
  [/gym|workout|exercise|lift|weights|train/i, "🏋️"],
  [/run|jog/i, "🏃"],
  [/walk|steps|hike/i, "🚶"],
  [/yoga|stretch/i, "🧘"],
  [/medit|breath|calm/i, "🧘"],
  [/read|book/i, "📖"],
  [/write|journal|diary/i, "✍️"],
  [/study|homework|class|learn|practice/i, "📚"],
  [/water|drink/i, "💧"],
  [/sleep|bed|nap/i, "😴"],
  [/clean|tidy|dishes|laundry|chores/i, "🧹"],
  [/cook|meal|breakfast|lunch|dinner|eat/i, "🍳"],
  [/med|pill|vitamin/i, "💊"],
  [/email|inbox|mail/i, "📧"],
  [/plan|review|budget/i, "🗒️"],
  [/call|family|friend/i, "📞"],
]

export const EMOJI_CHOICES = [
  "🏋️",
  "🏃",
  "🚶",
  "🧘",
  "📖",
  "✍️",
  "📚",
  "💧",
  "😴",
  "🧹",
  "🍳",
  "💊",
  "📧",
  "🗒️",
  "📞",
  "⭐",
]

/** A guess from the name. It's only filled in until the user picks their own. */
export function suggestEmoji(name: string) {
  return EMOJI_RULES.find(([rule]) => rule.test(name))?.[1] ?? ""
}
