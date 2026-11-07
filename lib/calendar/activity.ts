import { allOccurrences, minutesBetween, plannedSession, seriesKey } from "@/lib/calendar/model"
import { addDays, localToday } from "@/lib/workspace/dates"
import {
  RECOVERY_REASON_LABEL,
  STUCK_LABEL,
  isInterrupted,
} from "@/lib/workspace/schemas"
import type {
  ActivityEntry,
  CalendarEvent,
  EventOverride,
  EventRepeat,
  FocusSession,
  Task,
  Workspace,
} from "@/lib/workspace/schemas"

/** When a block was meant to happen, as it stood at the time. */
export type BlockSchedule = {
  kind: CalendarEvent["kind"]
  date: string
  start: string
  end: string
  flexible: boolean
  repeat: EventRepeat | null
  overrides: Record<string, EventOverride>
}

const scheduleOf = (event: CalendarEvent): BlockSchedule => ({
  kind: event.kind,
  date: event.date,
  start: event.start,
  end: event.end,
  flexible: event.flexible,
  repeat: event.repeat,
  overrides: event.overrides,
})

const isRoutine = (event: CalendarEvent) =>
  Boolean(event.repeat || event.seriesId)

function outcomeEntry(
  event: CalendarEvent,
  key: string,
  at: string
): ActivityEntry {
  return {
    at,
    type: "occurrence_outcome",
    eventId: event.id,
    key,
    outcome: event.outcomes[key] ?? null,
    series: seriesKey(event),
    title: event.title,
    routine: isRoutine(event),
    minutes: minutesBetween(event.start, event.end),
  }
}

function focusEnded(session: FocusSession): ActivityEntry {
  return {
    at: session.endedAt,
    type: "focus_ended",
    sessionId: session.id,
    taskId: session.taskId,
    plannedId: session.plannedId,
    startedAt: session.startedAt,
    seconds: session.actualSeconds,
    interrupted: isInterrupted(session),
    reported: session.reported,
  }
}

function deadlineEntry(task: Task, at: string): ActivityEntry[] {
  if (!task.deadline) return []
  return [
    {
      at,
      type: localToday(new Date(at)) <= task.deadline
        ? "deadline_met"
        : "deadline_missed",
      taskId: task.id,
      deadline: task.deadline,
    },
  ]
}

function timeOf(action: { type: string }) {
  const { at, now } = action as { at?: unknown; now?: unknown }
  if (typeof at === "string") return at
  if (typeof now === "number") return new Date(now).toISOString()
  return new Date().toISOString()
}

function diffEvents(before: Workspace, after: Workspace, at: string) {
  if (before.events === after.events) return []
  const entries: ActivityEntry[] = []
  const known = new Map(before.events.map((event) => [event.id, event]))
  for (const event of after.events) {
    const old = known.get(event.id)
    const schedule = scheduleOf(event)
    if (!old || JSON.stringify(scheduleOf(old)) !== JSON.stringify(schedule)) {
      entries.push({
        at,
        type: "block_planned",
        eventId: event.id,
        schedule,
        // A later part of a split series isn't a new thing the user made.
        created:
          !old &&
          !before.events.some((item) => seriesKey(item) === seriesKey(event)),
      })
    }
    const keys = new Set([
      ...Object.keys(event.outcomes),
      ...Object.keys(old?.outcomes ?? {}),
    ])
    for (const key of keys) {
      if (event.outcomes[key] !== old?.outcomes[key]) {
        entries.push(outcomeEntry(event, key, at))
      }
    }
  }
  const still = new Set(after.events.map((event) => event.id))
  for (const event of before.events) {
    if (!still.has(event.id)) {
      entries.push({ at, type: "block_removed", eventId: event.id })
    }
  }
  return entries
}

function diffTasks(before: Workspace, after: Workspace, at: string) {
  if (before.tasks === after.tasks) return []
  const entries: ActivityEntry[] = []
  const known = new Map(before.tasks.map((task) => [task.id, task]))
  for (const task of after.tasks) {
    const old = known.get(task.id)
    if (!old) entries.push({ at, type: "task_created", taskId: task.id })
    if (!old || old.status === task.status) continue
    if (task.status === "completed") {
      entries.push({ at, type: "task_completed", taskId: task.id })
      entries.push(...deadlineEntry(task, at))
    } else if (task.status === "released") {
      entries.push({ at, type: "task_released", taskId: task.id })
    } else if (old.status === "completed" || old.status === "released") {
      entries.push({ at, type: "task_reopened", taskId: task.id })
    }
  }
  return entries
}

function diffFocus(before: Workspace, after: Workspace) {
  if (before.focusSessions === after.focusSessions) return []
  const entries: ActivityEntry[] = []
  const known = new Set(before.focusSessions.map((item) => item.id))
  for (const session of after.focusSessions) {
    if (!known.has(session.id)) entries.push(focusEnded(session))
  }
  return entries
}

function diffProgress(before: Workspace, after: Workspace) {
  if (before.progressEvents === after.progressEvents) return []
  const known = new Set(before.progressEvents.map((item) => item.id))
  return after.progressEvents.flatMap((item): ActivityEntry[] => {
    if (known.has(item.id)) return []
    const { at, taskId, sessionId } = item
    if (item.type === "started") {
      return [{ at, type: "task_first_started", taskId }]
    }
    if (item.type === "restarted") return [{ at, type: "restarted", taskId }]
    if (item.type === "minimum_met") {
      return [{ at, type: "minimum_met", taskId }]
    }
    if (item.type === "recovery_shown") {
      return [{ at, type: "recovery_shown", taskId, plannedId: sessionId }]
    }
    return []
  })
}

