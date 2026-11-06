import { addDays, localToday } from "@/lib/workspace/dates"
import { isActive, isFocusTime } from "@/lib/workspace/schemas"
import type { PlannedSession, Workspace } from "@/lib/workspace/schemas"

export type CalendarItemKind =
  | "deadline"
  | "planned"
  | "focused"
  | "routine"
  | "routine-placement"
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
    refId: string
    color?: string
    /** Planned work whose time has gone by, still waiting for an answer. */
    awaitingAnswer?: boolean
    timed?: boolean
    window?: string | null
    reported?: boolean
  }
}

function plannedEnd(session: PlannedSession) {
  const [hours, minutes] = session.time!.split(":").map(Number)
  const total = hours * 60 + minutes + session.minutes
  const dayOffset = Math.floor(total / 1440)
  const clock = `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
  return `${addDays(session.date, dayOffset)}T${clock}`
}

/** Time that went by without this happening. It's shown faintly, never in red. */
function isMissed(session: PlannedSession, today: string, now: number) {
  if (session.done) return false
  if (!session.time) return session.date < today
  return new Date(plannedEnd(session)).getTime() < now
}

/** Deadlines, planned work, and past focus sessions are visibly separate kinds. */
export function buildCalendarItems(
  state: Workspace,
  today: string,
  now = Date.now()
): CalendarItem[] {
  const titleOf = (taskId: string | null) =>
    state.tasks.find((task) => task.id === taskId)?.title

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

  const planned = state.planned.flatMap((session): CalendarItem[] => {
    const title = titleOf(session.taskId)
    if (!title) return []
    // It became focus time, which is drawn instead.
    if (session.outcome === "did") return []
    return [
      {
        id: `planned:${session.id}`,
        title: session.label ? `${title}: ${session.label}` : title,
        start: session.time ? `${session.date}T${session.time}` : session.date,
        end: session.time ? plannedEnd(session) : undefined,
        allDay: !session.time,
        editable: !session.done,
        // An untimed session has no length to drag on the calendar.
        durationEditable: !session.done && Boolean(session.time),
        classNames: session.done
          ? ["bot-planned", "bot-planned-done"]
          : isMissed(session, today, now)
            ? ["bot-planned", "bot-missed"]
            : ["bot-planned"],
        extendedProps: {
          kind: "planned",
          taskId: session.taskId,
          refId: session.id,
          timed: Boolean(session.time),
          window: session.window,
          awaitingAnswer:
            Boolean(session.time) &&
            !session.outcome &&
            isMissed(session, today, now),
        },
      },
    ]
  })

  const focused = state.focusSessions
    .filter(isFocusTime)
    .map((session): CalendarItem => ({
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
        reported: session.reported,
      },
    }))

  return [...deadlines, ...planned, ...focused]
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
