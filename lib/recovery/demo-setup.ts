import { concreteStep, prepStepFor } from "@/lib/recovery/concrete"
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

/** Fixed structures chosen by wording. They hold no facts about the topic. */
function preparedParts(
  task: WorkspaceSetupRequest["task"],
  requirements: string[]
) {
  const text = `${task.title} ${task.instructions}`
  if (
    /classifier|dataset|\bmodel\b|\bcode\b|python|script|program/i.test(text)
  ) {
    return {
      questions: [
        "What is this supposed to predict or produce?",
        "Which file or data does it start from?",
        "How will you show that it works?",
      ],
      outline: ["Data", "Approach", "Results", "What I'd change"],
      firstSection: {
        title: "Data",
        content:
          "The data I'm using is [name or path]. The part I need to predict or produce is [name].",
      },
    }
  }
  if (/paper|essay|report|research|thesis|article|writ|draft/i.test(text)) {
    return {
      questions: [
        "What question is this answering?",
        "What sources or notes do you already have?",
        "If you had to give your answer today, what would it be?",
      ],
      outline: requirements.length
        ? requirements.slice(0, 6)
        : [
            "Introduction",
            "First main point",
            "Second main point",
            "Conclusion",
          ],
      firstSection: {
        title: "Introduction",
        content:
          "This is about [topic]. The question I'm answering is [question]. My answer so far is [rough answer], and I'm not sure about [what you're unsure of].",
      },
    }
  }
  return {
    questions: [
      "What has to exist when this is finished?",
      "Who or what do you need for it?",
      "What's the smallest version that would still count?",
    ],
    outline: requirements.length
      ? requirements.slice(0, 6)
      : [
          "What this is for",
          "What I need",
          "First part",
          "Check before finishing",
        ],
    firstSection: {
      title: "First part",
      content:
        "This has to achieve [one line]. The first thing I'll do is [one small action].",
    },
  }
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
  // A prep step is the start of the big step it came from, so use that one's help.
  const concrete = concreteStep(
    steps.find((step) => prepStepFor(step) === target) ?? target
  )

  const parts = preparedParts(task, deliverables)

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
    // Code has its own first move. Otherwise it's the part of the document that's
    // ready to edit, not whichever step happened to come first.
    firstAction:
      concrete.starter.kind === "code"
        ? concrete.firstAction
        : `Fill in the first [bracket] under “${parts.firstSection.title}”`,
    starter: concrete.starter,
    ...parts,
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
