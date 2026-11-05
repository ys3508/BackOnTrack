import { elapsedMs, finishTime, formatMinutes } from "@/lib/focus/timer"
import { shortDate } from "@/lib/workspace/dates"
import { STATUS_LABEL, PRIORITY_LABEL } from "@/lib/workspace/schemas"
import type {
  FocusSession,
  PlannedSession,
  Priority,
  Settings,
  Task,
  TaskEvent,
  TaskStatus,
  TimerState,
  Workspace,
} from "@/lib/workspace/schemas"

const MAX_HISTORY = 200

export type WorkspaceAction =
  | {
      type: "create-task"
      id: string
      at: string
      title: string
      description?: string
      deadline?: string | null
      priority?: Priority
    }
  | {
      type: "edit-task"
      id: string
      at: string
      patch: Partial<
        Pick<Task, "title" | "description" | "priority" | "nextAction">
      >
    }
  | {
      type: "set-status"
      id: string
      at: string
      status: TaskStatus
      note?: string
    }
  | { type: "set-deadline"; id: string; at: string; deadline: string | null }
  | { type: "set-progress"; id: string; at: string; progress: number }
  | { type: "complete-next-action"; id: string; at: string }
  | { type: "add-existing-task"; task: Task }
  | { type: "delete-task"; id: string }
  | {
      type: "add-subtask"
      id: string
      at: string
      subId: string
      title: string
    }
  | { type: "toggle-subtask"; id: string; at: string; subId: string }
  | { type: "remove-subtask"; id: string; subId: string }
  | {
      type: "save-document"
      id: string
      at: string
      docId: string
      title: string
      body: string
    }
  | { type: "delete-document"; id: string; at: string; docId: string }
  | { type: "log-obstacle"; id: string; at: string; text: string }
  | { type: "add-planned"; at: string; session: PlannedSession }
  | {
      type: "move-planned"
      at: string
      id: string
      date: string
      time: string | null
    }
  | { type: "remove-planned"; at: string; id: string }
  | { type: "toggle-planned"; id: string }
  | {
      type: "timer-start"
      id: string
      kind: TimerState["kind"]
      taskId: string | null
      minutes: number
      now: number
      at: string
    }
  | { type: "timer-pause"; now: number }
  | { type: "timer-resume"; now: number }
  | { type: "timer-reset" }
  | { type: "timer-cancel" }
  | { type: "timer-finish"; now: number }
  | {
      type: "timer-stop"
      now: number
      at: string
      outcome: "continue-later" | "stuck"
      note: string
    }
  | { type: "timer-acknowledge" }
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "skip-recommendation"; taskId: string; date: string }
  | { type: "replace"; state: Workspace }

function eventId(at: string, task: Task) {
  return `${at}-${task.history.length}`
}

export function withEvent(
  task: Task,
  at: string,
  type: TaskEvent["type"],
  text: string
): Task {
  return {
    ...task,
    updatedAt: at,
    history: [...task.history, { id: eventId(at, task), at, type, text }].slice(
      -MAX_HISTORY
    ),
  }
}

export function setTaskStatus(
  task: Task,
  status: TaskStatus,
  at: string,
  note = ""
): Task {
  if (task.status === status) return task
  const updated: Task = {
    ...task,
    status,
    completedAt: status === "completed" ? at : null,
    progress: status === "completed" ? 100 : task.progress,
  }
  const reason = note ? `: ${note}` : ""
  return withEvent(
    updated,
    at,
    "status",
    `Status changed to ${STATUS_LABEL[status]}${reason}`
  )
}

function mapTask(
  state: Workspace,
  id: string,
  update: (task: Task) => Task
): Workspace {
  return {
    ...state,
    tasks: state.tasks.map((task) => (task.id === id ? update(task) : task)),
  }
}

