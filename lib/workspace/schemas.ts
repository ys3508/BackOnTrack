import { z } from "zod"

import {
  AnalysisSchema,
  RecoveryPlanSchema,
  RejectedPlanSchema,
  StrategySchema,
  isCalendarDate,
} from "@/lib/schemas"

const DateString = z.string().refine(isCalendarDate)

export const TASK_STATUSES = [
  "not-started",
  "in-progress",
  "paused",
  "needs-recovery",
  "completed",
  "released",
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const STATUS_LABEL: Record<TaskStatus, string> = {
  "not-started": "Not Started",
  "in-progress": "In Progress",
  paused: "Paused",
  "needs-recovery": "Needs Recovery",
  completed: "Completed",
  released: "Released",
}

export const PRIORITIES = ["low", "medium", "high"] as const
export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
}

export const TaskEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  type: z.enum([
    "created",
    "edited",
    "status",
    "deadline",
    "progress",
    "action",
    "subtask",
    "document",
    "focus",
    "schedule",
    "obstacle",
    "recovery",
    "breakdown",
    "stuck",
    "instructions",
  ]),
  text: z.string(),
  /** Separates a suggestion from something accepted, tried, or really finished. */
  kind: z
    .enum(["info", "suggested", "accepted", "attempted", "completed"])
    .default("info"),
})
export type TaskEvent = z.infer<typeof TaskEventSchema>

export const SubtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  source: z.enum(["user", "live", "demo"]).default("user"),
  completedAt: z.string().nullable().default(null),
})
export type Subtask = z.infer<typeof SubtaskSchema>

export const TaskDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  source: z.enum(["user", "live", "demo"]),
  updatedAt: z.string(),
})
export type TaskDocument = z.infer<typeof TaskDocumentSchema>

/** The task's rich-text document, stored as sanitized editor HTML. */
export const WorkDocSchema = z.object({
  content: z.string(),
  updatedAt: z.string(),
  /** Where the cursor was, so returning can continue from the same place. */
  cursor: z.number().default(0),
  /** The version from before the last accepted AI suggestion. */
  previous: z.string().nullable().default(null),
})
export type WorkDoc = z.infer<typeof WorkDocSchema>

export const InstructionsSchema = z.object({
  text: z.string(),
  sourceName: z.string().default(""),
  kind: z.enum(["paste", "file"]).default("paste"),
  truncated: z.boolean().default(false),
  addedAt: z.string(),
})
export type Instructions = z.infer<typeof InstructionsSchema>

/** A suggested breakdown. These aren't task steps until the user accepts them. */
export const PendingBreakdownSchema = z.object({
  steps: z.array(z.string()),
  note: z.string().default(""),
  ambiguities: z.array(z.string()).default([]),
  source: z.enum(["live", "demo"]),
  usedFallback: z.boolean().default(false),
  createdAt: z.string(),
})
export type PendingBreakdown = z.infer<typeof PendingBreakdownSchema>

export const RecoveryAttemptSchema = z.object({
  id: z.string(),
  at: z.string(),
  subtaskId: z.string().nullable().default(null),
  obstacle: z.string().default(""),
  suggestion: z.string(),
  source: z.enum(["live", "demo"]),
  outcome: z.enum(["suggested", "accepted", "declined"]),
})
export type RecoveryAttempt = z.infer<typeof RecoveryAttemptSchema>

