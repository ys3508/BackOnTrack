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

export const PRIORITIES = ["none", "low", "medium", "high"] as const
export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: "No priority",
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

/* ---------- Recovery cases ---------- */

export const BLOCKERS = [
  "dont-know-start",
  "cant-start",
  "worried",
  "behind",
] as const
export type Blocker = (typeof BLOCKERS)[number]

/** The user's own words for what's in the way. These are never diagnoses. */
export const BLOCKER_LABEL: Record<Blocker, string> = {
  "dont-know-start": "I don’t know where to start.",
  "cant-start": "I know what to do, but I can’t start.",
  worried: "I’m worried about what might happen.",
  behind: "I’m already behind, or my plan didn’t work.",
}

export const STUCK_REASONS = [
  "too-big",
  "dont-know-how",
  "worried",
  "low-energy",
  "not-viable",
  "other",
] as const
export type StuckReason = (typeof STUCK_REASONS)[number]

export const STUCK_LABEL: Record<StuckReason, string> = {
  "too-big": "The step feels too big.",
  "dont-know-how": "I don’t know how to do it.",
  worried: "I’m worried about the outcome.",
  "low-energy": "I don’t have enough time or energy.",
  "not-viable": "This plan won’t work anymore.",
  other: "Something else.",
}

export const RECOVERY_PATHS = ["finish", "reduce", "release"] as const
export type RecoveryPath = (typeof RECOVERY_PATHS)[number]

export const CASE_TOOLS = ["reality-gap", "paths"] as const
export type CaseTool = (typeof CASE_TOOLS)[number]

/** Where a suggestion came from, so a template is never presented as AI. */
export const ActionOrigin = z.enum(["live", "demo", "user"])
export type ActionOrigin = z.infer<typeof ActionOrigin>

export const CaseActionSchema = z.object({
  id: z.string(),
  text: z.string(),
  why: z.string().default(""),
  origin: ActionOrigin.default("demo"),
  createdAt: z.string(),
  /** When the user said they were beginning it. Starting isn't finishing. */
  startedAt: z.string().nullable().default(null),
})
export type CaseAction = z.infer<typeof CaseActionSchema>

export const RealityGapSchema = z.object({
  known: z.array(z.string()).default([]),
  worried: z.array(z.string()).default([]),
  unknown: z.array(z.string()).default([]),
  can: z.array(z.string()).default([]),
})
export type RealityGap = z.infer<typeof RealityGapSchema>

export const RealityCheckSchema = z.object({
  expected: z.string().default(""),
  happened: z.string().default(""),
  done: z.string().default(""),
  opportunity: z.enum(["yes", "no", "unsure"]).nullable().default(null),
  constraints: z.string().default(""),
})
export type RealityCheckAnswers = z.infer<typeof RealityCheckSchema>

export const CaseFeedbackSchema = z.object({
  kind: z.enum(["did-it", "stuck", "another"]),
  reason: z.enum(STUCK_REASONS).nullable().default(null),
  detail: z.string().default(""),
  at: z.string(),
})
export type CaseFeedback = z.infer<typeof CaseFeedbackSchema>

/**
 * The recovery work on one responsibility. It lives on the task, so the task's
 * status, deadline, document, timer, and history are never kept twice.
 */