export function workspaceReducer(
  state: Workspace,
  action: WorkspaceAction
): Workspace {
  switch (action.type) {
    case "create-task": {
      const deadline = action.deadline ?? null
      const task: Task = withEvent(
        {
          id: action.id,
          title: action.title.trim(),
          description: action.description?.trim() ?? "",
          status: "not-started",
          priority: action.priority ?? "medium",
          deadline,
          originalDeadline: deadline,
          progress: 0,
          nextAction: "",
          subtasks: [],
          documents: [],
          history: [],
          createdAt: action.at,
          updatedAt: action.at,
          completedAt: null,
        },
        action.at,
        "created",
        "Task created"
      )
      return { ...state, tasks: [...state.tasks, task] }
    }

    case "edit-task":
      return mapTask(state, action.id, (task) => {
        const { patch, at } = action
        let updated = { ...task, ...patch }
        if (patch.title !== undefined && patch.title !== task.title) {
          updated = withEvent(
            updated,
            at,
            "edited",
            `Renamed to "${patch.title}"`
          )
        }
        if (
          patch.description !== undefined &&
          patch.description !== task.description
        ) {
          updated = withEvent(updated, at, "edited", "Description edited")
        }
        if (patch.priority && patch.priority !== task.priority) {
          updated = withEvent(
            updated,
            at,
            "edited",
            `Priority set to ${PRIORITY_LABEL[patch.priority]}`
          )
        }
        if (
          patch.nextAction !== undefined &&
          patch.nextAction !== task.nextAction &&
          patch.nextAction
        ) {
          updated = withEvent(
            updated,
            at,
            "action",
            `Next action set: ${patch.nextAction}`
          )
        }
        return updated
      })

    case "set-status":
      return mapTask(state, action.id, (task) =>
        setTaskStatus(task, action.status, action.at, action.note)
      )

    case "set-deadline":
      return mapTask(state, action.id, (task) => {
        if (task.deadline === action.deadline) return task
        const text = !action.deadline
          ? `Deadline removed (was ${task.deadline && shortDate(task.deadline)})`
          : task.deadline
            ? `Deadline changed from ${shortDate(task.deadline)} to ${shortDate(action.deadline)}`
            : `Deadline set to ${shortDate(action.deadline)}`
        return withEvent(
          {
            ...task,
            deadline: action.deadline,
            originalDeadline: task.originalDeadline ?? action.deadline,
          },
          action.at,
          "deadline",
          text
        )
      })

    case "set-progress":
      return mapTask(state, action.id, (task) => {
        const progress = Math.min(100, Math.max(0, Math.round(action.progress)))
        if (progress === task.progress) return task
        return withEvent(
          { ...task, progress },
          action.at,
          "progress",
          `Progress set to ${progress}%`
        )
      })

    case "complete-next-action":
      return mapTask(state, action.id, (task) => {
        if (task.nextAction) {
          return withEvent(
            { ...task, nextAction: "" },
            action.at,
            "action",
            `Completed: ${task.nextAction}`
          )
        }
        const next = task.subtasks.find((sub) => !sub.done)
        return next
          ? toggleSubtask(task, next.id, action.at)
          : withEvent(task, action.at, "action", "Worked on this task")
      })

    case "add-existing-task":
      return { ...state, tasks: [...state.tasks, action.task] }

    case "delete-task":
      return {
        ...state,
        tasks: state.tasks.filter((task) => task.id !== action.id),
        planned: state.planned.filter((item) => item.taskId !== action.id),
      }

    case "add-subtask":
      return mapTask(state, action.id, (task) =>
        withEvent(
          {
            ...task,
            subtasks: [
              ...task.subtasks,
              { id: action.subId, title: action.title.trim(), done: false },
            ],
          },
          action.at,
          "subtask",
          `Added step: ${action.title.trim()}`
        )
      )

    case "toggle-subtask":
      return mapTask(state, action.id, (task) =>
        toggleSubtask(task, action.subId, action.at)
      )

    case "remove-subtask":
      return mapTask(state, action.id, (task) => ({
        ...task,
        subtasks: task.subtasks.filter((sub) => sub.id !== action.subId),
      }))

    case "save-document":
      return mapTask(state, action.id, (task) => {
        const existing = task.documents.find((doc) => doc.id === action.docId)
        if (existing) {
          return {
            ...task,
            updatedAt: action.at,
            documents: task.documents.map((doc) =>
              doc.id === action.docId
                ? {
                    ...doc,
                    title: action.title,
                    body: action.body,
                    updatedAt: action.at,
                  }
                : doc
            ),
          }
        }
        return withEvent(
          {
            ...task,
            documents: [
              ...task.documents,
              {
                id: action.docId,
                title: action.title,
                body: action.body,
                source: "user",
                updatedAt: action.at,
              },
            ],
          },
          action.at,
          "document",
          `Added document: ${action.title}`
        )
      })

    case "delete-document":
      return mapTask(state, action.id, (task) => ({
        ...task,
        updatedAt: action.at,
        documents: task.documents.filter((doc) => doc.id !== action.docId),
      }))

    case "log-obstacle":
      return mapTask(state, action.id, (task) =>
        withEvent(task, action.at, "obstacle", action.text)
      )

    case "add-planned":
      return {
        ...mapTask(state, action.session.taskId, (task) =>
          withEvent(
            task,
            action.at,
            "schedule",
            `Work session planned for ${shortDate(action.session.date)} (${action.session.minutes} min)`
          )
        ),
        planned: [...state.planned, action.session],
      }

    case "move-planned": {
      const session = state.planned.find((item) => item.id === action.id)
      if (!session) return state
      return {
        ...mapTask(state, session.taskId, (task) =>
          withEvent(
            task,
            action.at,
            "schedule",
            `Work session moved from ${shortDate(session.date)} to ${shortDate(action.date)}`
          )
        ),
        planned: state.planned.map((item) =>
          item.id === action.id
            ? { ...item, date: action.date, time: action.time }
            : item
        ),
      }
    }

    case "remove-planned": {
      const session = state.planned.find((item) => item.id === action.id)
      if (!session) return state
      return {
        ...mapTask(state, session.taskId, (task) =>
          withEvent(
            task,
            action.at,
            "schedule",
            `Removed work session on ${shortDate(session.date)}`
          )
        ),
        planned: state.planned.filter((item) => item.id !== action.id),
      }
    }

    case "toggle-planned":
      return {
        ...state,
        planned: state.planned.map((item) =>
          item.id === action.id ? { ...item, done: !item.done } : item
        ),
      }

    case "timer-start": {
      if (state.timer) return state
      const timer: TimerState = {
        id: action.id,
        kind: action.kind,
        taskId: action.taskId,
        plannedSeconds: action.minutes * 60,
        startedAt: action.at,
        runningSince: action.now,
        accumulatedMs: 0,
      }
      const next = { ...state, timer, finishedSessionId: null }
      if (action.kind !== "focus" || !action.taskId) return next
      return mapTask(next, action.taskId, (task) =>
        task.status === "not-started" ||
        task.status === "paused" ||
        task.status === "needs-recovery"
          ? setTaskStatus(task, "in-progress", action.at)
          : task
      )
    }

    case "timer-pause": {
      const { timer } = state
      if (!timer || timer.runningSince === null) return state
      return {
        ...state,
        timer: {
          ...timer,
          accumulatedMs: elapsedMs(timer, action.now),
          runningSince: null,
        },
      }
    }

    case "timer-resume": {
      const { timer } = state
      if (!timer || timer.runningSince !== null) return state
      return { ...state, timer: { ...timer, runningSince: action.now } }
    }

    case "timer-reset": {
      const { timer } = state
      if (!timer) return state
      return {
        ...state,
        timer: { ...timer, accumulatedMs: 0, runningSince: null },
      }
    }

    case "timer-cancel":
      return { ...state, timer: null }

    case "timer-finish": {
      const { timer } = state
      if (!timer) return state
      if (timer.kind === "break") return { ...state, timer: null }
      const endedAt = new Date(finishTime(timer, action.now)).toISOString()
      return recordSession(state, timer, {
        actualSeconds: timer.plannedSeconds,
        endedAt,
        outcome: "completed",
        note: "",
      })
    }

    case "timer-stop": {
      const { timer } = state
      if (!timer) return state
      const actualSeconds = Math.floor(elapsedMs(timer, action.now) / 1000)
      let next = recordSession(state, timer, {
        actualSeconds,
        endedAt: action.at,
        outcome: action.outcome,
        note: action.note,
      })
      next = { ...next, finishedSessionId: null }
      if (action.outcome === "stuck" && timer.taskId) {
        next = mapTask(next, timer.taskId, (task) =>
          setTaskStatus(task, "needs-recovery", action.at)
        )
      }
      return next
    }

    case "timer-acknowledge":
      return { ...state, finishedSessionId: null }

    case "settings":
      return { ...state, settings: { ...state.settings, ...action.patch } }

    case "skip-recommendation":
      return {
        ...state,
        skipped: {
          date: action.date,
          taskIds:
            state.skipped.date === action.date
              ? [...state.skipped.taskIds, action.taskId]
              : [action.taskId],
        },
      }

    case "replace":
      return action.state
  }
}

