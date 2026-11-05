import { z } from "zod"

export const LIMITS = {
  contextInstructions: 12000,
  contextDocument: 8000,
  responsibility: 2000,
  detail: 300,
  legacyNotes: 700,
  stepText: 1000,
  note: 500,
  history: 30,
  listItem: 400,
} as const

/* ---------- User input ---------- */

/** True for a real calendar date written as YYYY-MM-DD. */
export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/**
 * Optional answers are `null` until the user gives one. "No deadline" and
 * "I'm not sure" are real answers, so they are stored separately from `null`.
 */
const DeadlineSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("date"),
    date: z.string().refine(isCalendarDate, "Please choose a valid date."),
  }),
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("unsure") }),
])
export type Deadline = z.infer<typeof DeadlineSchema>

export const STATUS_CHOICES = [
  "not-started",
  "started-stopped",
  "missed-deadline",
  "unsure",
] as const
export type StatusChoice = (typeof STATUS_CHOICES)[number]

export const OBSTACLE_CHOICES = [
  "overwhelming",
  "where-to-start",
  "worried-outcome",
  "no-energy",
  "unsure",
  "something-else",
] as const
export type ObstacleChoice = (typeof OBSTACLE_CHOICES)[number]

export const IntakeSchema = z.object({
  responsibility: z
    .string()
    .trim()
    .min(3, "Please add a few words.")
    .max(
      LIMITS.responsibility,
      `Please keep this under ${LIMITS.responsibility} characters.`
    )
    .refine((value) => /\p{L}/u.test(value), "Please add a few words."),
  deadline: DeadlineSchema.nullable().default(null),
  status: z.enum(STATUS_CHOICES).nullable().default(null),
  obstacle: z.enum(OBSTACLE_CHOICES).nullable().default(null),
  obstacleOther: z.string().trim().max(LIMITS.detail).default(""),
  /** Free-text details from sessions saved before the clickable options. */
  legacyNotes: z.string().trim().max(LIMITS.legacyNotes).default(""),
})
export type Intake = z.infer<typeof IntakeSchema>

/* ---------- Shared vocabulary ---------- */

export const STRATEGIES = ["FINISH", "REDUCE", "RELEASE"] as const
export const StrategySchema = z.enum(STRATEGIES)
export type Strategy = z.infer<typeof StrategySchema>

export const APPROACHES = [
  "recall-from-memory",
  "write-in-app",
  "gather-information",
  "ask-someone",
  "shrink-scope",
  "decide",
  "name-the-obstacle",
] as const
export const ApproachSchema = z.enum(APPROACHES)
export type Approach = z.infer<typeof ApproachSchema>

/* ---------- What the model must return ----------
 * These schemas deliberately carry no length or array-size constraints:
 * provider JSON-schema modes reject some of those keywords. Bounds are enforced
 * afterwards by the normalize* functions in lib/guards.ts.
 */

export const AnalysisSchema = z.object({
  acknowledgement: z
    .string()
    .describe("One plain, non-judgmental sentence reflecting the situation."),
  realityCheck: z.object({
    knownFacts: z
      .array(z.string())
      .describe("Only what the user explicitly stated."),
    assumptions: z
      .array(z.string())
      .describe("Interpretations or predictions that are not verified."),
    unknowns: z
      .array(z.string())
      .describe("Information needed for a confident decision."),
    consequences: z.array(
      z.object({
        text: z.string(),
        status: z.enum(["confirmed", "uncertain"]),
      })
    ),
  }),
  decision: z.object({
    recommended: StrategySchema,
    reasoning: z.string().describe("Why this fits what the user told you."),
    uncertainty: z.string().describe("What could change this recommendation."),
    options: z
      .object({
        FINISH: z.string(),
        REDUCE: z.string(),
        RELEASE: z.string(),
      })
      .describe("What each path would concretely mean in this situation."),
    highStakes: z
      .boolean()
      .describe("True for legal, financial, medical or academic obligations."),
    caution: z
      .string()
      .describe("Caution about releasing; empty if not high stakes."),
  }),
  supportConcern: z
    .boolean()
    .describe("True if the user mentions self-harm or being in crisis."),
})
export type Analysis = z.infer<typeof AnalysisSchema>