export const RecoveryCaseSchema = z.object({
  originalInput: z.string(),
  blocker: z.enum(BLOCKERS).nullable().default(null),
  suggestedBlocker: z.enum(BLOCKERS).nullable().catch(null).default(null),
  current: CaseActionSchema.nullable().catch(null).default(null),
  /** Later steps, kept back so that only one is ever shown. */
  queue: z.array(z.string()).catch([]).default([]),
  /** Other ways in for "Try another approach". */
  alternatives: z.array(z.string()).catch([]).default([]),
  completed: z
    .array(z.object({ id: z.string(), text: z.string(), at: z.string() }))
    .catch([])
    .default([]),
  /** Suggestions that didn't get done. They're never offered again. */
  tried: z.array(z.string()).catch([]).default([]),
  realityGap: RealityGapSchema.nullable().catch(null).default(null),
  realityCheck: RealityCheckSchema.nullable().catch(null).default(null),
  path: z.enum(RECOVERY_PATHS).nullable().catch(null).default(null),
  messageDraft: z.string().catch("").default(""),
  /** Tools opened by a Plan B, on top of the ones for the current blocker. */
  openTools: z.array(z.enum(CASE_TOOLS)).catch([]).default([]),
  /** The one detail needed for a useful suggestion, and why it's being asked. */
  missingDetail: z.string().catch("").default(""),
  /** What changed after the last "I'm stuck", in plain words. */
  adaptationNote: z.string().catch("").default(""),
  lastFeedback: CaseFeedbackSchema.nullable().catch(null).default(null),
  lastActivity: z
    .object({ at: z.string(), text: z.string() })
    .nullable()
    .catch(null)
    .default(null),
  /** When the user last chose how to come back, so they're asked only once. */
  resumedAt: z.string().nullable().catch(null).default(null),
  /** True when the user chose to stop for now on purpose. */
  pausedOnPurpose: z.boolean().catch(false).default(false),
})
export type RecoveryCase = z.infer<typeof RecoveryCaseSchema>

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().default(""),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES).default("none"),
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
  /** The user's rough guess at the whole task, in minutes. Optional. */
  estimateMinutes: z.number().positive().nullable().catch(null).default(null),
  /** "What will you do first?" Optional, and the user's own words. */
  firstStep: z.string().catch("").default(""),
  /** Where to pick up next time. It comes before the first step when present. */
  resumeNote: z.string().catch("").default(""),
  /** A web address that opens the work directly. */
  link: z.string().catch("").default(""),
  /** The smaller version that still counts, which is not the whole task. */
  minimumVersion: z.string().catch("").default(""),
  /** Present when this responsibility is being worked on in Recovery. */
  recoveryCase: RecoveryCaseSchema.nullable().catch(null).default(null),
  /** A simple errand from the home page, which needs no recovery workflow. */
  quick: z.boolean().catch(false).default(false),
  /** The user-chosen visual theme shared by Today, Calendar, and Focus. */
  focusTheme: z
    .enum([
      "coral-bloom",
      "blue-daydream",
      "citrus-glow",
      "mint-garden",
      "lavender-haze",
      "pink-sunrise",
    ])
    .nullable()
    .catch(null)
    .default(null),
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
  /** The planned session this came from, if any. */
  plannedId: z.string().nullable().catch(null).default(null),
  /** True when the user said it happened, rather than a timer measuring it. */
  reported: z.boolean().catch(false).default(false),
  /** What the user said came of it, once they said. */
  endOutcome: z
    .enum(["progress", "minimum", "completed"])
    .nullable()
    .catch(null)
    .default(null),
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
  /** The user's answer once its time has gone by. "did" became focus time. */
  outcome: z.enum(["did", "didnt"]).nullable().catch(null).default(null),
  /** A part of the day instead of an exact time. Only when time is null. */
  window: z
    .enum(["morning", "afternoon", "evening"])
    .nullable()
    .catch(null)
    .default(null),
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
  /** The planned session this timer is carrying out, if any. */
  plannedId: z.string().nullable().catch(null).default(null),
})
export type TimerState = z.infer<typeof TimerSchema>

export const SettingsSchema = z.object({
  modePreference: z.enum(["live", "demo"]).nullable().default(null),
  defaultFocusMinutes: z
    .union([z.literal(5), z.literal(10), z.literal(25)])
    .default(5),
  homeListSize: z.union([z.literal(3), z.literal(5)]).default(3),
  /** The length last chosen on the calendar, used as the next default. */
  lastSessionMinutes: z
    .number()
    .positive()
    .nullable()
    .catch(null)
    .default(null),
  /** Time kept free each day for catching up. */
  bufferCount: z.number().int().min(0).max(4).catch(1).default(1),
  bufferMinutes: z.number().positive().catch(30).default(30),
  /** Space to leave after a work block when placing the next one. 0 is off. */
  bufferGapMinutes: z.number().min(0).catch(0).default(0),
  /** Off until the user chooses, after being told what they can and can't do. */
  remindersEnabled: z.boolean().catch(false).default(false),
  /** The one-time note that everything is saved in this browser. */
  storageNoticeSeen: z.boolean().catch(false).default(false),
})
export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  modePreference: null,
  defaultFocusMinutes: 5,
  homeListSize: 3,
  lastSessionMinutes: null,
  bufferCount: 1,
  bufferMinutes: 30,
  bufferGapMinutes: 0,
  remindersEnabled: false,
  storageNoticeSeen: false,
}

