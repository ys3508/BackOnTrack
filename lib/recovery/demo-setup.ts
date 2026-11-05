import { concreteStep } from "@/lib/recovery/concrete"
import {
  demoBreakdown,
  extractRequirements,
} from "@/lib/recovery/demo-breakdown"
import type {
  StepHelpRequest,
  StepHelpResult,
  WorkspaceSetupRequest,
  WorkspaceSetupResult,
} from "@/lib/schemas"
import { similarity } from "@/lib/guards"

const DATE =
  /\b(?:(?:by|due|before|on)\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi

export function findDates(text: string) {
  return [...new Set(text.match(DATE) ?? [])].slice(0, 5)
}

/** Lines mentioning something the work relies on, using simple text rules. */
function findDependencies(text: string) {
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) =>
      /\b(provided|using|based on|requires?|needs?|you will need|dataset|template|starter)\b/i.test(
        line
      )
    )
    .slice(0, 4)
}

export function demoWorkspaceSetup(
  request: WorkspaceSetupRequest
): WorkspaceSetupResult {
  const { task, today } = request
  const steps = demoBreakdown({
    stage: "task-breakdown",
    task,
    today,
    rejected: [],
  }).steps
  const deliverables = extractRequirements(task.instructions, 8)
  // The first step worth doing is usually past "read the instructions".
  const target =
    steps.find((step) => !/^read through|^paste the assignment/i.test(step)) ??
    steps[0] ??
    task.title
  const concrete = concreteStep(target)

  return {
    summary: task.instructions
      ? "Pulled from your instructions with simple text rules, so check that nothing is missing."
      : "Without instructions, this is a general starting point. Add them for something closer to your task.",
    deliverables,
    datesMentioned: findDates(task.instructions),
    dependencies: findDependencies(task.instructions),
    unclear: task.instructions
      ? []
      : ["What exactly has to be handed in, and in what format?"],
    steps,
    firstAction: concrete.firstAction,
    starter: concrete.starter,
    note: "",
  }
}

export function demoStepHelp(request: StepHelpRequest): StepHelpResult {
  const concrete = concreteStep(request.step)
  // Having tried the obvious start already, offer the next smaller piece.
  const tried = [...request.task.attempts, ...request.task.completedActions]
  const fresh = [concrete.firstAction, ...concrete.smallerSteps].find(
    (option) => !tried.some((item) => similarity(option, item) >= 0.6)
  )
  return {
    firstAction: fresh ?? concrete.firstAction,
    why: concrete.why,
    starter: concrete.starter,
    smallerSteps: concrete.smallerSteps,
    note: "Demo Mode: a fixed template matched on this step's wording, not AI.",
  }
}
