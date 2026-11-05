import { addDays, localToday } from "@/lib/workspace/dates"
import { isActive } from "@/lib/workspace/schemas"
import type { PlannedSession, Workspace } from "@/lib/workspace/schemas"

export type CalendarItemKind = "deadline" | "planned" | "focused"

export type CalendarItem = {
  id: string
  title: string
  start: string
  end?: string
  allDay: boolean
  editable: boolean
  durationEditable: false
  classNames: string[]
  extendedProps: {
    kind: CalendarItemKind
    taskId: string | null
    refId: string
  }
}

function plannedEnd(session: PlannedSession) {
  const [hours, minutes] = session.time!.split(":").map(Number)
  const total = hours * 60 + minutes + session.minutes
  const dayOffset = Math.floor(total / 1440)
  const clock = `${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
  return `${addDays(session.date, dayOffset)}T${clock}`
}

/** Deadlines, planned work, and past focus sessions are visibly separate kinds. */
export function buildCalendarItems(
  state: Workspace,
  today: string
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
    return [
      {
        id: `planned:${session.id}`,
        title: `Work: ${title} (${session.minutes} min)`,
        start: session.time ? `${session.date}T${session.time}` : session.date,
        end: session.time ? plannedEnd(session) : undefined,
        allDay: !session.time,
        editable: !session.done,
        durationEditable: false,
        classNames: session.done
          ? ["bot-planned", "bot-planned-done"]
          : ["bot-planned"],
        extendedProps: {
          kind: "planned",
          taskId: session.taskId,
          refId: session.id,
        },
      },
    ]
  })

  const focused = state.focusSessions.map((session): CalendarItem => ({
    id: `focused:${session.id}`,
    title: `Focused: ${session.taskTitle}`,
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
