import { elapsedMs, finishTime, formatMinutes } from "@/lib/focus/timer"
import { shortDate } from "@/lib/workspace/dates"
import { observeFriction } from "@/lib/workspace/friction"
import type { HelpKind, Learning } from "@/lib/workspace/schemas"
import {
  STATUS_LABEL,
  PRIORITY_LABEL,
  isInterrupted,
} from "@/lib/workspace/schemas"
import { currentSubtask } from "@/lib/workspace/selectors"
import type {
  FocusSession,
  Instructions,
  PendingBreakdown,
  PlannedSession,
  Priority,
  RecoveryAttempt,
  StoredRecovery,
  Settings,
  Subtask,
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
  | { type: "remove-subtask"; id: string; at: string; subId: string }
  | {
      type: "edit-subtask"
      id: string
      at: string
      subId: string
      title: string
    }
  | { type: "move-subtask"; id: string; subId: string; direction: -1 | 1 }
  | {
      type: "split-subtask"
      id: string
      at: string
      subId: string
      steps: { id: string; title: string }[]
    }
  | { type: "set-current-subtask"; id: string; at: string; subId: string }
  | {
      type: "set-breakdown"
      id: string
      at: string
      breakdown: PendingBreakdown
    }
  | {
      type: "accept-breakdown"
      id: string
      at: string
      steps: { id: string; title: string }[]
    }
  | { type: "decline-breakdown"; id: string; at: string }
  | {
      type: "save-document"
      id: string
      at: string
      docId: string
      title: string
      body: string
    }
  | { type: "delete-document"; id: string; at: string; docId: string }
  | {
      type: "save-work-doc"
      id: string
      at: string
      content: string
      cursor: number
    }
  | {
      type: "restore-work-doc"
      id: string
      at: string
      content: string
      previous: string
    }
  | {
      type: "accept-doc-suggestion"
      id: string
      at: string
      label: string
      previous: string
    }
  | { type: "log-doc-suggestion"; id: string; at: string; text: string }
  | {
      type: "set-instructions"
      id: string
      at: string
      instructions: Instructions | null
    }
  | { type: "set-ai-consent"; id: string; at: string }
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
      type: "set-recovery"
      id: string
      recovery: StoredRecovery | null
      obstacle?: string
    }
  | {
      type: "append-to-doc"
      id: string
      at: string
      text: string
      label: string
    }
  | { type: "decline-recovery"; id: string; at: string }
  | {
      type: "apply-recovery"
      id: string
      at: string
      nextAction: string | null
      document: { id: string; title: string; body: string } | null
      steps: { id: string; title: string }[]
      schedule: { id: string; date: string; minutes: number; label: string }[]
      release: boolean
    }
  | {
      type: "timer-start"
      id: string
      kind: TimerState["kind"]
      taskId: string | null
      subtaskId?: string | null
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
  | {
      type: "report-focus"
      sessionId: string
      report: "yes" | "a-little" | "stuck"
      at: string
    }
  | { type: "report-stuck"; id: string; at: string; text: string }
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "mark-opened"; at: string }
  | { type: "log-help"; id: string; at: string; helpKind: HelpKind }
  | { type: "learning"; patch: Partial<Learning> }
  | { type: "delete-friction"; id: string }
  | { type: "clear-friction" }
  | { type: "skip-recommendation"; taskId: string; date: string }
  | { type: "replace"; state: Workspace }

function eventId(at: string, task: Task) {
  return `${at}-${task.history.length}`
}

/** Records what an event really means, so a suggestion never reads as done work. */
export function inferEventKind(
  type: TaskEvent["type"],
  text: string
): TaskEvent["kind"] {
  if (/^(Completed|Status changed to Completed)/.test(text)) return "completed"
  if (/^Reported progress/.test(text)) return "attempted"
  if (/^Accepted/.test(text)) return "accepted"
  if (/^Suggested/.test(text)) return "suggested"
  if (type === "focus" || type === "obstacle" || type === "stuck") {
    return "attempted"
  }
  if (/^Tried/.test(text)) return "attempted"
  return "info"
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
    history: [
      ...task.history,
      {
        id: eventId(at, task),
        at,
        type,
        text,
        kind: inferEventKind(type, text),
      },
    ].slice(-MAX_HISTORY),
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
  return observeFriction(state, applyAction(state, action), action)
}

