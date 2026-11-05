import { z } from "zod"

export const LIMITS = {
  responsibility: 2000,
  detail: 300,
  stepText: 1000,
  note: 500,
  history: 30,
  listItem: 400,
} as const

/* ---------- User input ---------- */

export const IntakeSchema = z.object({
  responsibility: z
    .string()
    .trim()
    .min(10, "Please describe it in at least a few words.")
    .max(
      LIMITS.responsibility,
      `Please keep this under ${LIMITS.responsibility} characters.`
    )
    .refine((value) => /\p{L}/u.test(value), "Please describe it in words."),
  deadline: z.string().trim().max(LIMITS.detail).default(""),
  status: z.string().trim().max(LIMITS.detail).default(""),
  obstacle: z.string().trim().max(LIMITS.detail).default(""),
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

export const RecoveryRequestSchema = z.discriminatedUnion("stage", [
  AnalyzeRequestSchema,
  NextStepRequestSchema,
])

/* ---------- API responses ---------- */

/** `action: null` means there is nothing further to suggest right now. */
export type NextStepResult = {
  action: ActionStep | null
  adaptationNote: string
  suggestWrapUp: boolean
  /** True when the server replaced a repeated suggestion with a built-in step. */
  usedFallback?: boolean
}
