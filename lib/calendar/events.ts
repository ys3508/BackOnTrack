import {
  allOccurrences,
  colorOf,
  eventTitle,
  isPlannedEvent,
  plannedSessions,
  statusOf,
} from "@/lib/calendar/model"
import type { BlockStatus } from "@/lib/calendar/model"
import { addDays, localToday } from "@/lib/workspace/dates"
import { isActive, isFocusTime } from "@/lib/workspace/schemas"
import type { PlannedSession, Workspace } from "@/lib/workspace/schemas"

export type CalendarItemKind =
  | "deadline"
  | "planned"
  | "focused"
  | "routine"
  | "pending"
  | "buffer"

export type CalendarItem = {
  id: string
  title: string
  start: string
  end?: string
  allDay: boolean
  editable: boolean
  durationEditable: boolean
  classNames: string[]
  extendedProps: {
    kind: CalendarItemKind
    taskId: string | null
    /** The event, deadline's task, or focus session behind this block. */
    refId: string
    /** Which occurrence this is, by the date it's stored under. */
    key?: string
    color?: string
    status?: BlockStatus
    adjusted?: boolean
    /** Planned work whose time has gone by, still waiting for an answer. */
    awaitingAnswer?: boolean
    timed?: boolean
    window?: string | null
    reported?: boolean
  }
}

function endOfBlock(date: string, start: string, minutes: number) {
  const [hours, mins] = start.split(":").map(Number)
  const total = hours * 60 + mins + minutes
  const dayOffset = Math.floor(total / 1440)
  const clock = `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
  return `${addDays(date, dayOffset)}T${clock}`
}

/** Time that went by without this happening. It's shown faintly, never in red. */
function isMissed(session: PlannedSession, today: string, now: number) {
  if (session.done) return false
  if (!session.time) return session.date < today
  return (
    new Date(endOfBlock(session.date, session.time, session.minutes)).getTime() <
    now
  )
}

/**
 * Everything drawn on the calendar. Repeating events are only expanded across
 * the dates asked for, since they have no end.
 */
export function buildCalendarItems(
  state: Workspace,
  today: string,
  now = Date.now(),
  range: { from: string; until: string } = {
    from: today,
    until: addDays(today, 1),
  }
): CalendarItem[] {
  const deadlines = state.tasks.flatMap((task): CalendarItem[] =>
    task.deadline
      ? [
          {
            id: `deadline:${task.id}`,
            title: `Due: ${task.title}`,
            start: task.deadline,
            allDay: true,
            editable: isActive(task),
            durationEditable: false,
            classNames: [
              "bot-deadline",
              ...(!isActive(task)
                ? ["bot-deadline-done"]
                : task.deadline < today
                  ? ["bot-deadline-passed"]
                  : []),
            ],
            extendedProps: {
              kind: "deadline",
              taskId: task.id,
              refId: task.id,
            },
          },
        ]
      : []
  )

  const planned = plannedSessions(state).flatMap((session): CalendarItem[] => {
    const event = state.events.find((item) => item.id === session.id)!
    const task = state.tasks.find((item) => item.id === session.taskId)
    if (!task) return []
    // It became focus time, which is drawn instead.
    if (session.outcome === "did") return []
    const missed = isMissed(session, today, now)
    const status: BlockStatus = session.done
      ? "done"
      : session.outcome === "didnt"
        ? "skipped"
        : missed
          ? "missed"
          : "planned"
    return [
      {
        id: `planned:${session.id}`,
        title: session.label ? `${task.title}: ${session.label}` : task.title,
        start: session.time ? `${session.date}T${session.time}` : session.date,
        end: session.time
          ? endOfBlock(session.date, session.time, session.minutes)
          : undefined,
        allDay: !session.time,
        editable: !session.done,
        // An untimed session has no length to drag on the calendar.
        durationEditable: !session.done && Boolean(session.time),
        classNames: [`bot-${status}`],
        extendedProps: {
          kind: "planned",
          taskId: session.taskId,
          refId: session.id,
          key: session.date,
          color: colorOf(event, state.tasks),
          status,
          timed: Boolean(session.time),
          window: session.window,
          awaitingAnswer:
            Boolean(session.time) && !session.outcome && missed,
        },
      },
    ]
  })

  const occurrences = allOccurrences(state, range.from, range.until)
    .filter((item) => !isPlannedEvent(item.event))
    .map((item): CalendarItem => {
      const flexible = item.event.flexible
      const status = statusOf(item, now)
      const buffer = item.event.kind === "buffer"
      return {
        id: `${buffer ? "buffer" : "routine"}:${item.event.id}:${item.key}`,
        title: eventTitle(item, state.tasks),
        start: flexible ? item.date : `${item.date}T${item.start}`,
        end: flexible
          ? undefined
          : endOfBlock(item.date, item.start, item.minutes),
        allDay: flexible,
        editable: true,
        durationEditable: !flexible,
        classNames: [buffer ? "bot-buffer-block" : `bot-${status}`],
        extendedProps: {
          kind: buffer ? "buffer" : "routine",
          taskId: item.event.taskId,
          refId: item.event.id,
          key: item.key,
          color: colorOf(
            { color: item.color, taskId: item.event.taskId },
            state.tasks
          ),
          status,
          adjusted: item.adjusted,
          timed: !flexible,
        },
      }
    })

  const focused = state.focusSessions
    .filter(isFocusTime)
    .map((session): CalendarItem => {
      const event = state.events.find((item) => item.id === session.plannedId)
      return {
        id: `focused:${session.id}`,
        title: session.taskTitle,
        start: session.startedAt,
        end: session.endedAt,
        allDay: false,
        editable: false,
        durationEditable: false,
        classNames: ["bot-focused"],
        extendedProps: {
          kind: "focused",
          taskId: session.taskId,
          refId: session.id,
          color: colorOf(
            { color: event?.color ?? null, taskId: session.taskId },
            state.tasks
          ),
          reported: session.reported,
        },
      }
    })

  return [...deadlines, ...planned, ...occurrences, ...focused]
}

/** Reads a dropped calendar event as a local date and an optional local time. */
export function droppedSlot(start: Date, allDay: boolean) {
  const time = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`
  return { date: localToday(start), time: allDay ? null : time }
}

export function itemsOnDay(
  items: CalendarItem[],
  date: string,
  toLocalDate: (iso: string) => string = (iso) =>
    iso.length === 10 ? iso : localToday(new Date(iso))
) {
  return items.filter((item) => toLocalDate(item.start) === date)
}