export const ActionStepSchema = z.object({
  instruction: z
    .string()
    .describe("Exactly one concrete action, ideally doable in the text box."),
  why: z.string().describe("One sentence on why this step, right now."),
  inputLabel: z.string().describe("Short label for the text box."),
  inputPlaceholder: z.string(),
  minutes: z.number().describe("Honest estimate in minutes, usually 1 to 5."),
  approach: ApproachSchema,
})
export type ActionStep = z.infer<typeof ActionStepSchema>

export const NextStepOutputSchema = z.object({
  action: ActionStepSchema,
  adaptationNote: z
    .string()
    .describe("One sentence on what changed and why; empty on the first step."),
  suggestWrapUp: z
    .boolean()
    .describe("True if this is a reasonable place to stop for today."),
})
export type NextStepOutput = z.infer<typeof NextStepOutputSchema>

/* ---------- API requests ---------- */

export const StepOutcomeSchema = z.enum(["completed", "stuck", "changed"])
export type StepOutcome = z.infer<typeof StepOutcomeSchema>

export const StepEventSchema = z.enum(["start", "completed", "stuck", "change"])
export type StepEvent = z.infer<typeof StepEventSchema>

const HistoryEntrySchema = z.object({
  instruction: z.string().max(LIMITS.stepText),
  approach: ApproachSchema,
  outcome: StepOutcomeSchema,
  userText: z.string().max(LIMITS.stepText),
  note: z.string().max(LIMITS.note),
})
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>

export const AnalyzeRequestSchema = z.object({
  stage: z.literal("analyze"),
  intake: IntakeSchema,
})

export const NextStepRequestSchema = z.object({
  stage: z.literal("next-step"),
  intake: IntakeSchema,
  knownFacts: z.array(z.string().max(LIMITS.listItem)).max(10),
  unknowns: z.array(z.string().max(LIMITS.listItem)).max(10),
  strategy: StrategySchema,
  event: StepEventSchema,
  note: z.string().trim().max(LIMITS.note).default(""),
  history: z.array(HistoryEntrySchema).max(LIMITS.history),
})
export type NextStepRequest = z.infer<typeof NextStepRequestSchema>

/* ---------- API responses ---------- */

/** `action: null` means there is nothing further to suggest right now. */
export type NextStepResult = {
  action: ActionStep | null
  adaptationNote: string
  suggestWrapUp: boolean
  /** True when the server replaced a repeated suggestion with a built-in step. */
  usedFallback?: boolean
}

/* ---------- Task recovery ---------- */

export const ARTIFACT_KINDS = [
  "email",
  "plan",
  "outline",
  "schedule",
  "checklist",
  "note",
  "code",
] as const

/** No length or size limits here, for the same reason as the schemas above. */
export const RecoveryPlanSchema = z.object({
  headline: z.string().describe("A short, concrete title for this plan."),
  adaptationNote: z
    .string()
    .describe("One sentence on what changed from earlier attempts, or empty."),
  nextStep: z.object({
    instruction: z
      .string()
      .describe("One concrete action that produces something tangible."),
    why: z.string(),
    minutes: z.number(),
    approach: ApproachSchema,
  }),
  artifact: z.object({
    kind: z.enum(ARTIFACT_KINDS),
    title: z.string(),
    body: z
      .string()
      .describe("A usable draft. Use [brackets] for details you don't have."),
  }),
  steps: z.array(z.string()).describe("Up to 6 small, concrete steps."),
  smallerSteps: z
    .array(z.string())
    .describe(
      "If the current step is too big, 2 to 5 smaller steps to replace it. Otherwise empty."
    ),
  choices: z
    .array(z.string())
    .describe(
      "Up to 3 short options the user can insert into their document, such as opening sentences. Empty if not useful."
    ),
  schedule: z
    .array(
      z.object({
        date: z.string().describe("YYYY-MM-DD, today or later."),
        minutes: z.number(),
        label: z.string(),
      })
    )
    .describe("Up to 4 optional work sessions."),
})
export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>

