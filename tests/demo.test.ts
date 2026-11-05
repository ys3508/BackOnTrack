import { describe, expect, it } from "vitest"

import { demoAnalysis, demoNextStep } from "@/lib/demo/engine"
import { DEMO_SCENARIOS, customScenario } from "@/lib/demo/scenarios"
import { STRATEGIES } from "@/lib/schemas"
import type { Intake, NextStepRequest, Strategy } from "@/lib/schemas"

const intake = (responsibility: string): Intake => ({
  responsibility,
  deadline: "",
  status: "",
  obstacle: "",
})

function request(
  text: string,
  strategy: Strategy,
  history: NextStepRequest["history"] = [],
  event: NextStepRequest["event"] = "start"
): NextStepRequest {
  return {
    stage: "next-step",
    intake: intake(text),
    knownFacts: ["fact"],
    unknowns: ["unknown"],
    strategy,
    event,
    note: "",
    history,
  }
}

/** Presses "I'm Still Stuck" until the path runs out, returning every step shown. */
function pressStuckUntilExhausted(text: string, strategy: Strategy) {
  const history: NextStepRequest["history"] = []
  const shown: string[] = []
  let result = demoNextStep(request(text, strategy))
  while (result.action && shown.length < 30) {
    shown.push(result.action.instruction)
    history.push({
      instruction: result.action.instruction,
      approach: result.action.approach,
      outcome: "stuck",
      userText: "",
      note: "",
    })
    result = demoNextStep(request(text, strategy, history, "stuck"))
  }
  return shown
}

const TEST_A =
  "I have avoided job applications for two weeks and feel overwhelmed."
const TEST_B =
  "I missed my assignment deadline three days ago and don't know whether my professor accepts late submissions."
const TEST_C = "I tried your suggestion, but I still couldn't start."

describe("Test A: job application avoidance", () => {
  const analysis = demoAnalysis(intake(TEST_A))

  it("distinguishes fact from assumption", () => {
    expect(analysis.realityCheck.knownFacts.join(" ")).toMatch(/two weeks/)
    expect(analysis.realityCheck.assumptions.length).toBeGreaterThan(0)
  })

  it("does not assume that positions are closed", () => {
    const unknowns = analysis.realityCheck.unknowns.join(" ")
    expect(unknowns).toMatch(/still accepting applications/)
    const closing = analysis.realityCheck.consequences.find((c) =>
      /closed/.test(c.text)
    )
    expect(closing?.status).toBe("uncertain")
  })

  it("recommends one concrete action and a different Plan B", () => {
    const first = demoNextStep(request(TEST_A, "REDUCE"))
    expect(first.action?.instruction).toBe(
      "Type the name of one company you wanted to apply to."
    )
    const planB = demoNextStep(
      request(
        TEST_A,
        "REDUCE",
        [
          {
            instruction: first.action!.instruction,
            approach: first.action!.approach,
            outcome: "stuck",
            userText: "",
            note: "",
          },
        ],
        "stuck"
      )
    )
    expect(planB.action?.instruction).not.toBe(first.action?.instruction)
    expect(planB.action?.approach).not.toBe(first.action?.approach)
    expect(planB.adaptationNote).toMatch(/different approach/)
  })
})