/** A recovery plan waiting for the user's decision. Nothing is applied yet. */
export const StoredRecoverySchema = z.object({
  analysis: AnalysisSchema,
  plan: RecoveryPlanSchema,
  strategy: StrategySchema.nullable(),
  source: z.enum(["live", "demo"]),
  usedFallback: z.boolean().default(false),
  exhausted: z.boolean().default(false),
  createdAt: z.string(),
})
export type StoredRecovery = z.infer<typeof StoredRecoverySchema>

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().default(""),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES).default("medium"),
  deadline: DateString.nullable().default(null),
  /** The first deadline ever set. Rescheduling work never changes it. */
  originalDeadline: DateString.nullable().default(null),
  progress: z.number().min(0).max(100).default(0),
  nextAction: z.string().default(""),
  subtasks: z.array(SubtaskSchema).default([]),
  documents: z.array(TaskDocumentSchema).default([]),
  history: z.array(TaskEventSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().default(null),
  recovery: StoredRecoverySchema.nullable().catch(null).default(null),
  rejectedPlans: z.array(RejectedPlanSchema).catch([]).default([]),
  workDoc: WorkDocSchema.nullable().catch(null).default(null),
  instructions: InstructionsSchema.nullable().catch(null).default(null),
  /** When the user agreed to send this task's documents to the AI provider. */
  aiConsentAt: z.string().nullable().catch(null).default(null),
  pendingBreakdown: PendingBreakdownSchema.nullable().catch(null).default(null),
  currentSubtaskId: z.string().nullable().catch(null).default(null),
  lastWorkedAt: z.string().nullable().catch(null).default(null),
  recoveryAttempts: z.array(RecoveryAttemptSchema).catch([]).default([]),
})
export type Task = z.infer<typeof TaskSchema>

export const FocusSessionSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  taskTitle: z.string(),
  plannedMinutes: z.number(),
  actualSeconds: z.number(),
  startedAt: z.string(),
  endedAt: z.string(),
  outcome: z.enum(["completed", "continue-later", "stuck"]),
  note: z.string().default(""),
  subtaskId: z.string().nullable().default(null),
  /** The user's own answer. Elapsed time alone is never treated as progress. */
  progressReport: z.enum(["yes", "a-little", "stuck"]).nullable().default(null),
})
export type FocusSession = z.infer<typeof FocusSessionSchema>

export const PlannedSessionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  date: DateString,
  /** Local time as HH:MM, or null for any time that day. */
  time: z.string().nullable().default(null),
  minutes: z.number(),
  label: z.string().default(""),
  done: z.boolean().default(false),
})
export type PlannedSession = z.infer<typeof PlannedSessionSchema>

export const TimerSchema = z.object({
  id: z.string(),
  kind: z.enum(["focus", "break"]),
  taskId: z.string().nullable(),
  subtaskId: z.string().nullable().default(null),
  plannedSeconds: z.number(),
  startedAt: z.string(),
  /** Wall-clock milliseconds when it last started running, or null if paused. */
  runningSince: z.number().nullable(),
  /** Milliseconds counted before the current run. */
  accumulatedMs: z.number(),
})
export type TimerState = z.infer<typeof TimerSchema>

export const SettingsSchema = z.object({
  modePreference: z.enum(["live", "demo"]).nullable().default(null),
  defaultFocusMinutes: z
    .union([z.literal(5), z.literal(10), z.literal(25)])
    .default(5),
  homeListSize: z.union([z.literal(3), z.literal(5)]).default(3),
})
export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  modePreference: null,
  defaultFocusMinutes: 5,
  homeListSize: 3,
}

export const WORKSPACE_VERSION = 2

export type Workspace = {
  version: 2
  tasks: Task[]
  focusSessions: FocusSession[]
  planned: PlannedSession[]
  timer: TimerState | null
  /** A focus session that just ended and hasn't been acknowledged yet. */
  finishedSessionId: string | null
  settings: Settings
  /** Tasks set aside from the home recommendation for one day. */
  skipped: { date: string; taskIds: string[] }
  legacyMigrated: boolean
}

export const EMPTY_WORKSPACE: Workspace = {
  version: 2,
  tasks: [],
  focusSessions: [],
  planned: [],
  timer: null,
  finishedSessionId: null,
  settings: DEFAULT_SETTINGS,
  skipped: { date: "", taskIds: [] },
  legacyMigrated: false,
}

export const ACTIVE_STATUSES: TaskStatus[] = [
  "not-started",
  "in-progress",
  "paused",
  "needs-recovery",
]

export function isActive(task: Task) {
  return ACTIVE_STATUSES.includes(task.status)
}
