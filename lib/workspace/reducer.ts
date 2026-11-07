import { endRoutineRule, parseRoutineRule } from "@/lib/calendar/derived"
import { elapsedMs, finishTime, formatMinutes } from "@/lib/focus/timer"
import type { CasePlan } from "@/lib/recovery/case-engine"
import { shortDate } from "@/lib/workspace/dates"
import { observeFriction } from "@/lib/workspace/friction"
import type {
  Blocker,
  CaseFeedback,
  CaseTool,
  DailyPlan,
  HelpKind,
  Learning,
  ProgressEvent,
  Recovery,
  RecoveryReason,
  RealityCheckAnswers,
  RealityGap,
  RecoveryCase,
  RecoveryPath,
  Routine,
  RoutinePlacement,
} from "@/lib/workspace/schemas"
import {
  BLOCKER_LABEL,
  STATUS_LABEL,
  STUCK_LABEL,
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

type PlacementInput = Omit<
  RoutinePlacement,
  "minutes" | "adjusted" | "result"
> &
  Partial<Pick<RoutinePlacement, "minutes" | "adjusted" | "result">>

export type WorkspaceAction =
  | {
      type: "create-task"
      id: string
      at: string
      title: string
      description?: string
      deadline?: string | null
      priority?: Priority
      estimateMinutes?: number | null
    }
  | {
      type: "edit-task"
      id: string
      at: string
      patch: Partial<
        Pick<
          Task,
          | "title"
          | "description"
          | "priority"
          | "nextAction"
          | "estimateMinutes"
          | "firstStep"
          | "resumeNote"
          | "link"
          | "minimumVersion"
          | "focusTheme"
        >
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
  | {
      type: "add-planned"
      at: string
      session: Omit<PlannedSession, "outcome" | "window"> &
        Partial<Pick<PlannedSession, "outcome" | "window">>
    }
  | {
      type: "enter-recovery"
      at: string
      taskId: string | null
      plannedId?: string | null
      source: Recovery["source"]
    }
  | { type: "recovery-reason"; reason: RecoveryReason | null }
  | { type: "exit-recovery" }
  | {
      type: "recovery-shown"
      at: string
      taskId: string
      plannedId: string
    }
  | { type: "recovery-action"; at: string; taskId: string }
  | {
      type: "release-task"
      at: string
      id: string
      /** "defer" sets it aside for now. "release" lets it go on purpose. */
      mode: "defer" | "release"
    }
  | {
      type: "planned-outcome"
      at: string
      id: string
      outcome: "did" | "didnt"
      /** The focus record to create when it happened. */
      sessionId: string
      /** The time they say they spent, when it differs from the plan. */
      minutes?: number
    }
  | { type: "undo-reported-session"; at: string; sessionId: string }
  | {
      type: "move-planned"
      at: string
      id: string
      date: string
      time: string | null
      window?: PlannedSession["window"]
    }
  | { type: "remove-planned"; at: string; id: string }
  | { type: "resize-planned"; at: string; id: string; minutes: number }
  | {
      type: "add-routine"
      routine: Omit<
        Routine,
        | "priorRules"
        | "kind"
        | "minimumVersion"
        | "minimumDates"
        | "skippedDates"
      > &
        Partial<Routine>
    }
  | {
      type: "update-routine-future"
      id: string
      /** The first date the change applies to. Earlier weeks keep their rule. */
      fromDate: string
      rrule: string
      duration: number
    }
  | {
      type: "update-placement"
      id: string
      date: string
      time: string
      minutes: number | null
    }
  | {
      type: "update-routine"
      id: string
      patch: Partial<
        Pick<
          Routine,
          | "name"
          | "color"
          | "emoji"
          | "rrule"
          | "duration"
          | "kind"
          | "minimumVersion"
        >
      >
    }
  | { type: "delete-routine"; id: string }
  | { type: "toggle-routine-done"; routineId: string; date: string }
  | {
      type: "routine-outcome"
      routineId: string
      date: string
      /** The one-off this applies to, if it isn't a regular occurrence. */
      placementId?: string | null
      outcome: "full" | "minimum" | "skipped" | null
    }
  | { type: "place-routine"; placement: PlacementInput }
  | {
      type: "move-routine-occurrence"
      routineId: string
      fromDate: string
      placement: PlacementInput
    }
  | { type: "move-placement"; id: string; date: string; time: string }
  | { type: "toggle-placement"; id: string }
  | { type: "remove-placement"; id: string }
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
      plannedId?: string | null
      /** Starting from a recovery card, which counts as restarting. */
      restart?: boolean
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
  | {
      type: "session-wrap-up"
      sessionId: string
      at: string
      outcome: "progress" | "minimum" | "completed"
      resumeNote: string
    }
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "mark-opened"; at: string }
  | { type: "set-daily-plan"; plan: DailyPlan }
  | { type: "toggle-daily-item"; taskId: string }
  | { type: "move-daily-item"; taskId: string; by: -1 | 1 }
  | { type: "log-help"; id: string; at: string; helpKind: HelpKind }
  | { type: "learning"; patch: Partial<Learning> }
  | { type: "delete-friction"; id: string }
  | { type: "clear-friction" }
  | { type: "skip-recommendation"; taskId: string; date: string }
  | { type: "replace"; state: Workspace }
  | { type: "set-intake-draft"; text: string }
  | { type: "mark-reminded"; key: string }
  | {
      type: "park-thought"
      id: string
      at: string
      text: string
      taskId: string | null
    }
  | { type: "remove-thought"; id: string }
  | {
      type: "add-quick-task"
      id: string
      at: string
      title: string
    }
  | {
      type: "start-case"
      /** An existing task becomes the case, so it's never duplicated. */
      id: string
      at: string
      input: string
      title: string
      suggestedBlocker: Blocker | null
    }
  | { type: "case-set-blocker"; id: string; at: string; blocker: Blocker }
  | {
      type: "case-understood"
      id: string
      title: string | null
      suggestedBlocker: Blocker | null
    }
  | { type: "case-apply-plan"; id: string; at: string; plan: CasePlan }
  | { type: "case-start-action"; id: string; at: string }
  | { type: "case-complete-action"; id: string; at: string }
  | { type: "case-write-action"; id: string; at: string; text: string }
  | { type: "case-feedback"; id: string; at: string; feedback: CaseFeedback }
  | {
      type: "case-update"
      id: string
      at: string
      patch: {
        realityGap?: RealityGap
        realityCheck?: RealityCheckAnswers
        messageDraft?: string
        queue?: string[]
        openTools?: CaseTool[]
      }
    }
  | { type: "case-set-path"; id: string; at: string; path: RecoveryPath }
  | { type: "case-answer-detail"; id: string; at: string; text: string }
  | { type: "case-resume"; id: string; at: string }
  | { type: "case-pause"; id: string; at: string }

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

function blankCase(
  input: string,
  suggestedBlocker: Blocker | null,
  at: string
): RecoveryCase {
  return {
    originalInput: input,
    blocker: null,
    suggestedBlocker,
    current: null,
    queue: [],
    alternatives: [],
    completed: [],
    tried: [],
    realityGap: null,
    realityCheck: null,
    path: null,
    messageDraft: "",
    openTools: [],
    missingDetail: "",
    adaptationNote: "",
    lastFeedback: null,
    lastActivity: { at, text: "Told BackOnTrack about this" },
    resumedAt: null,
    pausedOnPurpose: false,
  }
}

function caseActionId(at: string, recovery: RecoveryCase) {
  return `${at}-${recovery.completed.length + recovery.tried.length}`
}

/** Applies a change to a task's case, keeping its next action in step with Tasks. */
function updateCase(
  state: Workspace,
  id: string,
  at: string,
  update: (recovery: RecoveryCase, task: Task) => RecoveryCase,
  activity?: string
): Workspace {
  return mapTask(state, id, (task) => {
    if (!task.recoveryCase) return task
    const next = update(task.recoveryCase, task)
    return {
      ...task,
      updatedAt: at,
      nextAction: next.current?.text ?? "",
      recoveryCase: activity
        ? { ...next, lastActivity: { at, text: activity } }
        : next,
    }
  })
}

function completeCaseAction(task: Task, at: string): Task {
  const recovery = task.recoveryCase
  if (!recovery?.current) return task
  const { current } = recovery
  const [next, ...queue] = recovery.queue
  const updated: RecoveryCase = {
    ...recovery,
    completed: [
      ...recovery.completed,
      { id: current.id, text: current.text, at },
    ],
    queue,
    current: next
      ? {
          id: `${at}-${recovery.completed.length + recovery.tried.length + 1}`,
          text: next,
          why: "",
          origin: current.origin,
          createdAt: at,
          startedAt: null,
        }
      : null,
    adaptationNote: "",
    missingDetail: "",
    lastFeedback: { kind: "did-it", reason: null, detail: "", at },
    lastActivity: { at, text: `Finished: ${current.text}` },
  }
  const done = withEvent(
    {
      ...task,
      recoveryCase: updated,
      nextAction: updated.current?.text ?? "",
      lastWorkedAt: at,
    },
    at,
    "action",
    `Completed: ${current.text}`
  )
  return setTaskStatus(
    done,
    done.status === "not-started" || done.status === "needs-recovery"
      ? "in-progress"
      : done.status,
    at
  )
}

const MAX_PROGRESS_EVENTS = 1000

/** Written from what really changed, so no screen can record a moment twice. */
function observeProgress(
  before: Workspace,
  after: Workspace,
  action: WorkspaceAction
): Workspace {
  if (action.type === "delete-task") {
    return {
      ...after,
      progressEvents: after.progressEvents.filter(
        (item) => item.taskId !== action.id
      ),
    }
  }
  const added: Omit<ProgressEvent, "id">[] = []
  // Only a session that really began is a restart. Looking at a card isn't.
  if (
    action.type === "timer-start" &&
    action.kind === "focus" &&
    action.taskId &&
    after.timer?.id === action.id &&
    (action.restart || before.recovery?.taskId === action.taskId)
  ) {
    added.push({
      taskId: action.taskId,
      type: "restarted",
      at: action.at,
      sessionId: action.id,
    })
    added.push({
      taskId: action.taskId,
      type: "recovery_action_taken",
      at: action.at,
      sessionId: action.id,
    })
  }
  if (action.type === "enter-recovery" && action.taskId) {
    added.push({
      taskId: action.taskId,
      type: "recovery_shown",
      at: action.at,
      sessionId: action.plannedId ?? null,
    })
  }
  if (
    action.type === "recovery-shown" &&
    !after.progressEvents.some(
      (item) =>
        item.type === "recovery_shown" && item.sessionId === action.plannedId
    )
  ) {
    added.push({
      taskId: action.taskId,
      type: "recovery_shown",
      at: action.at,
      sessionId: action.plannedId,
    })
  }
  if (action.type === "recovery-action") {
    added.push({
      taskId: action.taskId,
      type: "recovery_action_taken",
      at: action.at,
      sessionId: null,
    })
  }
  if (action.type === "release-task") {
    added.push({
      taskId: action.id,
      type: "recovery_action_taken",
      at: action.at,
      sessionId: null,
    })
  }
  if (
    action.type === "timer-start" &&
    action.kind === "focus" &&
    action.taskId &&
    after.timer?.id === action.id &&
    !after.progressEvents.some(
      (item) => item.taskId === action.taskId && item.type === "started"
    )
  ) {
    added.push({
      taskId: action.taskId,
      type: "started",
      at: action.at,
      sessionId: action.id,
    })
  }
  const sessionId = action.type === "session-wrap-up" ? action.sessionId : null
  if (action.type === "session-wrap-up" && action.outcome === "minimum") {
    const session = after.focusSessions.find((item) => item.id === sessionId)
    if (session?.taskId) {
      added.push({
        taskId: session.taskId,
        type: "minimum_met",
        at: action.at,
        sessionId,
      })
    }
  }
  if (after.tasks !== before.tasks) {
    for (const task of after.tasks) {
      if (task.status !== "completed" || !task.completedAt) continue
      const old = before.tasks.find((item) => item.id === task.id)
      if (old && old.status !== "completed") {
        added.push({
          taskId: task.id,
          type: "completed",
          at: task.completedAt,
          sessionId,
        })
      }
    }
  }
  if (!added.length) return after
  return {
    ...after,
    progressEvents: [
      ...after.progressEvents,
      ...added.map((item, index) => ({
        ...item,
        id: `${item.at}-${after.progressEvents.length + index}`,
      })),
    ].slice(-MAX_PROGRESS_EVENTS),
  }
}

export function workspaceReducer(
  state: Workspace,
  action: WorkspaceAction
): Workspace {
  return observeProgress(
    state,
    observeFriction(state, applyAction(state, action), action),
    action
  )
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
          estimateMinutes: action.estimateMinutes ?? null,
          recoveryCase: null,
          quick: false,
          firstStep: "",
          resumeNote: "",
          link: "",
          minimumVersion: "",
          focusTheme: null,
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
        // The task's next action and the case's current step are the same thing.
        if (patch.nextAction !== undefined && task.recoveryCase) {
          const recovery = task.recoveryCase
          const text = patch.nextAction.trim()
          updated = {
            ...updated,
            recoveryCase: {
              ...recovery,
              current: text
                ? {
                    id: recovery.current?.id ?? caseActionId(at, recovery),
                    why: "",
                    createdAt: recovery.current?.createdAt ?? at,
                    startedAt: recovery.current?.startedAt ?? null,
                    text,
                    origin: "user",
                  }
                : null,
            },
          }
        }
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
      return mapTask(state, action.id, (task) => {
        const changed = setTaskStatus(
          task,
          action.status,
          action.at,
          action.note
        )
        if (!changed.recoveryCase || changed === task) return changed
        return {
          ...changed,
          recoveryCase: {
            ...changed.recoveryCase,
            pausedOnPurpose:
              action.status === "paused" &&
              changed.recoveryCase.pausedOnPurpose,
            lastActivity: {
              at: action.at,
              text: `Marked ${STATUS_LABEL[action.status].toLowerCase()}`,
            },
          },
        }
      })

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
        if (task.recoveryCase?.current) {
          return completeCaseAction(task, action.at)
        }
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
        dailyPlan: state.dailyPlan && {
          ...state.dailyPlan,
          items: state.dailyPlan.items.filter(
            (item) => item.taskId !== action.id
          ),
        },
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

    case "planned-outcome": {
      const session = state.planned.find((item) => item.id === action.id)
      if (!session || session.outcome) return state
      const task = state.tasks.find((item) => item.id === session.taskId)
      if (action.outcome === "didnt") {
        return {
          ...mapTask(state, session.taskId, (item) =>
            withEvent(
              item,
              action.at,
              "schedule",
              `Didn’t do a planned session (${session.minutes} min)`
            )
          ),
          planned: state.planned.map((item) =>
            item.id === action.id
              ? { ...item, outcome: "didnt" as const }
              : item
          ),
        }
      }
      const start = new Date(`${session.date}T${session.time ?? "12:00"}:00`)
      const minutes =
        action.minutes && action.minutes > 0 ? action.minutes : session.minutes
      const record: FocusSession = {
        id: action.sessionId,
        taskId: session.taskId,
        taskTitle: task?.title ?? "no specific task",
        plannedMinutes: session.minutes,
        actualSeconds: minutes * 60,
        startedAt: start.toISOString(),
        endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
        outcome: "completed",
        note: "",
        subtaskId: null,
        progressReport: null,
        plannedId: session.id,
        reported: true,
        endOutcome: null,
      }
      const next: Workspace = {
        ...mapTask(state, session.taskId, (item) => {
          const logged = withEvent(
            { ...item, lastWorkedAt: action.at },
            action.at,
            "focus",
            `Reported doing a planned session (${minutes} min)`
          )
          return item.status === "not-started"
            ? setTaskStatus(logged, "in-progress", action.at)
            : logged
        }),
        planned: state.planned.map((item) =>
          item.id === action.id
            ? { ...item, done: true, outcome: "did" as const }
            : item
        ),
        focusSessions: [...state.focusSessions, record],
      }
      return next
    }

    case "undo-reported-session": {
      const record = state.focusSessions.find(
        (item) => item.id === action.sessionId && item.reported
      )
      if (!record) return state
      const undone: Workspace = {
        ...state,
        focusSessions: state.focusSessions.filter((item) => item !== record),
        planned: state.planned.map((item) =>
          item.id === record.plannedId
            ? { ...item, done: false, outcome: null }
            : item
        ),
      }
      return record.taskId
        ? mapTask(undone, record.taskId, (item) =>
            withEvent(
              item,
              action.at,
              "schedule",
              "Took back a reported session"
            )
          )
        : undone
    }

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
        planned: [
          ...state.planned,
          { outcome: null, window: null, ...action.session },
        ],
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
            ? {
                ...item,
                date: action.date,
                time: action.time,
                window: action.time ? null : (action.window ?? null),
                // Moving it gives it a new chance, so the old answer is gone.
                outcome: item.outcome === "didnt" ? null : item.outcome,
              }
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

    case "resize-planned": {
      const session = state.planned.find((item) => item.id === action.id)
      const minutes = Math.max(5, Math.round(action.minutes))
      if (!session || session.minutes === minutes) return state
      return {
        ...mapTask(state, session.taskId, (task) =>
          withEvent(
            task,
            action.at,
            "schedule",
            `Work session changed to ${minutes} min`
          )
        ),
        planned: state.planned.map((item) =>
          item.id === action.id ? { ...item, minutes } : item
        ),
      }
    }

    case "add-routine":
      return {
        ...state,
        routines: [
          ...state.routines,
          {
            priorRules: [],
            kind: "fixed" as const,
            minimumVersion: "",
            minimumDates: [],
            skippedDates: [],
            ...action.routine,
          },
        ],
      }

    case "update-routine-future":
      return {
        ...state,
        routines: state.routines.map((routine) => {
          if (routine.id !== action.id) return routine
          const { startDate } = parseRoutineRule(routine.rrule)
          // Nothing has happened under the old rule yet, so there's nothing to keep.
          const keepsHistory = startDate < action.fromDate
          return {
            ...routine,
            rrule: action.rrule,
            duration: action.duration,
            priorRules: keepsHistory
              ? [
                  ...routine.priorRules,
                  {
                    rrule: endRoutineRule(routine.rrule, action.fromDate),
                    duration: routine.duration,
                  },
                ]
              : routine.priorRules,
          }
        }),
      }

    case "update-placement":
      return {
        ...state,
        routinePlacements: state.routinePlacements.map((item) =>
          item.id === action.id
            ? {
                ...item,
                date: action.date,
                time: action.time,
                minutes: action.minutes,
                adjusted: true,
              }
            : item
        ),
      }

    case "update-routine":
      return {
        ...state,
        routines: state.routines.map((routine) =>
          routine.id === action.id ? { ...routine, ...action.patch } : routine
        ),
      }

    case "delete-routine":
      return {
        ...state,
        routines: state.routines.filter((item) => item.id !== action.id),
        routinePlacements: state.routinePlacements.filter(
          (item) => item.routineId !== action.id
        ),
      }

    case "toggle-routine-done":
      return {
        ...state,
        routines: state.routines.map((routine) =>
          routine.id === action.routineId
            ? {
                ...routine,
                doneDates: routine.doneDates.includes(action.date)
                  ? routine.doneDates.filter((date) => date !== action.date)
                  : [...routine.doneDates, action.date],
              }
            : routine
        ),
      }

    case "routine-outcome": {
      if (action.placementId) {
        return {
          ...state,
          routinePlacements: state.routinePlacements.map((item) =>
            item.id === action.placementId
              ? {
                  ...item,
                  result: action.outcome,
                  done: action.outcome === "full",
                }
              : item
          ),
        }
      }
      // Each date has one outcome. Minimum is never stored as full.
      const without = (dates: string[]) =>
        dates.filter((date) => date !== action.date)
      return {
        ...state,
        routines: state.routines.map((routine) =>
          routine.id === action.routineId
            ? {
                ...routine,
                doneDates:
                  action.outcome === "full"
                    ? [...without(routine.doneDates), action.date]
                    : without(routine.doneDates),
                minimumDates:
                  action.outcome === "minimum"
                    ? [...without(routine.minimumDates), action.date]
                    : without(routine.minimumDates),
                skippedDates:
                  action.outcome === "skipped"
                    ? [...without(routine.skippedDates), action.date]
                    : without(routine.skippedDates),
              }
            : routine
        ),
      }
    }

    case "place-routine":
      return {
        ...state,
        routinePlacements: [
          ...state.routinePlacements,
          { minutes: null, adjusted: false, result: null, ...action.placement },
        ],
      }

    case "move-routine-occurrence":
      // Moving one occurrence leaves the rest of the routine where it is.
      return {
        ...state,
        routines: state.routines.map((routine) =>
          routine.id === action.routineId
            ? {
                ...routine,
                exdates: [...new Set([...routine.exdates, action.fromDate])],
                doneDates: routine.doneDates.filter(
                  (date) => date !== action.fromDate
                ),
                minimumDates: routine.minimumDates.filter(
                  (date) => date !== action.fromDate
                ),
                skippedDates: routine.skippedDates.filter(
                  (date) => date !== action.fromDate
                ),
              }
            : routine
        ),
        routinePlacements: [
          ...state.routinePlacements,
          { minutes: null, adjusted: true, result: null, ...action.placement },
        ],
      }

    case "move-placement":
      return {
        ...state,
        routinePlacements: state.routinePlacements.map((item) =>
          item.id === action.id
            ? { ...item, date: action.date, time: action.time, adjusted: true }
            : item
        ),
      }

    case "toggle-placement":
      return {
        ...state,
        routinePlacements: state.routinePlacements.map((item) =>
          item.id === action.id ? { ...item, done: !item.done } : item
        ),
      }

    case "remove-placement":
      return {
        ...state,
        routinePlacements: state.routinePlacements.filter(
          (item) => item.id !== action.id
        ),
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
        outcome: null,
        window: null,
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
        plannedId: action.plannedId ?? null,
      }
      const next = {
        ...state,
        timer,
        finishedSessionId: null,
        // A real start ends the recovery that led to it.
        recovery:
          action.kind === "focus" && state.recovery?.taskId === action.taskId
            ? null
            : state.recovery,
      }
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

    case "session-wrap-up": {
      const reported = applyAction(state, {
        type: "report-focus",
        sessionId: action.sessionId,
        report: "yes",
        at: action.at,
      })
      const session = state.focusSessions.find(
        (item) => item.id === action.sessionId
      )
      const next: Workspace = {
        ...reported,
        focusSessions: reported.focusSessions.map((item) =>
          item.id === action.sessionId
            ? { ...item, endOutcome: action.outcome }
            : item
        ),
      }
      if (!session?.taskId) return next
      const note = action.resumeNote.trim()
      return mapTask(next, session.taskId, (task) => {
        let updated = task
        if (note) {
          updated = withEvent(
            { ...updated, resumeNote: note },
            action.at,
            "action",
            `Left a note for next time: ${note}`
          )
        }
        // The smaller version counts for what it is, not as the whole task.
        if (action.outcome === "minimum") {
          updated = withEvent(
            updated,
            action.at,
            "progress",
            task.minimumVersion
              ? `Met the minimum version: ${task.minimumVersion}`
              : "Met the minimum version"
          )
        }
        return action.outcome === "completed"
          ? setTaskStatus(updated, "completed", action.at)
          : updated
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

    case "set-daily-plan":
      return { ...state, dailyPlan: action.plan }

    case "toggle-daily-item":
      return state.dailyPlan
        ? {
            ...state,
            dailyPlan: {
              ...state.dailyPlan,
              items: state.dailyPlan.items.map((item) =>
                item.taskId === action.taskId
                  ? { ...item, done: !item.done }
                  : item
              ),
            },
          }
        : state

    case "move-daily-item": {
      if (!state.dailyPlan) return state
      const items = [...state.dailyPlan.items]
      const from = items.findIndex((item) => item.taskId === action.taskId)
      const to = from + action.by
      if (from < 0 || to < 0 || to >= items.length) return state
      const [moved] = items.splice(from, 1)
      items.splice(to, 0, moved)
      return { ...state, dailyPlan: { ...state.dailyPlan, items } }
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

    case "enter-recovery": {
      const recovery: Recovery = {
        taskId: action.taskId,
        plannedId: action.plannedId ?? null,
        source: action.source,
        reason: null,
        enteredAt: action.at,
      }
      const next = { ...state, recovery }
      if (!action.taskId) return next
      return mapTask(next, action.taskId, (task) =>
        task.recoveryCase
          ? task
          : withEvent(
              {
                ...task,
                recoveryCase: blankCase(
                  `${task.title} ${task.description}`.trim(),
                  null,
                  action.at
                ),
              },
              action.at,
              "recovery",
              "Started working through what’s in the way"
            )
      )
    }

    case "recovery-reason":
      return state.recovery
        ? { ...state, recovery: { ...state.recovery, reason: action.reason } }
        : state

    case "exit-recovery":
      return { ...state, recovery: null }

    case "recovery-shown":
    case "recovery-action":
      return state

    case "release-task":
      return mapTask({ ...state, recovery: null }, action.id, (task) => {
        const kept = task.deadline
          ? ` The original deadline stays on record: ${shortDate(task.deadline)}.`
          : ""
        const logged = withEvent(
          task,
          action.at,
          "recovery",
          action.mode === "release"
            ? `Released this in BackOnTrack.${kept}`
            : `Set this aside for now.${kept}`
        )
        return setTaskStatus(
          logged,
          action.mode === "release" ? "released" : "paused",
          action.at
        )
      })

    case "park-thought":
      return {
        ...state,
        parkingLot: [
          ...state.parkingLot,
          {
            id: action.id,
            at: action.at,
            text: action.text.trim(),
            taskId: action.taskId,
          },
        ],
      }

    case "remove-thought":
      return {
        ...state,
        parkingLot: state.parkingLot.filter((item) => item.id !== action.id),
      }

    case "mark-reminded":
      return {
        ...state,
        remindedBlocks: [...state.remindedBlocks, action.key].slice(-200),
      }

    case "set-intake-draft":
      return { ...state, intakeDraft: action.text }

    case "add-quick-task": {
      const added = applyAction(state, {
        type: "create-task",
        id: action.id,
        at: action.at,
        title: action.title,
      })
      return mapTask({ ...added, intakeDraft: "" }, action.id, (task) => ({
        ...task,
        quick: true,
      }))
    }

    case "start-case": {
      const existing = state.tasks.find((task) => task.id === action.id)
      if (existing?.recoveryCase) return state
      if (existing) {
        return mapTask({ ...state, intakeDraft: "" }, action.id, (task) =>
          withEvent(
            {
              ...task,
              quick: false,
              recoveryCase: blankCase(
                action.input,
                action.suggestedBlocker,
                action.at
              ),
            },
            action.at,
            "recovery",
            "Started working on this in Recovery"
          )
        )
      }
      const created = applyAction(state, {
        type: "create-task",
        id: action.id,
        at: action.at,
        title: action.title,
        description: action.input,
      })
      return mapTask({ ...created, intakeDraft: "" }, action.id, (task) => ({
        ...task,
        recoveryCase: blankCase(
          action.input,
          action.suggestedBlocker,
          action.at
        ),
      }))
    }

    case "case-understood":
      return mapTask(state, action.id, (task) =>
        task.recoveryCase && !task.recoveryCase.blocker
          ? {
              ...task,
              title: action.title?.trim() || task.title,
              recoveryCase: {
                ...task.recoveryCase,
                suggestedBlocker:
                  action.suggestedBlocker ?? task.recoveryCase.suggestedBlocker,
              },
            }
          : task
      )

    case "case-set-blocker": {
      const task = state.tasks.find((item) => item.id === action.id)
      const before = task?.recoveryCase?.blocker
      if (!task?.recoveryCase || before === action.blocker) return state
      const next = updateCase(
        state,
        action.id,
        action.at,
        (recovery) => ({ ...recovery, blocker: action.blocker }),
        before ? "Changed what’s in the way" : "Said what’s in the way"
      )
      return mapTask(next, action.id, (item) =>
        withEvent(
          item,
          action.at,
          "recovery",
          `What’s in the way: ${BLOCKER_LABEL[action.blocker]}`
        )
      )
    }

    case "case-apply-plan": {
      const { plan, at } = action
      const origin = plan.source
      const next = updateCase(state, action.id, at, (recovery) => {
        const old = recovery.current
        const replacing = Boolean(old) && !plan.keepCurrent
        const current =
          plan.action && !plan.keepCurrent
            ? {
                id: caseActionId(at, {
                  ...recovery,
                  tried: replacing ? [...recovery.tried, ""] : recovery.tried,
                }),
                text: plan.action.text,
                why: plan.action.why,
                origin,
                createdAt: at,
                startedAt: null,
              }
            : plan.keepCurrent
              ? old
              : null
        return {
          ...recovery,
          current,
          queue:
            plan.keepCurrent || plan.keepQueue
              ? recovery.queue.filter((step) => step !== plan.action?.text)
              : plan.queue,
          alternatives: plan.alternatives,
          // Anything already drafted or edited is the user's, so it stays.
          realityGap: recovery.realityGap ?? plan.realityGap ?? null,
          messageDraft: recovery.messageDraft || (plan.messageDraft ?? ""),
          openTools: [
            ...new Set([...recovery.openTools, ...(plan.openTools ?? [])]),
          ],
          missingDetail: plan.missingDetail,
          adaptationNote: plan.note,
          tried:
            replacing && old
              ? [...new Set([...recovery.tried, old.text])].slice(-40)
              : recovery.tried,
        }
      })
      return mapTask(next, action.id, (task) => {
        const text = task.recoveryCase?.current?.text
        const changed =
          text && !plan.keepCurrent && plan.action
            ? withEvent(
                task,
                at,
                "recovery",
                `Suggested a next step (${sourceName({ source: origin })}): ${text}`
              )
            : task
        return changed.status === "needs-recovery" && text
          ? setTaskStatus(changed, "in-progress", at)
          : changed
      })
    }

    case "case-start-action": {
      const next = updateCase(
        state,
        action.id,
        action.at,
        (recovery) =>
          recovery.current
            ? {
                ...recovery,
                current: { ...recovery.current, startedAt: action.at },
              }
            : recovery,
        "Started the next step"
      )
      return mapTask(next, action.id, (task) => {
        const started = { ...task, lastWorkedAt: action.at }
        return task.status === "not-started" ||
          task.status === "paused" ||
          task.status === "needs-recovery"
          ? setTaskStatus(started, "in-progress", action.at)
          : started
      })
    }

    case "case-complete-action":
      return mapTask(state, action.id, (task) =>
        completeCaseAction(task, action.at)
      )

    case "case-write-action": {
      const text = action.text.trim()
      if (!text) return state
      const next = updateCase(
        state,
        action.id,
        action.at,
        (recovery) => {
          const old = recovery.current
          if (old?.text === text) return recovery
          return {
            ...recovery,
            current: {
              id: old?.id ?? caseActionId(action.at, recovery),
              text,
              why: "",
              origin: "user" as const,
              createdAt: action.at,
              startedAt: old?.startedAt ?? null,
            },
            adaptationNote: "",
            missingDetail: "",
            tried:
              old && !recovery.tried.includes(old.text)
                ? [...recovery.tried, old.text].slice(-40)
                : recovery.tried,
          }
        },
        "Chose a next step"
      )
      return mapTask(next, action.id, (task) =>
        withEvent(task, action.at, "action", `Next action set: ${text}`)
      )
    }

    case "case-feedback": {
      const { feedback, at } = action
      const label =
        feedback.kind === "stuck" && feedback.reason
          ? `Reported being stuck: ${STUCK_LABEL[feedback.reason]}`
          : "Asked for another approach"
      const next = updateCase(
        state,
        action.id,
        at,
        (recovery) => ({ ...recovery, lastFeedback: feedback }),
        label
      )
      return mapTask(next, action.id, (task) => {
        const logged = withEvent(
          task,
          at,
          feedback.kind === "stuck" ? "stuck" : "recovery",
          label
        )
        return feedback.detail
          ? withEvent(logged, at, "obstacle", feedback.detail)
          : logged
      })
    }

    case "case-update":
      return updateCase(
        state,
        action.id,
        action.at,
        (recovery) => ({ ...recovery, ...action.patch }),
        action.patch.realityGap
          ? "Edited the Reality Gap"
          : action.patch.realityCheck
            ? "Filled in what really happened"
            : action.patch.queue
              ? "Edited the plan"
              : action.patch.openTools
                ? "Reconsidering the plan"
                : "Edited the message draft"
      )

    case "case-set-path": {
      const task = state.tasks.find((item) => item.id === action.id)
      if (!task?.recoveryCase || task.recoveryCase.path === action.path) {
        return state
      }
      const next = updateCase(
        state,
        action.id,
        action.at,
        (recovery) => ({ ...recovery, path: action.path }),
        `Chose to ${action.path} this`
      )
      return mapTask(next, action.id, (item) =>
        withEvent(item, action.at, "recovery", `Chose to ${action.path} this`)
      )
    }

    case "case-answer-detail": {
      const text = action.text.trim()
      if (!text) return state
      return mapTask(state, action.id, (task) => {
        const recovery = task.recoveryCase
        if (!recovery) return task
        const input = `${recovery.originalInput} ${text}`
        return withEvent(
          {
            ...task,
            // A placeholder title gives way to the thing the user named.
            title: /^Something I/.test(task.title)
              ? text.length > 80
                ? `${text.slice(0, 77)}...`
                : text[0].toUpperCase() + text.slice(1)
              : task.title,
            recoveryCase: {
              ...recovery,
              originalInput: input,
              missingDetail: "",
              lastActivity: { at: action.at, text: "Added a detail" },
            },
          },
          action.at,
          "edited",
          `Added a detail: ${text}`
        )
      })
    }

    case "case-resume":
      return updateCase(state, action.id, action.at, (recovery) => ({
        ...recovery,
        resumedAt: action.at,
      }))

    case "case-pause": {
      const paused = mapTask(state, action.id, (task) =>
        setTaskStatus(task, "paused", action.at, "Paused on purpose")
      )
      return updateCase(
        paused,
        action.id,
        action.at,
        (recovery) => ({ ...recovery, pausedOnPurpose: true }),
        "Paused on purpose"
      )
    }
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
    plannedId: timer.plannedId,
    reported: false,
    endOutcome: null,
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
    // Real focus answers the question, so the block won't ask "Did it?" later.
    planned:
      timer.plannedId && !interrupted
        ? state.planned.map((item) =>
            item.id === timer.plannedId
              ? { ...item, done: true, outcome: "did" as const }
              : item
          )
        : state.planned,
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