function applyAction(state: Workspace, action: WorkspaceAction): Workspace {
  switch (action.type) {
    case "create-task": {
      const deadline = action.deadline ?? null
      const task: Task = withEvent(
        {
          id: action.id,
          title: action.title.trim(),
          description: action.description?.trim() ?? "",
          status: "not-started",
          priority: action.priority ?? "none",
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
          recovery: null,
          rejectedPlans: [],
          workDoc: null,
          instructions: null,
          aiConsentAt: null,
          pendingBreakdown: null,
          currentSubtaskId: null,
          lastWorkedAt: null,
          recoveryAttempts: [],
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
              {
                id: action.subId,
                title: action.title.trim(),
                done: false,
                source: "user" as const,
                completedAt: null,
              },
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
      return mapTask(state, action.id, (task) => {
        const sub = task.subtasks.find((item) => item.id === action.subId)
        if (!sub) return task
        const subtasks = task.subtasks.filter(
          (item) => item.id !== action.subId
        )
        return withEvent(
          {
            ...task,
            subtasks,
            progress: stepProgress(subtasks, task.progress),
          },
          action.at,
          "subtask",
          `Removed step: ${sub.title}`
        )
      })

    case "edit-subtask":
      return mapTask(state, action.id, (task) => {
        const title = action.title.trim()
        const sub = task.subtasks.find((item) => item.id === action.subId)
        if (!sub || !title || title === sub.title) return task
        return withEvent(
          {
            ...task,
            subtasks: task.subtasks.map((item) =>
              item.id === action.subId ? { ...item, title } : item
            ),
          },
          action.at,
          "subtask",
          `Edited step: ${title}`
        )
      })

    case "move-subtask":
      return mapTask(state, action.id, (task) => {
        const index = task.subtasks.findIndex((sub) => sub.id === action.subId)
        const target = index + action.direction
        if (index < 0 || target < 0 || target >= task.subtasks.length)
          return task
        const subtasks = [...task.subtasks]
        const [moved] = subtasks.splice(index, 1)
        subtasks.splice(target, 0, moved)
        return { ...task, subtasks }
      })

    case "split-subtask": {
      // A running timer follows the work to the first of the smaller steps.
      const timer =
        state.timer?.subtaskId === action.subId && action.steps.length
          ? { ...state.timer, subtaskId: action.steps[0].id }
          : state.timer
      return mapTask({ ...state, timer }, action.id, (task) => {
        const index = task.subtasks.findIndex((sub) => sub.id === action.subId)
        if (index < 0 || !action.steps.length) return task
        const original = task.subtasks[index]
        // A finished step is real work, so it's never replaced.
        if (original.done) return task
        const subtasks = [...task.subtasks]
        subtasks.splice(
          index,
          1,
          ...action.steps.map((step) => ({
            id: step.id,
            title: step.title.trim(),
            done: false,
            source: original.source,
            completedAt: null,
          }))
        )
        return withEvent(
          {
            ...task,
            subtasks,
            currentSubtaskId: null,
            progress: stepProgress(subtasks, task.progress),
          },
          action.at,
          "subtask",
          `Accepted smaller steps in place of: ${original.title}`
        )
      })
    }

    case "set-current-subtask":
      return mapTask(state, action.id, (task) => ({
        ...task,
        currentSubtaskId: action.subId,
        lastWorkedAt: action.at,
      }))

    case "set-breakdown":
      return mapTask(state, action.id, (task) =>
        withEvent(
          { ...task, pendingBreakdown: action.breakdown },
          action.at,
          "breakdown",
          `Suggested a breakdown with ${action.breakdown.steps.length} steps (${sourceName(action.breakdown)})`
        )
      )

    case "accept-breakdown":
      return mapTask(state, action.id, (task) => {
        const pending = task.pendingBreakdown
        const source: Subtask["source"] = pending?.source ?? "user"
        // Finished work always stays. Only the steps still open are replaced.
        const done = task.subtasks.filter((sub) => sub.done)
        const subtasks = [
          ...done,
          ...action.steps.map((step) => ({
            id: step.id,
            title: step.title.trim(),
            done: false,
            source,
            completedAt: null,
          })),
        ]
        return withEvent(
          {
            ...task,
            subtasks,
            pendingBreakdown: null,
            currentSubtaskId: null,
            lastWorkedAt: action.at,
            progress: stepProgress(subtasks, task.progress),
          },
          action.at,
          "breakdown",
          `Accepted a breakdown with ${action.steps.length} steps${done.length ? ` (kept ${done.length} finished)` : ""}`
        )
      })

    case "decline-breakdown":
      return mapTask(state, action.id, (task) =>
        withEvent(
          { ...task, pendingBreakdown: null },
          action.at,
          "breakdown",
          "Declined a suggested breakdown"
        )
      )

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

    case "save-work-doc":
      return mapTask(state, action.id, (task) => {
        const previous = task.workDoc?.previous ?? null
        const unchanged = task.workDoc?.content === action.content
        const saved: Task = {
          ...task,
          lastWorkedAt: unchanged ? task.lastWorkedAt : action.at,
          workDoc: {
            content: action.content,
            cursor: action.cursor,
            previous,
            updatedAt: unchanged
              ? (task.workDoc?.updatedAt ?? action.at)
              : action.at,
          },
        }
        return task.workDoc || unchanged
          ? saved
          : withEvent(
              saved,
              action.at,
              "document",
              "Started the working document"
            )
      })

    case "restore-work-doc":
      return mapTask(state, action.id, (task) =>
        withEvent(
          {
            ...task,
            workDoc: {
              content: action.content,
              previous: action.previous,
              cursor: 0,
              updatedAt: action.at,
            },
          },
          action.at,
          "document",
          "Went back to the version from before a suggestion"
        )
      )

    case "accept-doc-suggestion":
      return mapTask(state, action.id, (task) =>
        withEvent(
          {
            ...task,
            lastWorkedAt: action.at,
            workDoc: {
              content: task.workDoc?.content ?? "",
              cursor: task.workDoc?.cursor ?? 0,
              updatedAt: task.workDoc?.updatedAt ?? action.at,
              previous: action.previous,
            },
          },
          action.at,
          "document",
          `Accepted a suggestion into the document: ${action.label}`
        )
      )

    case "set-instructions":
      return mapTask(state, action.id, (task) =>
        withEvent(
          {
            ...task,
            instructions: action.instructions,
            // Agreeing to send old text doesn't cover new text.
            aiConsentAt: null,
          },
          action.at,
          "instructions",
          action.instructions
            ? `Added instructions${action.instructions.sourceName ? ` from ${action.instructions.sourceName}` : ""}`
            : "Removed the instructions"
        )
      )

    case "set-ai-consent":
      return mapTask(state, action.id, (task) => ({
        ...task,
        aiConsentAt: action.at,
      }))

    case "log-doc-suggestion":
      return mapTask(state, action.id, (task) =>
        withEvent(task, action.at, "document", action.text)
      )

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

    case "set-recovery":
      return mapTask(state, action.id, (task) => {
        const recovery = action.recovery
        if (!recovery) return { ...task, recovery: null }
        const attempt: RecoveryAttempt = {
          id: `${recovery.createdAt}-${task.recoveryAttempts.length}`,
          at: recovery.createdAt,
          subtaskId: currentSubtask(task)?.id ?? null,
          obstacle: action.obstacle ?? "",
          suggestion: recovery.plan.nextStep.instruction,
          source: recovery.source,
          outcome: "suggested",
        }
        return withEvent(
          {
            ...task,
            recovery,
            recoveryAttempts: [...task.recoveryAttempts, attempt].slice(-50),
          },
          recovery.createdAt,
          "recovery",
          `Suggested a recovery plan (${sourceName(recovery)}): ${recovery.plan.nextStep.instruction}`
        )
      })

    case "append-to-doc":
      return mapTask(state, action.id, (task) => {
        const previous = task.workDoc?.content ?? ""
        return withEvent(
          {
            ...task,
            lastWorkedAt: action.at,
            workDoc: {
              content: `${previous}<p><span data-suggested="true">${escapeHtml(action.text)}</span></p>`,
              cursor: task.workDoc?.cursor ?? 0,
              previous,
              updatedAt: action.at,
            },
          },
          action.at,
          "document",
          `Accepted a suggestion into the document: ${action.label}`
        )
      })

    case "decline-recovery":
      return mapTask(state, action.id, (task) => {
        if (!task.recovery) return task
        const { plan } = task.recovery
        return withEvent(
          {
            ...task,
            recovery: null,
            recoveryAttempts: markLastAttempt(task, "declined"),
            rejectedPlans: [
              ...task.rejectedPlans,
              {
                nextStep: plan.nextStep.instruction.slice(0, 400),
                artifactTitle: plan.artifact.title.slice(0, 400),
              },
            ].slice(-10),
          },
          action.at,
          "recovery",
          `Declined a suggested plan: ${plan.headline}`
        )
      })

    case "apply-recovery": {
      const pending = state.tasks.find(
        (task) => task.id === action.id
      )?.recovery
      if (!pending) return state
      const source = pending.source
      const planned: PlannedSession[] = action.schedule.map((item) => ({
        id: item.id,
        taskId: action.id,
        date: item.date,
        time: null,
        minutes: item.minutes,
        label: item.label,
        done: false,
      }))
      const next = mapTask(state, action.id, (task) => {
        let updated: Task = {
          ...task,
          recovery: null,
          recoveryAttempts: markLastAttempt(task, "accepted"),
          nextAction: action.nextAction ?? task.nextAction,
          subtasks: [
            ...task.subtasks,
            ...action.steps.map((step) => ({
              ...step,
              done: false,
              source,
              completedAt: null,
            })),
          ],
          documents: action.document
            ? [
                ...task.documents,
                {
                  ...action.document,
                  source,
                  updatedAt: action.at,
                },
              ]
            : task.documents,
        }
        const added = [
          action.nextAction && "next action",
          action.document && "draft",
          action.steps.length && `${action.steps.length} steps`,
          planned.length && `${planned.length} work sessions`,
        ].filter(Boolean)
        const origin = source === "live" ? "Live AI" : "Demo Mode template"
        updated = withEvent(
          updated,
          action.at,
          "recovery",
          `Accepted a recovery plan from ${origin}: ${pending.plan.headline}${
            added.length ? ` (added ${added.join(", ")})` : ""
          }`
        )
        for (const item of planned) {
          updated = withEvent(
            updated,
            action.at,
            "schedule",
            `Work session planned for ${shortDate(item.date)} (${item.minutes} min)`
          )
        }
        return setTaskStatus(
          updated,
          action.release
            ? "released"
            : updated.status === "needs-recovery"
              ? "in-progress"
              : updated.status,
          action.at
        )
      })
      return { ...next, planned: [...next.planned, ...planned] }
    }

    case "timer-start": {
      if (state.timer) return state
      const timer: TimerState = {
        id: action.id,
        kind: action.kind,
        taskId: action.taskId,
        subtaskId: action.subtaskId ?? null,
        plannedSeconds: action.minutes * 60,
        startedAt: action.at,
        runningSince: action.now,
        accumulatedMs: 0,
      }
      const next = { ...state, timer, finishedSessionId: null }
      if (action.kind !== "focus" || !action.taskId) return next
      return mapTask(next, action.taskId, (task) => {
        const started = withEvent(
          { ...task, lastWorkedAt: action.at },
          action.at,
          "focus",
          `Started a focus session (${action.minutes} min)`
        )
        return task.status === "not-started" ||
          task.status === "paused" ||
          task.status === "needs-recovery"
          ? setTaskStatus(started, "in-progress", action.at)
          : started
      })
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

    case "report-focus": {
      const session = state.focusSessions.find(
        (item) => item.id === action.sessionId
      )
      if (!session) return state
      const next: Workspace = {
        ...state,
        focusSessions: state.focusSessions.map((item) =>
          item.id === action.sessionId
            ? { ...item, progressReport: action.report }
            : item
        ),
      }
      if (!session.taskId) return next
      return mapTask(next, session.taskId, (task) => {
        if (action.report === "stuck") {
          return setTaskStatus(
            withEvent(
              task,
              action.at,
              "stuck",
              "Reported being stuck after a focus session"
            ),
            "needs-recovery",
            action.at
          )
        }
        const reported = withEvent(
          task,
          action.at,
          "progress",
          `Reported progress after a focus session: ${action.report === "yes" ? "yes" : "a little"}`
        )
        // With steps, progress comes only from steps the user marks finished.
        return task.subtasks.length
          ? reported
          : {
              ...reported,
              progress: Math.min(
                95,
                task.progress + (action.report === "yes" ? 10 : 5)
              ),
            }
      })
    }

    case "report-stuck":
      return mapTask(state, action.id, (task) => {
        const reported = withEvent(
          task,
          action.at,
          "stuck",
          "Reported being stuck"
        )
        return action.text
          ? withEvent(reported, action.at, "obstacle", action.text)
          : reported
      })

    case "timer-acknowledge":
      return { ...state, finishedSessionId: null }

    case "log-help":
      return state

    case "learning":
      return { ...state, learning: { ...state.learning, ...action.patch } }

    case "delete-friction":
      return {
        ...state,
        frictionLog: state.frictionLog.filter((item) => item.id !== action.id),
      }

    case "clear-friction":
      return {
        ...state,
        frictionLog: [],
        learning: { ...state.learning, dismissed: [] },
      }

    case "mark-opened":
      return { ...state, lastOpenedAt: action.at }

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
    subtaskId: timer.subtaskId,
    progressReport: null,
    plannedMinutes: timer.plannedSeconds / 60,
    startedAt: timer.startedAt,
    ...result,
  }
  const length = formatMinutes(result.actualSeconds)
  const interrupted = isInterrupted(session)
  const text = interrupted
    ? `Interrupted attempt (${length})${result.outcome === "stuck" ? ": got stuck" : ""}`
    : result.outcome === "completed"
      ? `Focus session finished (${length})`
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

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** The most recent suggestion is the one the user has just decided about. */
function markLastAttempt(task: Task, outcome: RecoveryAttempt["outcome"]) {
  const attempts = [...task.recoveryAttempts]
  const last = attempts.at(-1)
  if (last?.outcome === "suggested") {
    attempts[attempts.length - 1] = { ...last, outcome }
  }
  return attempts
}

function stepProgress(subtasks: Task["subtasks"], fallback: number) {
  if (!subtasks.length) return fallback
  const done = subtasks.filter((item) => item.done).length
  return Math.round((done / subtasks.length) * 100)
}

function sourceName(pending: { source: "live" | "demo" }) {
  return pending.source === "live" ? "Live AI" : "Demo Mode template"
}

function toggleSubtask(task: Task, subId: string, at: string): Task {
  const sub = task.subtasks.find((item) => item.id === subId)
  if (!sub) return task
  const subtasks = task.subtasks.map((item) =>
    item.id === subId
      ? { ...item, done: !item.done, completedAt: item.done ? null : at }
      : item
  )
  return withEvent(
    {
      ...task,
      subtasks,
      lastWorkedAt: at,
      currentSubtaskId:
        task.currentSubtaskId === subId ? null : task.currentSubtaskId,
      progress: stepProgress(subtasks, task.progress),
    },
    at,
    "subtask",
    `${sub.done ? "Reopened" : "Completed"}: ${sub.title}`
  )
}