export const ESTIMATE_OPTIONS = [5, 15, 30, 60, 120, 240]

export const estimateLabel = (minutes: number) =>
  minutes < 60
    ? `About ${minutes} min`
    : `About ${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`

export const DailyPlanItemSchema = z.object({
  taskId: z.string(),
  subtaskId: z.string().nullable().default(null),
  title: z.string(),
  action: z.string(),
  minutes: z.number(),
  reason: z.string().default(""),
  done: z.boolean().default(false),
})
export type DailyPlanItem = z.infer<typeof DailyPlanItemSchema>

/** Recurs by an iCal rule. Routines never count streaks. */
export const RoutineSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  color: z.string(),
  emoji: z.string().default(""),
  /** DTSTART and RRULE in local time, with no time zone. */
  rrule: z.string(),
  /** Length in minutes. */
  duration: z.number().positive(),
  /** Dates whose occurrence was moved elsewhere. */
  exdates: z.array(z.string()).catch([]).default([]),
  /** Dates whose regular occurrence the user marked done. */
  doneDates: z.array(z.string()).catch([]).default([]),
  /** Fixed happens at a time. Flexible can happen any time on the day. */
  kind: z.enum(["fixed", "flexible"]).catch("fixed").default("fixed"),
  /** A smaller alternative. Doing it isn't the same as doing the full one. */
  minimumVersion: z.string().catch("").default(""),
  /** Dates done in the smaller version. */
  minimumDates: z.array(z.string()).catch([]).default([]),
  /** Dates the user chose to skip. */
  skippedDates: z.array(z.string()).catch([]).default([]),
  /** Earlier versions, so "All future" never rewrites past weeks. */
  priorRules: z
    .array(z.object({ rrule: z.string(), duration: z.number().positive() }))
    .catch([])
    .default([]),
  createdAt: z.string(),
})
export type Routine = z.infer<typeof RoutineSchema>

/** A one-off occurrence: dragged from the sidebar, or moved from its usual time. */
export const RoutinePlacementSchema = z.object({
  id: z.string(),
  routineId: z.string(),
  date: DateString,
  time: z.string(),
  done: z.boolean().default(false),
  /** Its own length, when this one differs from the routine. */
  minutes: z.number().positive().nullable().catch(null).default(null),
  /** True when this replaces a regular occurrence, or was changed by hand. */
  adjusted: z.boolean().catch(false).default(false),
  /** What came of it. "full" is the same as done. */
  result: z
    .enum(["full", "minimum", "skipped"])
    .nullable()
    .catch(null)
    .default(null),
})
export type RoutinePlacement = z.infer<typeof RoutinePlacementSchema>

export const PROGRESS_EVENT_TYPES = [
  "started",
  "minimum_met",
  "completed",
  "restarted",
  "recovery_shown",
  "recovery_action_taken",
] as const

/** A moment of real progress, kept apart from any task's or session's status. */
export const ProgressEventSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: z.enum(PROGRESS_EVENT_TYPES),
  at: z.string(),
  sessionId: z.string().nullable().default(null),
})
export type ProgressEvent = z.infer<typeof ProgressEventSchema>

export const RECOVERY_REASONS = [
  "cant-start",
  "dont-know-start",
  "worried",
  "no-time",
] as const
export type RecoveryReason = (typeof RECOVERY_REASONS)[number]

export const RECOVERY_REASON_LABEL: Record<RecoveryReason, string> = {
  "cant-start": "I know what to do, but I can’t start",
  "dont-know-start": "I don’t know where to begin",
  worried: "I’m worried about the outcome or someone’s reaction",
  "no-time": "I don’t have enough time anymore",
}

/** Each reason opens the tools that fit, using the existing recovery engine. */
export const REASON_BLOCKER: Record<RecoveryReason, Blocker> = {
  "cant-start": "cant-start",
  "dont-know-start": "dont-know-start",
  worried: "worried",
  "no-time": "behind",
}

