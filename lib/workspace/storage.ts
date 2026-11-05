import { clearSession, loadSession } from "@/lib/session"
import type { Session } from "@/lib/session"
import { inferEventKind, withEvent } from "@/lib/workspace/reducer"
import {
  DEFAULT_SETTINGS,
  EMPTY_WORKSPACE,
  FocusSessionSchema,
  PlannedSessionSchema,
  SettingsSchema,
  TaskSchema,
  TimerSchema,
  WORKSPACE_VERSION,
  DEFAULT_LEARNING,
  FrictionEventSchema,
  LearningSchema,
  DailyPlanSchema,
} from "@/lib/workspace/schemas"
import type { Task, Workspace } from "@/lib/workspace/schemas"

const STORAGE_KEY = "backontrack.workspace.v1"
const BACKUP_KEY = "backontrack.workspace.backup"

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
  if (saved.version !== 1 && saved.version !== WORKSPACE_VERSION) {
    return EMPTY_WORKSPACE
  }

  const skipped = saved.skipped as Workspace["skipped"] | undefined
  const timer = TimerSchema.safeParse(saved.timer)
  const settings = SettingsSchema.safeParse(saved.settings)
  const learning = LearningSchema.safeParse(saved.learning)
  const dailyPlan = DailyPlanSchema.safeParse(saved.dailyPlan)
  const focusSessions = validItems(saved.focusSessions, (item) =>
    FocusSessionSchema.safeParse(item)
  )
  const finished =
    typeof saved.finishedSessionId === "string" &&
    focusSessions.some((item) => item.id === saved.finishedSessionId)

  const tasks = validItems<Task>(saved.tasks, (item) =>
    TaskSchema.safeParse(item)
  )

  return {
    version: WORKSPACE_VERSION,
    // Version 1 events had no kind, so it's worked out from what they recorded.
    tasks:
      saved.version === 1
        ? tasks.map((task) => ({
            ...task,
            history: task.history.map((event) => ({
              ...event,
              kind: inferEventKind(event.type, event.text),
            })),
          }))
        : tasks,
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
    lastOpenedAt:
      typeof saved.lastOpenedAt === "string" ? saved.lastOpenedAt : null,
    frictionLog: validItems(saved.frictionLog, (item) =>
      FrictionEventSchema.safeParse(item)
    ),
    learning: learning.success ? learning.data : DEFAULT_LEARNING,
    dailyPlan: dailyPlan.success ? dailyPlan.data : null,
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
      priority: "none",
      deadline,
      originalDeadline: deadline,
      progress: 0,
      nextAction: current?.action.instruction ?? "",
      subtasks: [],
      documents: [],
      history: [],
      estimateMinutes: null,
      createdAt: at,
      updatedAt: at,
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

function needsBackup(raw: string) {
  const version = (JSON.parse(raw) as { version?: unknown }).version
  return version !== WORKSPACE_VERSION
}

function backUp(raw: string) {
  try {
    window.localStorage.setItem(BACKUP_KEY, raw)
  } catch {
    // Storage is full, so the original data is left in place until a save.
  }
}

export function loadWorkspace(): Workspace {
  let workspace = EMPTY_WORKSPACE
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) workspace = restoreWorkspace(JSON.parse(raw))
    // Keeps a copy before migrating, or if the data can't be understood.
    if (raw && needsBackup(raw)) backUp(raw)
  } catch {
    if (raw) backUp(raw)
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

/** Returns false if the browser refused to save, so the user can be told. */
export function saveWorkspace(workspace: Workspace) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
    return true
  } catch {
    return false
  }
}

/** Browsers usually allow about 5 MB per site for localStorage. */
export const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024

export function storageUsedBytes() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? ""
    return new Blob([raw]).size
  } catch {
    return 0
  }
}

/** Reads an exported file. Returns null if it isn't BackOnTrack data. */
export function parseImport(text: string): Workspace | null {
  try {
    const parsed = JSON.parse(text) as { app?: unknown }
    if (parsed.app !== "BackOnTrack") return null
    return { ...restoreWorkspace(parsed), timer: null, legacyMigrated: true }
  } catch {
    return null
  }
}

/** Deletes everything BackOnTrack saved in this browser. */
export function clearAllData() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(BACKUP_KEY)
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
