import { clearSession, loadSession } from "@/lib/session"
import type { Session } from "@/lib/session"
import { withEvent } from "@/lib/workspace/reducer"
import {
  DEFAULT_SETTINGS,
  EMPTY_WORKSPACE,
  FocusSessionSchema,
  PlannedSessionSchema,
  SettingsSchema,
  TaskSchema,
  TimerSchema,
} from "@/lib/workspace/schemas"
import type { Task, Workspace } from "@/lib/workspace/schemas"

const STORAGE_KEY = "backontrack.workspace.v1"

function validItems<T>(
  items: unknown,
  parse: (item: unknown) => { success: boolean; data?: T }
): T[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    const parsed = parse(item)
    return parsed.success ? [parsed.data as T] : []
  })
}

/** Reads saved data defensively. A damaged item is dropped; the rest survives. */
export function restoreWorkspace(raw: unknown): Workspace {
  if (!raw || typeof raw !== "object") return EMPTY_WORKSPACE
  const saved = raw as Record<string, unknown>
  if (saved.version !== 1) return EMPTY_WORKSPACE

  const skipped = saved.skipped as Workspace["skipped"] | undefined
  const timer = TimerSchema.safeParse(saved.timer)
  const settings = SettingsSchema.safeParse(saved.settings)
  const focusSessions = validItems(saved.focusSessions, (item) =>
    FocusSessionSchema.safeParse(item)
  )
  const finished =
    typeof saved.finishedSessionId === "string" &&
    focusSessions.some((item) => item.id === saved.finishedSessionId)

  return {
    version: 1,
    tasks: validItems(saved.tasks, (item) => TaskSchema.safeParse(item)),
    focusSessions,
    planned: validItems(saved.planned, (item) =>
      PlannedSessionSchema.safeParse(item)
    ),
    timer: timer.success ? timer.data : null,
    finishedSessionId: finished ? (saved.finishedSessionId as string) : null,
    settings: settings.success ? settings.data : DEFAULT_SETTINGS,
    skipped: Array.isArray(skipped?.taskIds)
      ? skipped
      : EMPTY_WORKSPACE.skipped,
    legacyMigrated: saved.legacyMigrated === true,
  }
}

/**
 * Turns a saved guided session from the earlier wizard into a task, keeping the
 * user's completed steps. Suggestions they never finished aren't marked done.
 */
export function taskFromSession(
  session: Session,
  id: string,
  at: string
): Task | null {
  const { intake, steps, current, strategy } = session
  const text = intake.responsibility.trim()
  if (!text) return null

  const deadline =
    intake.deadline?.type === "date" ? intake.deadline.date : null
  const completed = steps.filter((step) => step.outcome === "completed")
  let task: Task = withEvent(
    {
      id,
      title: text.length > 80 ? `${text.slice(0, 77)}...` : text,
      description: text,
      status: completed.length ? "in-progress" : "needs-recovery",
      priority: "medium",
      deadline,
      originalDeadline: deadline,
      progress: 0,
      nextAction: current?.action.instruction ?? "",
      subtasks: [],
      documents: [],
      history: [],
      createdAt: at,
      updatedAt: at,
      completedAt: null,
    },
    at,
    "created",
    "Created from a guided recovery session"
  )
  if (strategy) {
    task = withEvent(task, at, "recovery", `Chose strategy: ${strategy}`)
  }
  for (const step of steps) {
    const detail = step.userText ? ` (you wrote: "${step.userText}")` : ""
    task =
      step.outcome === "completed"
        ? withEvent(
            task,
            at,
            "action",
            `Completed: ${step.instruction}${detail}`
          )
        : withEvent(task, at, "recovery", `Tried: ${step.instruction}${detail}`)
    if (step.note) {
      task = withEvent(task, at, "obstacle", step.note)
    }
  }
  return task
}

export function loadWorkspace(): Workspace {
  let workspace = EMPTY_WORKSPACE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) workspace = restoreWorkspace(JSON.parse(raw))
  } catch {
    workspace = EMPTY_WORKSPACE
  }

  if (workspace.legacyMigrated) return workspace

  const session = loadSession()
  const migrated = taskFromSession(
    session,
    crypto.randomUUID(),
    new Date().toISOString()
  )
  return {
    ...workspace,
    tasks: migrated ? [...workspace.tasks, migrated] : workspace.tasks,
    settings: {
      ...workspace.settings,
      modePreference:
        workspace.settings.modePreference ?? session.modePreference,
    },
    legacyMigrated: true,
  }
}

export function saveWorkspace(workspace: Workspace) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
  } catch {
    // Storage may be full or blocked. The app still works for this visit.
  }
}

/** Deletes everything BackOnTrack saved in this browser. */
export function clearAllData() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
  clearSession()
}

export function exportWorkspace(workspace: Workspace) {
  return JSON.stringify(
    { app: "BackOnTrack", exportedAt: new Date().toISOString(), ...workspace },
    null,
    2
  )
}
