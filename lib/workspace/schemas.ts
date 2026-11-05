import { z } from "zod"

import { isCalendarDate } from "@/lib/schemas"

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
  ]),
  text: z.string(),
})
export type TaskEvent = z.infer<typeof TaskEventSchema>

export const SubtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
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

export type Workspace = {
  version: 1
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
  version: 1,
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