export const TaskRecoveryOutputSchema = AnalysisSchema.extend({
  plan: RecoveryPlanSchema,
})

const shortText = z.string().max(LIMITS.listItem)

export const TaskContextSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(LIMITS.responsibility),
  deadline: z.string().refine(isCalendarDate).nullable(),
  originalDeadline: z.string().refine(isCalendarDate).nullable(),
  status: z.string().max(40),
  priority: z.string().max(20),
  progress: z.number().min(0).max(100),
  completedActions: z.array(shortText).max(15),
  attempts: z.array(shortText).max(15),
  obstacles: z.array(shortText).max(10),
  openSteps: z.array(shortText).max(15),
  /** Task instructions the user provided, shortened to a safe length. */
  instructions: z.string().max(LIMITS.contextInstructions).default(""),
  /** Plain text from the working document, shortened to a safe length. */
  document: z.string().max(LIMITS.contextDocument).default(""),
  currentStep: shortText.default(""),
  /** How many recovery plans have already been tried on the current step. */
  stuckOnStep: z.number().min(0).default(0),
  focusSessions: z
    .array(
      z.object({
        date: z.string().max(10),
        plannedMinutes: z.number(),
        actualMinutes: z.number(),
        outcome: z.enum(["completed", "continue-later", "stuck"]),
        note: shortText,
      })
    )
    .max(10),
})
export type TaskContext = z.infer<typeof TaskContextSchema>

export const RejectedPlanSchema = z.object({
  nextStep: shortText,
  artifactTitle: shortText,
})
export type RejectedPlan = z.infer<typeof RejectedPlanSchema>

export const TaskRecoveryRequestSchema = z.object({
  stage: z.literal("task-recovery"),
  task: TaskContextSchema,
  today: z.string().refine(isCalendarDate),
  strategy: StrategySchema.nullable(),
  obstacle: z.string().trim().max(LIMITS.note).default(""),
  rejected: z.array(RejectedPlanSchema).max(10),
})
export type TaskRecoveryRequest = z.infer<typeof TaskRecoveryRequestSchema>

export type TaskRecoveryResult = {
  analysis: Analysis
  plan: RecoveryPlan
  /** The AI kept repeating itself, so a built-in template was used instead. */
  usedFallback?: boolean
  /** Demo Mode has no further templates to offer for this task. */
  exhausted?: boolean
}

/* ---------- Task breakdown ---------- */

export const TaskBreakdownOutputSchema = z.object({
  note: z.string().describe("One short sentence about the plan, or empty."),
  steps: z
    .array(z.string())
    .describe("3 to 8 concrete steps, not repeating finished ones."),
  ambiguities: z
    .array(z.string())
    .describe("Unclear requirements worth asking about. Empty if none."),
})
export type TaskBreakdownOutput = z.infer<typeof TaskBreakdownOutputSchema>

export const TaskBreakdownRequestSchema = z.object({
  stage: z.literal("task-breakdown"),
  task: TaskContextSchema,
  today: z.string().refine(isCalendarDate),
  rejected: z.array(z.array(shortText).max(10)).max(3).default([]),
})
export type TaskBreakdownRequest = z.infer<typeof TaskBreakdownRequestSchema>

export type TaskBreakdownResult = TaskBreakdownOutput & {
  usedFallback?: boolean
}

/* ---------- Starting work ---------- */

const StarterSchema = z.object({
  kind: z.enum(["outline", "draft", "code", "checklist"]),
  title: z.string(),
  content: z
    .string()
    .describe(
      "Markdown to start from. Use fenced code for code, and [brackets] for anything unknown."
    ),
})

