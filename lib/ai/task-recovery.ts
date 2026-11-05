import { generateText, NoObjectGeneratedError, Output } from "ai"
import type { LanguageModel } from "ai"

import { TASK_RECOVERY_SYSTEM, taskRecoveryPrompt } from "@/lib/ai/prompts"
import {
  InvalidModelOutputError,
  applySafetyGuards,
  normalizeAnalysis,
  similarity,
} from "@/lib/guards"
import { contextIntake, taskFacts } from "@/lib/recovery/context"
import { demoTaskRecovery } from "@/lib/recovery/demo-plan"
import { TaskRecoveryOutputSchema, isCalendarDate } from "@/lib/schemas"
import type {
  RecoveryPlan,
  TaskRecoveryRequest,
  TaskRecoveryResult,
} from "@/lib/schemas"

const MAX_OUTPUT_TOKENS = 6000
const REQUEST_TIMEOUT_MS = 25_000
const REPEAT_THRESHOLD = 0.6

/** Advice that doesn't produce anything. The product exists to avoid these. */
const VAGUE =
  /why (this|it) matters|your priorities|your motivation|reflect on|think about (why|your)|what matters most/i

export function normalizePlan(plan: RecoveryPlan, today: string): RecoveryPlan {
  const instruction = plan.nextStep.instruction.trim()
  const body = plan.artifact.body.trim()
  if (!instruction || !body) {
    throw new InvalidModelOutputError("The plan has no action or draft.")
  }
  const minutes = Number.isFinite(plan.nextStep.minutes)
    ? plan.nextStep.minutes
    : 5
  return {
    headline: plan.headline.trim() || "A way forward",
    adaptationNote: plan.adaptationNote.trim(),
    nextStep: {
      ...plan.nextStep,
      instruction,
      why: plan.nextStep.why.trim(),
      minutes: Math.min(Math.max(Math.round(minutes), 1), 30),
    },
    artifact: {
      kind: plan.artifact.kind,
      title: plan.artifact.title.trim().slice(0, 120) || "Draft",
      body: body.slice(0, 6000),
    },
    steps: plan.steps
      .map((step) => step.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 6),
    schedule: plan.schedule
      .filter((item) => isCalendarDate(item.date) && item.date >= today)
      .slice(0, 4)
      .map((item) => ({
        date: item.date,
        minutes: Math.min(Math.max(Math.round(item.minutes) || 10, 5), 60),
        label: item.label.trim().slice(0, 120),
      })),
  }
}

/** Why a plan can't be shown, or null if it's fine. */
export function planProblem(
  plan: RecoveryPlan,
  request: TaskRecoveryRequest
): string | null {
  const text = plan.nextStep.instruction
  if (VAGUE.test(`${text} ${plan.headline}`)) {
    return "The next step asks for reflection instead of producing something. Give an action with a tangible output."
  }
  const earlier = [
    ...request.rejected.map((item) => item.nextStep),
    ...request.task.attempts,
  ]
  for (const attempt of earlier) {
    if (similarity(text, attempt) >= REPEAT_THRESHOLD) {
      return `It closely repeats something already tried: "${attempt}"`
    }
  }
  return null
}

async function requestPlan(
  model: LanguageModel,
  request: TaskRecoveryRequest,
  correction?: string
) {
  const { output } = await generateText({
    model,
    system: TASK_RECOVERY_SYSTEM,
    prompt: taskRecoveryPrompt(request, correction),
    output: Output.object({ schema: TaskRecoveryOutputSchema }),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return output
}

/**
 * Asks the model for a plan based on the task's real data, then checks it. A
 * repeated or vague plan gets one corrected retry, then an honest built-in one.
 */
export async function generateTaskRecovery(
  model: LanguageModel,
  request: TaskRecoveryRequest
): Promise<TaskRecoveryResult> {
  const { today } = request
  const intake = contextIntake(request)
  let current = request
  let correction: string | undefined

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const output = await requestPlan(model, current, correction)
      const analysis = applySafetyGuards(normalizeAnalysis(output), intake)

      // The guard moved a high-stakes RELEASE to REDUCE, so the plan must match.
      if (
        !current.strategy &&
        output.decision.recommended === "RELEASE" &&
        analysis.decision.recommended !== "RELEASE"
      ) {
        current = { ...current, strategy: "REDUCE" }
        correction =
          "This looks like an important obligation, so plan for REDUCE, not RELEASE."
        continue
      }

      const plan = normalizePlan(output.plan, today)
      const problem = planProblem(plan, request)
      if (!problem) {
        const facts = taskFacts(request, today)
        return {
          analysis: {
            ...analysis,
            realityCheck: {
              ...analysis.realityCheck,
              knownFacts: [...facts.known, ...analysis.realityCheck.knownFacts],
              unknowns: [...facts.unknown, ...analysis.realityCheck.unknowns],
            },
          },
          plan,
        }
      }
      correction = problem
    } catch (error) {
      const badOutput =
        NoObjectGeneratedError.isInstance(error) ||
        error instanceof InvalidModelOutputError
      if (!badOutput || attempt === 1) throw error
    }
  }

  return { ...demoTaskRecovery(request), usedFallback: true }
}