/** Someone working through recovery, kept so a reload lands in the same place. */
export const RecoverySchema = z.object({
  /** Null while choosing what they've been avoiding. */
  taskId: z.string().nullable(),
  plannedId: z.string().nullable().default(null),
  source: z.enum(["scheduled", "avoidance"]),
  reason: z.enum(RECOVERY_REASONS).nullable().default(null),
  enteredAt: z.string(),
})
export type Recovery = z.infer<typeof RecoverySchema>

/** A stray thought caught during a session, so it can wait without being lost. */
export const ParkedThoughtSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  taskId: z.string().nullable().default(null),
  at: z.string(),
})
export type ParkedThought = z.infer<typeof ParkedThoughtSchema>

export const ENERGY_LEVELS = ["low", "okay", "good"] as const
export type Energy = (typeof ENERGY_LEVELS)[number]

export const DailyPlanSchema = z.object({
  date: z.string(),
  minutes: z.number(),
  energy: z.enum(ENERGY_LEVELS).nullable().default(null),
  items: z.array(DailyPlanItemSchema),
  createdAt: z.string(),
})
export type DailyPlan = z.infer<typeof DailyPlanSchema>

export const HELP_KINDS = [
  "prepared",
  "outline",
  "draft",
  "checklist",
  "code",
  "smaller-steps",
  "recovery-plan",
] as const
export type HelpKind = (typeof HELP_KINDS)[number]

export const HELP_LABEL: Record<HelpKind, string> = {
  prepared: "A prepared document",
  outline: "An outline",
  draft: "A rough draft to edit",
  checklist: "A checklist",
  code: "A code starting point",
  "smaller-steps": "Smaller steps",
  "recovery-plan": "A recovery plan",
}

export type TaskKind = "writing" | "code" | "other"

/** One moment that shows whether work is moving. Never holds the user's text. */
export const FrictionEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: z.enum(["stuck", "session", "moved", "help"]),
  taskId: z.string(),
  taskKind: z.enum(["writing", "code", "other"]),
  blankDoc: z.boolean(),
  interrupted: z.boolean().default(false),
  helpKind: z.enum(HELP_KINDS).nullable().default(null),
  /** The user's own word count when help was accepted. */
  baselineWords: z.number().default(0),
  outcome: z.enum(["progress", "stuck"]).nullable().default(null),
})
export type FrictionEvent = z.infer<typeof FrictionEventSchema>

export const LearningSchema = z.object({
  enabled: z.boolean().default(true),
  dismissed: z.array(z.string()).default([]),
  preferred: z.enum(HELP_KINDS).nullable().default(null),
})
export type Learning = z.infer<typeof LearningSchema>

export const DEFAULT_LEARNING: Learning = {
  enabled: true,
  dismissed: [],
  preferred: null,
}

/** Under a minute and stopped early: an interrupted attempt, not focus time. */
export const INTERRUPTED_UNDER_SECONDS = 60

export function isInterrupted(session: FocusSession) {
  return (
    session.outcome !== "completed" &&
    session.actualSeconds < INTERRUPTED_UNDER_SECONDS
  )
}

export function isFocusTime(session: FocusSession) {
  return !isInterrupted(session)
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
  /** When the app was last opened, kept only in this browser. */
  lastOpenedAt: string | null
  frictionLog: FrictionEvent[]
  learning: Learning
  dailyPlan: DailyPlan | null
  /** What's typed on the home page, kept until it's submitted. */
  intakeDraft: string
  routines: Routine[]
  routinePlacements: RoutinePlacement[]
  parkingLot: ParkedThought[]
  progressEvents: ProgressEvent[]
  recovery: Recovery | null
  /** Which blocks have reminded, so a reload never repeats one. */
  remindedBlocks: string[]
}

export const EMPTY_WORKSPACE: Workspace = {
  intakeDraft: "",
  routines: [],
  routinePlacements: [],
  parkingLot: [],
  progressEvents: [],
  recovery: null,
  remindedBlocks: [],
  version: 2,
  tasks: [],
  focusSessions: [],
  planned: [],
  timer: null,
  finishedSessionId: null,
  settings: DEFAULT_SETTINGS,
  skipped: { date: "", taskIds: [] },
  legacyMigrated: false,
  lastOpenedAt: null,
  frictionLog: [],
  learning: DEFAULT_LEARNING,
  dailyPlan: null,
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