export const StepHelpOutputSchema = z.object({
  firstAction: z
    .string()
    .describe(
      "One physical action for the next few minutes, like 'Open the dataset and identify the target column'."
    ),
  why: z.string(),
  starter: StarterSchema,
  smallerSteps: z
    .array(z.string())
    .describe("2 to 5 smaller steps that could replace this step."),
  note: z.string().describe("A short caveat, or empty."),
})
export type StepHelpOutput = z.infer<typeof StepHelpOutputSchema>
export type StepHelpResult = StepHelpOutput & { usedFallback?: boolean }

export const StepHelpRequestSchema = z.object({
  stage: z.literal("step-help"),
  task: TaskContextSchema,
  today: z.string().refine(isCalendarDate),
  step: shortText,
})
export type StepHelpRequest = z.infer<typeof StepHelpRequestSchema>

export const WorkspaceSetupOutputSchema = z.object({
  summary: z.string().describe("One short sentence on what this task is."),
  deliverables: z
    .array(z.string())
    .describe("What has to be handed in, from the instructions only."),
  datesMentioned: z
    .array(z.string())
    .describe(
      "Dates exactly as written in the instructions. Never invent one."
    ),
  dependencies: z
    .array(z.string())
    .describe("What the work relies on, such as a provided dataset."),
  unclear: z
    .array(z.string())
    .describe("Questions worth asking. Can be empty."),
  steps: z.array(z.string()).describe("3 to 8 small, concrete steps."),
  firstAction: z.string().describe("One physical action to begin with."),
  starter: StarterSchema,
  questions: z
    .array(z.string())
    .describe("2 to 4 questions the user can answer to get going."),
  outline: z
    .array(z.string())
    .describe("3 to 7 section names or points, as an editable structure."),
  firstSection: z.object({
    title: z.string().describe("The name of the first section."),
    content: z
      .string()
      .describe(
        "An editable start, with [brackets] for anything only the user can supply."
      ),
  }),
  note: z.string().describe("A short caveat, or empty."),
})
export type WorkspaceSetupOutput = z.infer<typeof WorkspaceSetupOutputSchema>
export type WorkspaceSetupResult = WorkspaceSetupOutput & {
  usedFallback?: boolean
}

export const WorkspaceSetupRequestSchema = z.object({
  stage: z.literal("workspace-setup"),
  task: TaskContextSchema,
  today: z.string().refine(isCalendarDate),
})
export type WorkspaceSetupRequest = z.infer<typeof WorkspaceSetupRequestSchema>

/* ---------- Writing assistance ---------- */

export const WRITING_ACTIONS = [
  "outline",
  "code",
  "explain",
  "starter",
  "split",
  "summarize",
  "improve",
] as const
export type WritingAction = (typeof WRITING_ACTIONS)[number]

export const WritingAssistOutputSchema = z.object({
  title: z.string().describe("A few words saying what this suggestion is."),
  content: z
    .string()
    .describe("Markdown to preview. Use [brackets] for missing details."),
  note: z.string().describe("A short caveat for the user, or empty."),
})
export type WritingAssistOutput = z.infer<typeof WritingAssistOutputSchema>

export const WritingAssistRequestSchema = z.object({
  stage: z.literal("writing-assist"),
  action: z.enum(WRITING_ACTIONS),
  task: TaskContextSchema,
  today: z.string().refine(isCalendarDate),
  selection: z.string().max(LIMITS.contextDocument).default(""),
  source: z.string().max(LIMITS.contextInstructions).default(""),
})
export type WritingAssistRequest = z.infer<typeof WritingAssistRequestSchema>

export type WritingAssistResult = WritingAssistOutput & {
  usedFallback?: boolean
}

export const RecoveryRequestSchema = z.discriminatedUnion("stage", [
  AnalyzeRequestSchema,
  NextStepRequestSchema,
  TaskRecoveryRequestSchema,
  TaskBreakdownRequestSchema,
  WritingAssistRequestSchema,
  StepHelpRequestSchema,
  WorkspaceSetupRequestSchema,
])
