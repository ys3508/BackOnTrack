/**
 * Runs required Tests A, B and C against the REAL configured AI model.
 * It makes about 20 model calls and spends a small amount of API credit.
 *
 *   npm run test:live
 *
 * The automatic checks are coarse. Read the saved output as well, and record
 * what you observed in docs/TEST_RESULTS.md.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { getLiveConfig, getLiveModel } from "../lib/ai/provider"
import { generateAnalysis, generateNextStep } from "../lib/ai/recovery"
import {
  generateTaskBreakdown,
  generateWritingAssist,
  generateStepHelp,
  generateWorkspaceSetup,
} from "../lib/ai/task-assist"
import { generateTaskRecovery } from "../lib/ai/task-recovery"
import { IntakeSchema } from "../lib/schemas"
import type {
  Analysis,
  NextStepRequest,
  NextStepResult,
  TaskContext,
  TaskRecoveryRequest,
} from "../lib/schemas"

const OUTPUT = process.env.LIVE_EVAL_OUT ?? "docs/live-eval-output.json"
const SHAMING = /\b(lazy|no excuses?|just do it|should have|you failed)\b/i

type Check = [name: string, passed: boolean]

const TESTS: {
  id: string
  input: string
  checks: (analysis: Analysis) => Check[]
}[] = [
  {
    id: "A: job application avoidance",
    input:
      "I have avoided job applications for two weeks and feel overwhelmed.",
    checks: (a) => [
      [
        "known facts mention the two weeks",
        /two weeks/i.test(a.realityCheck.knownFacts.join(" ")),
      ],
      ["has at least one assumption", a.realityCheck.assumptions.length > 0],
      [
        "does not state positions are closed as fact",
        !/(positions?|roles?|jobs?).*(are|is|have) (closed|gone|filled)/i.test(
          a.realityCheck.knownFacts.join(" ")
        ),
      ],
    ],
  },
  {
    id: "B: missed assignment",
    input:
      "I missed my assignment deadline three days ago and don't know whether my professor accepts late submissions.",
    checks: (a) => [
      [
        "late policy is listed as unknown",
        /late|policy/i.test(a.realityCheck.unknowns.join(" ")),
      ],
      [
        "known facts state no university rule",
        !/(university|policy) (states|requires|says)/i.test(
          a.realityCheck.knownFacts.join(" ")
        ),
      ],
      ["flagged high stakes", a.decision.highStakes],
      ["does not recommend RELEASE", a.decision.recommended !== "RELEASE"],
    ],
  },
  {
    id: "C: failed recovery attempt",
    input: "I tried your suggestion, but I still couldn't start.",
    checks: (a) => [
      ["names an unknown", a.realityCheck.unknowns.length > 0],
      ["no shaming language", !SHAMING.test(JSON.stringify(a))],
    ],
  },
]

async function main() {
  const config = getLiveConfig()
  if (!config) {
    console.error(
      "No API key found. Set ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY in .env.local, then run this again."
    )
    process.exit(1)
  }
  const model = getLiveModel(config)
  console.log(`Model: ${config.modelId}\n`)

  const results: unknown[] = []
  let failures = 0

  for (const test of TESTS) {
    console.log(`=== Test ${test.id}`)
    const intake = IntakeSchema.parse({ responsibility: test.input })
    const analysis = await generateAnalysis(model, intake)

    const base: NextStepRequest = {
      stage: "next-step",
      intake,
      knownFacts: analysis.realityCheck.knownFacts,
      unknowns: analysis.realityCheck.unknowns,
      strategy: analysis.decision.recommended,
      event: "start",
      note: "",
      history: [],
    }
    const first: NextStepResult = await generateNextStep(model, base)
    if (!first.action) throw new Error("No first step returned.")
    const planB = await generateNextStep(model, {
      ...base,
      event: "stuck",
      history: [
        {
          instruction: first.action.instruction,
          approach: first.action.approach,
          outcome: "stuck",
          userText: "",
          note: "",
        },
      ],
    })

    const checks: Check[] = [
      ...test.checks(analysis),
      [
        "Plan B differs from the first step",
        planB.action?.instruction !== first.action.instruction,
      ],
      [
        "Plan B changes approach",
        planB.action?.approach !== first.action.approach,
      ],
      ["Plan B needed no built-in fallback", !planB.usedFallback],
      [
        "steps contain no shaming language",
        !SHAMING.test(JSON.stringify([first, planB])),
      ],
    ]
    for (const [name, passed] of checks) {
      if (!passed) failures++
      console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}`)
    }
    console.log(`  First step: ${first.action.instruction}`)
    console.log(`  Plan B:     ${planB.action?.instruction}\n`)
    results.push({
      test: test.id,
      input: test.input,
      analysis,
      first,
      planB,
      checks,
    })
  }

  // The workspace's recovery engine, using real task data.
  const taskTests = [
    {
      id: "D: homework with no details",
      task: { title: "Do my biology homework", deadline: null },
    },
    {
      id: "E: missed deadline",
      task: { title: "Biology essay", deadline: "2020-01-15" },
    },
    {
      id: "F: stopped focus session",
      task: { title: "Update my resume", deadline: null },
      stuck: "I couldn't find my old file",
    },
  ]
  const today = new Date().toISOString().slice(0, 10)
  for (const test of taskTests) {
    console.log(`=== Test ${test.id}`)
    const request: TaskRecoveryRequest = {
      stage: "task-recovery",
      today,
      strategy: null,
      obstacle: test.stuck ?? "",
      rejected: [],
      task: {
        ...test.task,
        description: "",
        originalDeadline: test.task.deadline,
        status: "Needs Recovery",
        priority: "Medium",
        progress: 0,
        completedActions: [],
        attempts: [],
        obstacles: test.stuck ? [test.stuck] : [],
        openSteps: [],
        instructions: "",
        document: "",
        currentStep: "",
        stuckOnStep: 0,
        focusSessions: test.stuck
          ? [
              {
                date: today,
                plannedMinutes: 25,
                actualMinutes: 3,
                outcome: "stuck",
                note: test.stuck,
              },
            ]
          : [],
      },
    }
    const first = await generateTaskRecovery(model, request)
    const second = await generateTaskRecovery(model, {
      ...request,
      rejected: [
        {
          nextStep: first.plan.nextStep.instruction.slice(0, 400),
          artifactTitle: first.plan.artifact.title.slice(0, 400),
        },
      ],
    })
    const checks: Check[] = [
      ["plan has a draft", first.plan.artifact.body.length > 40],
      ["no built-in fallback was needed", !first.usedFallback],
      [
        "next step isn't reflective",
        !/why (this|it) matters|priorities|motivation|reflect/i.test(
          first.plan.nextStep.instruction
        ),
      ],
      [
        "schedule is today or later",
        first.plan.schedule.every((item) => item.date >= today),
      ],
      [
        "second plan differs",
        second.plan.nextStep.instruction !== first.plan.nextStep.instruction,
      ],
    ]
    for (const [name, passed] of checks) {
      if (!passed) failures++
      console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}`)
    }
    console.log(`  Next step: ${first.plan.nextStep.instruction}`)
    console.log(`  Draft:     ${first.plan.artifact.title}\n`)
    results.push({ test: test.id, request, first, second, checks })
  }

  // Task breakdown and writing help, using real instructions.
  const instructions =
    "Assignment 3: Classification\n- Train a classifier on the provided dataset\n- Report the accuracy on the test set\nYou must submit a two-page PDF report."
  const context: TaskContext = {
    title: "Finish my machine learning assignment",
    description: "",
    deadline: null,
    originalDeadline: null,
    status: "In Progress",
    priority: "Medium",
    progress: 25,
    completedActions: ["Completed: Read the assignment requirements"],
    attempts: [],
    obstacles: [],
    openSteps: [],
    instructions,
    document: "",
    currentStep: "Write the introduction",
    stuckOnStep: 0,
    focusSessions: [],
  }

  console.log("=== Test G: task breakdown")
  const breakdown = await generateTaskBreakdown(model, {
    stage: "task-breakdown",
    task: context,
    today,
    rejected: [],
  })
  const breakdownChecks: Check[] = [
    ["gives several steps", breakdown.steps.length >= 3],
    ["no built-in fallback was needed", !breakdown.usedFallback],
    [
      "doesn't repeat the finished step",
      !breakdown.steps.some((step) =>
        /^read the assignment requirements/i.test(step)
      ),
    ],
  ]
  for (const [name, passed] of breakdownChecks) {
    if (!passed) failures++
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}`)
  }
  console.log(`  Steps: ${breakdown.steps.join(" | ")}\n`)
  results.push({
    test: "G: task breakdown",
    breakdown,
    checks: breakdownChecks,
  })

  for (const action of ["outline", "starter", "improve"] as const) {
    console.log(`=== Test H: writing help (${action})`)
    const result = await generateWritingAssist(model, {
      stage: "writing-assist",
      action,
      task: context,
      today,
      selection:
        action === "improve" ? "this model it does good on the test" : "",
      source: "",
    })
    const checks: Check[] = [
      ["has content", result.content.length > 0],
      ["no built-in fallback was needed", !result.usedFallback],
    ]
    for (const [name, passed] of checks) {
      if (!passed) failures++
      console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}`)
    }
    console.log(`  ${result.content.slice(0, 160)}\n`)
    results.push({ test: `H: writing help (${action})`, result, checks })
  }

  const codingContext = {
    ...context,
    title: "ML homework",
    instructions:
      "Train a classifier on the provided dataset, and submit a one-page report with its test accuracy.",
    currentStep: "Train a classifier on the provided dataset",
  }

  console.log("=== Test I: help with one big step")
  const stepHelp = await generateStepHelp(model, {
    stage: "step-help",
    task: codingContext,
    today,
    step: codingContext.currentStep,
  })
  const stepChecks: Check[] = [
    ["no built-in fallback was needed", !stepHelp.usedFallback],
    [
      "the first action isn't to think about it",
      !/^\s*(think|consider|reflect)/i.test(stepHelp.firstAction),
    ],
    ["gives something to start from", stepHelp.starter.content.length > 0],
  ]
  for (const [name, passed] of stepChecks) {
    if (!passed) failures++
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}`)
  }
  console.log(`  First action: ${stepHelp.firstAction}\n`)
  results.push({ test: "I: step help", stepHelp, checks: stepChecks })

  console.log("=== Test J: first workspace from instructions")
  const setup = await generateWorkspaceSetup(model, {
    stage: "workspace-setup",
    task: { ...codingContext, currentStep: "", completedActions: [] },
    today,
  })
  const setupChecks: Check[] = [
    ["no built-in fallback was needed", !setup.usedFallback],
    ["names what has to be handed in", setup.deliverables.length > 0],
    ["gives several steps", setup.steps.length >= 3],
    ["doesn't invent a date", setup.datesMentioned.length === 0],
    ["prepares questions to answer", setup.questions.length > 0],
    ["prepares an outline", setup.outline.length > 0],
    ["prepares a first section", setup.firstSection.content.length > 0],
  ]
  for (const [name, passed] of setupChecks) {
    if (!passed) failures++
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}`)
  }
  console.log(`  Deliverables: ${setup.deliverables.join(" | ")}\n`)
  results.push({ test: "J: workspace setup", setup, checks: setupChecks })

  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(
    OUTPUT,
    JSON.stringify(
      { model: config.modelId, ranAt: new Date().toISOString(), results },
      null,
      2
    )
  )
  console.log(
    `Saved full output to ${OUTPUT}. ${failures} automatic check(s) failed.`
  )
  if (failures) process.exitCode = 1
}

main().catch((error) => {
  console.error(
    "Live evaluation stopped:",
    error instanceof Error ? error.message : error
  )
  process.exit(1)
})
