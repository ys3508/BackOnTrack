/**
 * Runs required Tests A, B and C against the REAL configured AI model.
 * It makes about nine model calls and spends a small amount of API credit.
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
import { IntakeSchema } from "../lib/schemas"
import type { Analysis, NextStepRequest, NextStepResult } from "../lib/schemas"

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
