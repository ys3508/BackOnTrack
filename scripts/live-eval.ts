/**
 * Runs required Tests A, B and C against the REAL configured AI model.
 * It makes about 15 model calls and spends a small amount of API credit.
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
import { generateTaskRecovery } from "../lib/ai/task-recovery"
import { IntakeSchema } from "../lib/schemas"
import type {
  Analysis,
  NextStepRequest,
  NextStepResult,
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