function recordSession(
  state: Workspace,
  timer: TimerState,
  result: Pick<FocusSession, "actualSeconds" | "endedAt" | "outcome" | "note">
): Workspace {
  const task = state.tasks.find((item) => item.id === timer.taskId)
  const session: FocusSession = {
    id: timer.id,
    taskId: timer.taskId,
    taskTitle: task?.title ?? "no specific task",
    plannedMinutes: timer.plannedSeconds / 60,
    startedAt: timer.startedAt,
    ...result,
  }
  const length = formatMinutes(result.actualSeconds)
  const text =
    result.outcome === "completed"
      ? `Focus session completed (${length})`
      : result.outcome === "stuck"
        ? `Stopped focus after ${length}: got stuck`
        : `Stopped focus after ${length}: will continue later`
  const next: Workspace = {
    ...state,
    timer: null,
    focusSessions: [...state.focusSessions, session],
    finishedSessionId: session.id,
  }
  if (!task) return next
  return mapTask(next, task.id, (item) => {
    const logged = withEvent(item, result.endedAt, "focus", text)
    return result.note
      ? withEvent(logged, result.endedAt, "obstacle", result.note)
      : logged
  })
}

function toggleSubtask(task: Task, subId: string, at: string): Task {
  const sub = task.subtasks.find((item) => item.id === subId)
  if (!sub) return task
  const subtasks = task.subtasks.map((item) =>
    item.id === subId ? { ...item, done: !item.done } : item
  )
  const done = subtasks.filter((item) => item.done).length
  return withEvent(
    {
      ...task,
      subtasks,
      progress: Math.round((done / subtasks.length) * 100),
    },
    at,
    "subtask",
    `${sub.done ? "Reopened" : "Completed"}: ${sub.title}`
  )
}
