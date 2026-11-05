import { generateText, NoObjectGeneratedError, Output } from "ai"
import type { LanguageModel } from "ai"

import { TASK_BREAKDOWN_SYSTEM, taskBreakdownPrompt } from "@/lib/ai/prompts"
import { InvalidModelOutputError, similarity } from "@/lib/guards"
import { demoBreakdown } from "@/lib/recovery/demo-breakdown"
import { TaskBreakdownOutputSchema } from "@/lib/schemas"
import type {
  TaskBreakdownOutput,
  TaskBreakdownRequest,
  TaskBreakdownResult,
} from "@/lib/schemas"

const MAX_OUTPUT_TOKENS = 4000
const REQUEST_TIMEOUT_MS = 25_000
const VAGUE =
  /why (this|it) matters|your priorities|your motivation|reflect on|what matters most/i

export function isBadOutput(error: unknown) {
  return (
    NoObjectGeneratedError.isInstance(error) ||
    error instanceof InvalidModelOutputError
  )
}

export function normalizeBreakdown(
  raw: TaskBreakdownOutput,
  request: TaskBreakdownRequest
): TaskBreakdownOutput {
  const finished = request.task.completedActions.map((item) =>
    item.replace(/^Completed:\s*/, "")
  )
  const seen = new Set<string>()
  const steps = raw.steps
    .map((step) => step.trim().slice(0, 200))
    .filter((step) => {
      const key = step.toLowerCase()
      if (!step || seen.has(key)) return false
      seen.add(key)
      return !finished.some((done) => similarity(step, done) >= 0.6)
    })
    .slice(0, 10)
  if (!steps.length) {
    throw new InvalidModelOutputError("The breakdown has no steps.")
  }
  return {
    note: raw.note.trim().slice(0, 300),
    steps,
    ambiguities: raw.ambiguities
      .map((item) => item.trim().slice(0, 240))
      .filter(Boolean)
      .slice(0, 5),
  }
}

export function breakdownProblem(steps: string[]) {
  const vague = steps.find((step) => VAGUE.test(step))
  return vague ? `"${vague}" asks for reflection, not an action.` : null
}

/** A bad breakdown gets one corrected retry, then an honestly labeled template. */
export async function generateTaskBreakdown(
  model: LanguageModel,
  request: TaskBreakdownRequest
): Promise<TaskBreakdownResult> {
  let correction: string | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { output } = await generateText({
        model,
        system: TASK_BREAKDOWN_SYSTEM,
        prompt: taskBreakdownPrompt(request, correction),
        output: Output.object({ schema: TaskBreakdownOutputSchema }),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const breakdown = normalizeBreakdown(output, request)
      const problem = breakdownProblem(breakdown.steps)
      if (!problem) return breakdown
      correction = problem
    } catch (error) {
      if (!isBadOutput(error) || attempt === 1) throw error
    }
  }
  return { ...demoBreakdown(request), usedFallback: true }
}
