import { plannedSession } from "@/lib/calendar/model"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import {
  isFocusTime,
  isInterrupted,
  type FrictionEvent,
  type HelpKind,
  type Task,
  type TaskKind,
  type Workspace,
} from "@/lib/workspace/schemas"

const MAX_EVENTS = 300
/** Enough of their own words that it counts as real progress after some help. */
const OWN_WORDS_FOR_PROGRESS = 5

function words(text: string) {
  const clean = text.trim()
  return clean ? clean.split(/\s+/).length : 0
}

function stripTags(html: string) {
  return html.replace(/<\/(p|li|h\d|div)>/g, " ").replace(/<[^>]+>/g, " ")
}

/** Words the user wrote, leaving out accepted suggestions and code blocks. */
export function ownWords(html: string) {
  return words(
    stripTags(
      html
        .replace(/<pre[\s\S]*?<\/pre>/g, " ")
        .replace(/<span[^>]*data-suggested[^>]*>[\s\S]*?<\/span>/g, " ")
    )
  )
}

export function taskKindOf(task: Task): TaskKind {
  const text = `${task.title} ${task.subtasks.find((sub) => !sub.done)?.title ?? ""}`
  if (/classifier|dataset|\bcode\b|python|script|program|debug/i.test(text)) {
    return "code"
  }
  if (
    /\b(writ\w*|essay|paper|report|draft|thesis|article|outline|introduction|cover letter)\b/i.test(
      text
    )
  ) {
    return "writing"
  }
  return "other"
}

function event(
  state: Workspace,
  task: Task,
  at: string,
  fields: Pick<FrictionEvent, "kind"> & Partial<FrictionEvent>
): FrictionEvent {
  const content = task.workDoc?.content ?? ""
  return {
    id: `${at}-${fields.kind}-${state.frictionLog.length}`,
    at,
    taskId: task.id,
    taskKind: taskKindOf(task),
    blankDoc: words(stripTags(content)) === 0,
    interrupted: false,
    helpKind: null,
    baselineWords: 0,
    outcome: null,
    ...fields,
  }
}

function add(state: Workspace, item: FrictionEvent): Workspace {
  return {
    ...state,
    frictionLog: [...state.frictionLog, item].slice(-MAX_EVENTS),
  }
}

/** The first thing to happen after some help is recorded as its outcome. */
function resolveHelp(
  state: Workspace,
  taskId: string,
  outcome: "progress" | "stuck",
  applies: (item: FrictionEvent) => boolean = () => true
): Workspace {
  let changed = false
  const frictionLog = state.frictionLog.map((item) => {
    if (
      item.kind !== "help" ||
      item.taskId !== taskId ||
      item.outcome ||
      !applies(item)
    ) {
      return item
    }
    changed = true
    return { ...item, outcome }
  })
  return changed ? { ...state, frictionLog } : state
}

function observeSession(before: Workspace, after: Workspace): Workspace {
  if (after.focusSessions.length <= before.focusSessions.length) return after
  const session = after.focusSessions.at(-1)!
  const task = before.tasks.find((item) => item.id === session.taskId)
  if (!task) return after
  const logged = add(
    after,
    event(after, task, session.endedAt, {
      kind: "session",
      interrupted: isInterrupted(session),
    })
  )
  if (session.outcome === "stuck") return resolveHelp(logged, task.id, "stuck")
  return isFocusTime(session)
    ? resolveHelp(logged, task.id, "progress")
    : logged
}

/**
 * Records moments that show whether work is moving, and whether help helped.
 * It runs after the reducer, only stores what the user did in this app, and can
 * be turned off or deleted in Settings.
 */
export function observeFriction(
  before: Workspace,
  after: Workspace,
  action: WorkspaceAction
): Workspace {
  if (action.type === "delete-task") {
    return {
      ...after,
      frictionLog: after.frictionLog.filter(
        (item) => item.taskId !== action.id
      ),
    }
  }
  if (!after.learning.enabled) return after

  const next = observeSession(before, after)

  switch (action.type) {
    case "report-stuck": {
      const task = before.tasks.find((item) => item.id === action.id)
      if (!task) return next
      return resolveHelp(
        add(next, event(next, task, action.at, { kind: "stuck" })),
        task.id,
        "stuck"
      )
    }
    case "decline-recovery":
      return resolveHelp(next, action.id, "stuck")
    case "move-planned": {
      const session = plannedSession(before, action.id)
      const task = before.tasks.find((item) => item.id === session?.taskId)
      if (!session || !task || action.date <= session.date) return next
      return add(next, event(next, task, action.at, { kind: "moved" }))
    }
    case "log-help": {
      const task = before.tasks.find((item) => item.id === action.id)
      if (!task) return next
      return add(
        next,
        event(next, task, action.at, {
          kind: "help",
          helpKind: action.helpKind,
          baselineWords: ownWords(task.workDoc?.content ?? ""),
        })
      )
    }
    case "toggle-subtask": {
      const was = before.tasks
        .find((item) => item.id === action.id)
        ?.subtasks.find((sub) => sub.id === action.subId)
      return was && !was.done ? resolveHelp(next, action.id, "progress") : next
    }
    case "complete-next-action":
      return resolveHelp(next, action.id, "progress")
    case "save-work-doc": {
      const count = ownWords(action.content)
      return resolveHelp(
        next,
        action.id,
        "progress",
        (item) => count >= item.baselineWords + OWN_WORDS_FOR_PROGRESS
      )
    }
    default:
      return next
  }
}

export function lastProgressAt(task: Task) {
  return task.subtasks.reduce(
    (latest, sub) =>
      sub.done && sub.completedAt && sub.completedAt > latest
        ? sub.completedAt
        : latest,
    ""
  )
}

export type { HelpKind }