function fromAction(
  before: Workspace,
  after: Workspace,
  action: { type: string } & Record<string, unknown>,
  at: string
): ActivityEntry[] {
  switch (action.type) {
    case "timer-start": {
      const id = action.id as string
      if (action.kind !== "focus" || after.timer?.id !== id) return []
      const taskId = (action.taskId as string | null) ?? null
      const plannedId = (action.plannedId as string | null) ?? null
      const block = plannedSession(before, plannedId)
      return [
        {
          at,
          type: "focus_started",
          sessionId: id,
          taskId,
          plannedId,
          plannedAt:
            block?.time && block.date
              ? new Date(`${block.date}T${block.time}:00`).toISOString()
              : null,
        },
      ]
    }
    case "timer-pause":
    case "timer-resume":
      return before.timer && after.timer !== before.timer
        ? [
            {
              at,
              type:
                action.type === "timer-pause"
                  ? "focus_paused"
                  : "focus_resumed",
              sessionId: before.timer.id,
            },
          ]
        : []
    case "undo-reported-session":
      return before.focusSessions.length !== after.focusSessions.length
        ? [{ at, type: "focus_undone", sessionId: action.sessionId as string }]
        : []
    case "recovery-reason": {
      const reason = action.reason as keyof typeof RECOVERY_REASON_LABEL | null
      return reason && before.recovery
        ? [
            {
              at,
              type: "stuck_reason",
              taskId: before.recovery.taskId,
              label: RECOVERY_REASON_LABEL[reason],
            },
          ]
        : []
    }
    case "case-feedback": {
      const feedback = action.feedback as {
        kind: string
        reason?: keyof typeof STUCK_LABEL | null
      }
      return feedback.kind === "stuck" && feedback.reason
        ? [
            {
              at,
              type: "stuck_reason",
              taskId: action.id as string,
              label: STUCK_LABEL[feedback.reason],
            },
          ]
        : []
    }
    case "recovery-action":
      return [
        {
          at,
          type: "recovery_option",
          taskId: action.taskId as string,
          option: "moved",
        },
      ]
    case "release-task":
      return [
        {
          at,
          type: "recovery_option",
          taskId: action.id as string,
          option: action.mode as string,
        },
      ]
    case "case-set-path": {
      const path = action.path as string | null
      const taskId = action.id as string
      if (!path) return []
      const option: ActivityEntry = {
        at,
        type: "recovery_option",
        taskId,
        option: path,
      }
      return path === "reduce"
        ? [option, { at, type: "task_reduced", taskId }]
        : [option]
    }
    case "move-planned": {
      const session = plannedSession(after, action.id as string)
      if (!session?.time) return []
      const buffer = allOccurrences(
        after,
        session.date,
        addDays(session.date, 1)
      ).find(
        (item) =>
          item.event.kind === "buffer" &&
          item.date === session.date &&
          item.start <= session.time! &&
          session.time! < item.end
      )
      return buffer
        ? [
            {
              at,
              type: "moved_to_buffer",
              eventId: session.id,
              taskId: session.taskId,
              bufferId: buffer.event.id,
              date: session.date,
            },
          ]
        : []
    }
    case "mark-opened": {
      const today = localToday(new Date(at))
      return after.tasks.flatMap((task): ActivityEntry[] => {
        const passed =
          task.deadline &&
          task.deadline < today &&
          task.status !== "completed" &&
          task.status !== "released"
        const logged = after.activity.some(
          (entry) =>
            entry.type === "deadline_missed" &&
            entry.taskId === task.id &&
            entry.deadline === task.deadline
        )
        return passed && !logged ? deadlineEntry(task, at) : []
      })
    }
    default:
      return []
  }
}

/** Written from what really changed, so no screen can log a moment twice. */
export function observeActivity(
  before: Workspace,
  after: Workspace,
  action: { type: string }
): Workspace {
  if (action.type === "replace" || after === before) return after
  const at = timeOf(action)
  const added = [
    ...fromAction(
      before,
      after,
      action as { type: string } & Record<string, unknown>,
      at
    ),
    ...diffEvents(before, after, at),
    ...diffTasks(before, after, at),
    ...diffFocus(before, after),
    ...diffProgress(before, after),
  ]
  return added.length
    ? { ...after, activity: [...after.activity, ...added] }
    : after
}

/**
 * The first time the log exists, it starts from what's already on record with a
 * real time. Nothing is estimated, so older blocks simply have no start delay.
 */
export function seedActivity(
  state: Pick<Workspace, "events" | "tasks" | "focusSessions">,
  now = new Date().toISOString()
): ActivityEntry[] {
  const entries: ActivityEntry[] = []
  for (const task of state.tasks) {
    entries.push({ at: task.createdAt, type: "task_created", taskId: task.id })
    if (task.status === "completed" && task.completedAt) {
      entries.push({
        at: task.completedAt,
        type: "task_completed",
        taskId: task.id,
      })
    }
  }
  for (const session of state.focusSessions) {
    entries.push({
      at: session.startedAt,
      type: "focus_started",
      sessionId: session.id,
      taskId: session.taskId,
      plannedId: session.plannedId,
      plannedAt: null,
    })
    entries.push(focusEnded(session))
  }
  for (const event of state.events) {
    entries.push({
      at: event.createdAt || now,
      type: "block_planned",
      eventId: event.id,
      schedule: scheduleOf(event),
      created: true,
    })
    for (const key of Object.keys(event.outcomes)) {
      entries.push(outcomeEntry(event, key, `${key}T12:00:00.000Z`))
    }
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at))
}
