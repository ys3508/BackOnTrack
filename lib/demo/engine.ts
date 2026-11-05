import { DEMO_SCENARIOS, customScenario } from "@/lib/demo/scenarios"
import type { DemoScenario } from "@/lib/demo/scenarios"
import {
  applySafetyGuards,
  findRepeatReason,
  pickFallbackStep,
} from "@/lib/guards"
import type {
  Analysis,
  HistoryEntry,
  Intake,
  NextStepRequest,
  NextStepResult,
} from "@/lib/schemas"

function scenarioFor(intake: Intake): DemoScenario {
  return (
    DEMO_SCENARIOS.find(
      (scenario) => scenario.input === intake.responsibility.trim()
    ) ?? customScenario(intake.responsibility)
  )
}

export function demoAnalysis(intake: Intake): Analysis {
  return applySafetyGuards(scenarioFor(intake).analysis, intake)
}

function adaptationNote(request: NextStepRequest) {
  const heard = request.note ? ` You said: "${request.note}".` : ""
  if (request.event === "stuck") {
    return `The last step didn't work, so this one takes a different approach.${heard}`
  }
  if (request.event === "change") {
    return `Here's a different step, as you asked.${heard}`
  }
  return ""
}

/**
 * Deterministic and stateless: the position in the ladder is worked out from
 * history alone. Completed steps move to the next rung; failed steps move to
 * the next variant on the same rung, then to built-in steps, and never repeat.
 */
export function demoNextStep(request: NextStepRequest): NextStepResult {
  const scenario = scenarioFor(request.intake)
  const ladder = scenario.ladders[request.strategy]
  const { history } = request

  // Count only steps from this ladder, so switching strategy starts it fresh.
  const ladderSteps = new Set(ladder.flat().map((step) => step.instruction))
  const rungIndex = history.filter(
    (entry) =>
      entry.outcome === "completed" && ladderSteps.has(entry.instruction)
  ).length
  const lastCompleted = history.findLastIndex(
    (entry: HistoryEntry) => entry.outcome === "completed"
  )
  const failedOnRung = history.length - lastCompleted - 1

  if (rungIndex >= ladder.length) {
    return {
      action: null,
      adaptationNote: "",
      suggestWrapUp: true,
    }
  }

  const candidate = ladder[rungIndex]
    .slice(failedOnRung)
    .find((variant) => findRepeatReason(variant, history) === null)
  const fallback = candidate ? null : pickFallbackStep(history)
  const action = candidate ?? fallback

  if (!action) {
    return {
      action: null,
      adaptationNote:
        "You have tried several different approaches. It's fine to stop here for now and come back later.",
      suggestWrapUp: true,
    }
  }

  return {
    action,
    adaptationNote: adaptationNote(request),
    suggestWrapUp: rungIndex === ladder.length - 1,
  }
}