describe("Test B: missed assignment", () => {
  const analysis = demoAnalysis(intake(TEST_B))

  it("identifies the unknown late-submission policy", () => {
    expect(analysis.realityCheck.unknowns.join(" ")).toMatch(
      /late-submission policy/
    )
  })

  it("does not state a university rule as fact", () => {
    const facts = analysis.realityCheck.knownFacts.join(" ")
    expect(facts).not.toMatch(
      /penalty|not accepted|policy (is|states)|university/i
    )
    const penalty = analysis.realityCheck.consequences.find((c) =>
      /penalty/.test(c.text)
    )
    expect(penalty?.status).toBe("uncertain")
  })

  it("marks it high stakes and does not recommend release", () => {
    expect(analysis.decision.highStakes).toBe(true)
    expect(analysis.decision.recommended).not.toBe("RELEASE")
    expect(analysis.decision.caution).toMatch(/professor/)
  })

  it("suggests a feasible step that sends nothing on the user's behalf", () => {
    const first = demoNextStep(request(TEST_B, "REDUCE"))
    expect(first.action?.approach).toBe("gather-information")
    const second = demoNextStep(
      request(
        TEST_B,
        "REDUCE",
        [
          {
            instruction: first.action!.instruction,
            approach: first.action!.approach,
            outcome: "stuck",
            userText: "",
            note: "",
          },
        ],
        "stuck"
      )
    )
    expect(second.action?.why).toMatch(/your decision/i)
  })
})

describe("Test C: failed recovery attempt", () => {
  const analysis = demoAnalysis(intake(TEST_C))

  it("treats the earlier suggestion as unknown instead of pretending to remember it", () => {
    expect(analysis.realityCheck.unknowns.join(" ")).toMatch(
      /what the suggestion was/
    )
  })

  it("avoids shaming language", () => {
    const text =
      JSON.stringify(analysis) +
      JSON.stringify(pressStuckUntilExhausted(TEST_C, "REDUCE"))
    expect(text).not.toMatch(
      /lazy|should have|just do it|no excuses|you failed|!/i
    )
  })

  it("offers a smaller step that does not require starting the task", () => {
    const first = demoNextStep(request(TEST_C, "REDUCE"))
    expect(first.action?.approach).toBe("shrink-scope")
    expect(first.action?.minutes).toBe(1)
  })
})

describe("every demo path", () => {
  const scenarios = [
    ...DEMO_SCENARIOS.map((s) => s.input),
    "My own task that I keep avoiding",
  ]

  it("never repeats a step or the failed approach, however often the user is stuck", () => {
    for (const input of scenarios) {
      for (const strategy of STRATEGIES) {
        const shown = pressStuckUntilExhausted(input, strategy)
        expect(shown.length).toBeGreaterThanOrEqual(2)
        expect(new Set(shown).size).toBe(shown.length)
      }
    }
  })

  it("has distinct approaches within each rung", () => {
    for (const scenario of [...DEMO_SCENARIOS, customScenario("x")]) {
      for (const strategy of STRATEGIES) {
        for (const rung of scenario.ladders[strategy]) {
          expect(rung.length).toBeGreaterThanOrEqual(2)
          const approaches = rung.map((step) => step.approach)
          expect(new Set(approaches).size).toBe(approaches.length)
        }
      }
    }
  })

  it("reaches a natural end when steps are completed", () => {
    for (const input of scenarios) {
      for (const strategy of STRATEGIES) {
        const history: NextStepRequest["history"] = []
        let result = demoNextStep(request(input, strategy))
        let guard = 0
        while (result.action && guard++ < 10) {
          history.push({
            instruction: result.action.instruction,
            approach: result.action.approach,
            outcome: "completed",
            userText: "",
            note: "",
          })
          result = demoNextStep(request(input, strategy, history, "completed"))
        }
        expect(result.action).toBeNull()
        expect(history.length).toBeGreaterThan(0)
      }
    }
  })

  it("custom text is quoted, and flagged as not analyzed", () => {
    const analysis = demoAnalysis(intake("I keep avoiding my garage cleanup"))
    expect(analysis.realityCheck.knownFacts[0]).toContain("garage cleanup")
    expect(analysis.acknowledgement).toMatch(/not an analysis/)
  })

  it("adds high-stakes protection to custom text in Demo Mode", () => {
    const analysis = demoAnalysis(intake("I keep avoiding my tax filing"))
    expect(analysis.decision.highStakes).toBe(true)
    expect(analysis.decision.caution).not.toBe("")
  })
})
