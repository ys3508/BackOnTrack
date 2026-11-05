import { generateText, NoObjectGeneratedError, Output } from "ai"
import type { LanguageModel } from "ai"

import {
  ANALYSIS_SYSTEM,
  NEXT_STEP_SYSTEM,
  analysisPrompt,
  nextStepPrompt,
} from "@/lib/ai/prompts"
import {
  InvalidModelOutputError,
  applySafetyGuards,
  findRepeatReason,
  normalizeAnalysis,
  normalizeNextStep,
  pickFallbackStep,
} from "@/lib/guards"
import { AnalysisSchema, NextStepOutputSchema } from "@/lib/schemas"
import type {
  Analysis,
  Intake,
  NextStepRequest,
  NextStepResult,
} from "@/lib/schemas"

const MAX_OUTPUT_TOKENS = 4000
const REQUEST_TIMEOUT_MS = 25_000

function isBadOutput(error: unknown) {
  return (
    NoObjectGeneratedError.isInstance(error) ||
    error instanceof InvalidModelOutputError
  )
}

export async function generateAnalysis(
  model: LanguageModel,
  intake: Intake
): Promise<Analysis> {
  const attempt = async () => {
    const { output } = await generateText({
      model,
      system: ANALYSIS_SYSTEM,
      prompt: analysisPrompt(intake),
      output: Output.object({ schema: AnalysisSchema }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return applySafetyGuards(normalizeAnalysis(output), intake)
  }

  try {
    return await attempt()
  } catch (error) {
    if (!isBadOutput(error)) throw error
    return attempt()
  }
}

async function requestStep(
  model: LanguageModel,
  request: NextStepRequest,
  correction?: string
) {
  const { output } = await generateText({
    model,
    system: NEXT_STEP_SYSTEM,
    prompt: nextStepPrompt(request, correction),
    output: Output.object({ schema: NextStepOutputSchema }),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return normalizeNextStep(output)
}

/**
 * Asks for the next step and verifies it is not a repeat of anything already
 * tried. A repeat gets one corrected retry, then a built-in step, so the model
 * alone cannot send the user back to something that just failed.
 */
export async function generateNextStep(
  model: LanguageModel,
  request: NextStepRequest
): Promise<NextStepResult> {
  let correction: string | undefined

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const step = await requestStep(model, request, correction)
      const repeatReason = findRepeatReason(step.action, request.history)
      if (!repeatReason) return step
      correction = repeatReason
    } catch (error) {
      if (!isBadOutput(error) || attempt === 1) throw error
    }
  }

  const fallback = pickFallbackStep(request.history)
  return {
    action: fallback,
    adaptationNote: fallback
      ? "Trying something different from the steps so far."
      : "You have tried several approaches. It is fine to stop here and come back later.",
    suggestWrapUp: !fallback,
    usedFallback: true,
  }
}
